"""
"Forgot password?", driven through the real endpoints.

Only the outgoing email is replaced: `mailer.send_password_reset` is swapped
for a recorder, so each test can read the link a user would have received and
follow it exactly as they would.
"""
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from app.models import PasswordResetToken, User
from app.services import mailer, password_reset
from app.services.auth import hash_password

OLD_PASSWORD = "old-password"
NEW_PASSWORD = "brand-new-password"


@pytest.fixture
def client():
    from app.main import app
    return TestClient(app)


@pytest.fixture(autouse=True)
def fresh_limits():
    password_reset.rate_limiter.reset()
    yield
    password_reset.rate_limiter.reset()


@pytest.fixture
def outbox(monkeypatch):
    """Every reset email the endpoint sends, as (to, link)."""
    sent = []
    monkeypatch.setattr(mailer, "send_password_reset", lambda to, link: sent.append((to, link)) or True)
    monkeypatch.setenv("FRONTEND_URL", "https://heromaker.example.test")
    return sent


@pytest.fixture
def account(db):
    user = User(
        email="kid@example.test",
        username="kiddo",
        password_hash=hash_password(OLD_PASSWORD),
        credits=0,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def forgot(client, email):
    return client.post("/api/auth/forgot-password", json={"email": email})


def token_from(link):
    parsed = urlparse(link)
    assert parsed.path == "/reset-password"
    return parse_qs(parsed.query)["token"][0]


def reset(client, token, password=NEW_PASSWORD):
    return client.post("/api/auth/reset-password", json={"token": token, "new_password": password})


def login(client, password):
    return client.post("/api/auth/login", json={"username": "kiddo", "password": password})


def test_unknown_email_answers_200_and_sends_nothing(client, outbox, account):
    known = forgot(client, account.email)
    unknown = forgot(client, "nobody@example.test")

    assert unknown.status_code == 200
    assert unknown.json() == known.json(), "the answer must not reveal whether the account exists"
    assert [to for to, _ in outbox] == [account.email]


def test_known_email_sends_one_link_to_the_frontend(client, outbox, account, db):
    response = forgot(client, "  KID@Example.TEST ")

    assert response.status_code == 200
    assert len(outbox) == 1
    to, link = outbox[0]
    assert to == account.email
    assert link.startswith("https://heromaker.example.test/reset-password?token=")
    assert db.query(PasswordResetToken).count() == 1


def test_valid_token_resets_password_and_signs_in(client, outbox, account):
    assert login(client, OLD_PASSWORD).status_code == 200
    forgot(client, account.email)

    response = reset(client, token_from(outbox[0][1]))

    assert response.status_code == 200
    body = response.json()
    assert body["access_token"]
    assert body["user"]["username"] == "kiddo"
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200
    assert login(client, NEW_PASSWORD).status_code == 200
    assert login(client, OLD_PASSWORD).status_code == 401


def test_reused_token_is_rejected(client, outbox, account):
    forgot(client, account.email)
    token = token_from(outbox[0][1])

    assert reset(client, token).status_code == 200
    again = reset(client, token, password="a-third-password")

    assert again.status_code == 400
    assert login(client, NEW_PASSWORD).status_code == 200


def test_using_one_token_invalidates_the_others(client, outbox, account):
    forgot(client, account.email)
    forgot(client, account.email)
    first, second = (token_from(link) for _, link in outbox)

    assert reset(client, second).status_code == 200
    assert reset(client, first, password="a-third-password").status_code == 400


def test_expired_token_is_rejected(client, outbox, account, db):
    forgot(client, account.email)
    token = token_from(outbox[0][1])
    row = db.query(PasswordResetToken).one()
    row.expires_at = datetime.utcnow() - timedelta(seconds=1)
    db.commit()

    assert reset(client, token).status_code == 400
    assert login(client, OLD_PASSWORD).status_code == 200


def test_unknown_token_is_rejected(client, account):
    assert reset(client, "not-a-real-token").status_code == 400


def test_only_the_hash_is_stored(client, outbox, account, db):
    forgot(client, account.email)
    token = token_from(outbox[0][1])

    assert len(token) >= 43, "32 random bytes encode to at least 43 urlsafe characters"
    row = db.query(PasswordResetToken).one()
    assert row.token_hash == password_reset.hash_token(token)
    assert token not in {str(v) for v in row.__dict__.values()}
    expires_in = row.expires_at - datetime.utcnow()
    assert timedelta(minutes=59) < expires_in <= timedelta(hours=1)


def test_new_password_follows_signup_rules(client, outbox, account):
    forgot(client, account.email)
    token = token_from(outbox[0][1])

    assert reset(client, token, password="short").status_code == 422
    assert reset(client, token).status_code == 200, "a rejected password must not burn the token"


def test_rate_limited_per_email_with_the_same_answer(client, outbox, account):
    answers = [forgot(client, account.email) for _ in range(password_reset.MAX_PER_EMAIL + 2)]

    assert {r.status_code for r in answers} == {200}
    assert len({r.text for r in answers}) == 1
    assert len(outbox) == password_reset.MAX_PER_EMAIL


def test_rate_limited_per_ip(client, outbox, account):
    for i in range(password_reset.MAX_PER_IP):
        forgot(client, f"stranger{i}@example.test")

    assert forgot(client, account.email).status_code == 200
    assert outbox == []


def test_config_reports_password_reset(client, monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    assert client.get("/api/auth/config").json() == {"password_reset": False}
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    assert client.get("/api/auth/config").json() == {"password_reset": True}


def test_mailer_without_key_sends_nothing_and_logs_link_outside_production(monkeypatch, caplog):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.setattr(mailer.requests, "post", lambda *a, **k: pytest.fail("must not call Resend"))

    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "staging")
    with caplog.at_level("INFO", logger="app.services.mailer"):
        assert mailer.send_password_reset("a@example.test", "https://x/reset-password?token=abc") is False
    assert "token=abc" in caplog.text

    caplog.clear()
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")
    with caplog.at_level("INFO", logger="app.services.mailer"):
        mailer.send_password_reset("a@example.test", "https://x/reset-password?token=abc")
    assert "token=abc" not in caplog.text


def test_mailer_posts_to_resend(monkeypatch):
    calls = []

    class Ok:
        status_code = 200
        text = "{}"

    def fake_post(url, **kwargs):
        calls.append((url, kwargs))
        return Ok()

    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    monkeypatch.setenv("MAIL_FROM", "HeroMaker <hi@example.test>")
    monkeypatch.setattr(mailer.requests, "post", fake_post)

    assert mailer.send_password_reset("a@example.test", "https://x/reset-password?token=abc") is True
    url, kwargs = calls[0]
    assert url == "https://api.resend.com/emails"
    assert kwargs["headers"]["Authorization"] == "Bearer re_test"
    assert kwargs["json"]["from"] == "HeroMaker <hi@example.test>"
    assert kwargs["json"]["to"] == ["a@example.test"]
    assert "token=abc" in kwargs["json"]["text"] and "token=abc" in kwargs["json"]["html"]
    assert "verify" not in kwargs
