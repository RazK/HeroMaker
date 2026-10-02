"""
Sign in with Google: POST /api/auth/google and GET /api/auth/config.

These drive the real endpoint and the real account matching. Only Google's
signature check is replaced - `id_token.verify_oauth2_token` as our service
module calls it - so everything from the audience we pass to the row we write
is the production code path.
"""
import pytest
from fastapi.testclient import TestClient

from app.models import User
from app.services import google_auth
from app.services.auth import verify_access_token

CLIENT_ID = "1234-test.apps.googleusercontent.com"


@pytest.fixture
def client():
    from app.main import app
    return TestClient(app)


@pytest.fixture
def google(monkeypatch):
    """A fake Google: maps credential strings to the claims they carry."""
    monkeypatch.setenv("GOOGLE_CLIENT_ID", CLIENT_ID)
    tokens = {}
    calls = []

    def fake_verify(credential, request, audience, clock_skew_in_seconds=0):
        calls.append(audience)
        if credential not in tokens:
            raise ValueError("Could not verify token signature.")
        return tokens[credential]

    monkeypatch.setattr(google_auth.id_token, "verify_oauth2_token", fake_verify)

    def issue(credential, sub, email, name="Ada Lovelace", verified=True):
        tokens[credential] = {
            "iss": "https://accounts.google.com",
            "aud": CLIENT_ID,
            "sub": sub,
            "email": email,
            "email_verified": verified,
            "name": name,
        }
        return credential

    issue.calls = calls
    return issue


def sign_in(client, credential):
    return client.post("/api/auth/google", json={"credential": credential})


def user_id_of(response):
    return verify_access_token(response.json()["access_token"])


def test_config_reports_client_id(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", CLIENT_ID)
    assert client.get("/api/auth/config").json()["google_client_id"] == CLIENT_ID


def test_config_reports_null_when_unset(client, monkeypatch):
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    assert client.get("/api/auth/config").json()["google_client_id"] is None


def test_new_user_is_created(client, google, db):
    r = sign_in(client, google("tok", sub="g-1", email="Ada@Example.com"))

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["token_type"] == "bearer"
    assert body["user"]["username"] == "ada"
    assert body["user"]["email"] == "ada@example.com"
    assert body["user"]["name"] == "Ada Lovelace"
    assert body["user"]["credits"] == 0
    # The token is verified against OUR client id, not whatever it claims.
    assert google.calls == [CLIENT_ID]

    user = db.query(User).one()
    assert user.google_id == "g-1"
    assert user.password_hash is None
    assert user_id_of(r) == user.id


def test_existing_email_is_linked_not_duplicated(client, google, db):
    signup = client.post("/api/auth/signup", json={
        "username": "lovelace", "email": "ada@example.com", "password": "secret123",
        "name": "Ada", "date_of_birth": "1990-12-10",
    })
    assert signup.status_code == 201, signup.text
    existing_id = signup.json()["user"]["id"]

    r = sign_in(client, google("tok", sub="g-1", email="ADA@example.com"))

    assert r.status_code == 200, r.text
    assert r.json()["user"]["id"] == existing_id
    assert r.json()["user"]["username"] == "lovelace"
    assert user_id_of(r) == existing_id
    db.expire_all()
    assert db.query(User).count() == 1
    user = db.query(User).one()
    assert user.google_id == "g-1"
    # Linking does not take the password away.
    assert user.password_hash
    login = client.post("/api/auth/login", json={"username": "lovelace", "password": "secret123"})
    assert login.status_code == 200


def test_returning_google_id_signs_in(client, google, db):
    first = sign_in(client, google("tok1", sub="g-1", email="ada@example.com"))
    # Same Google account, even after the address changed at Google.
    again = sign_in(client, google("tok2", sub="g-1", email="ada.new@example.com"))

    assert again.status_code == 200, again.text
    assert again.json()["user"]["id"] == first.json()["user"]["id"]
    assert db.query(User).count() == 1


def test_unverified_email_is_rejected(client, google, db, make_user):
    victim = make_user(username="victim")
    r = sign_in(client, google("tok", sub="g-evil", email=victim.email, verified=False))

    assert r.status_code == 401
    db.expire_all()
    assert db.query(User).filter(User.google_id == "g-evil").count() == 0
    assert db.get(User, victim.id).google_id is None


def test_bad_token_is_401(client, google, db):
    r = sign_in(client, "not-a-real-token")
    assert r.status_code == 401
    assert db.query(User).count() == 0


def test_unset_client_id_is_503(client, monkeypatch, db):
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)

    def must_not_run(*a, **kw):
        raise AssertionError("verified a token with no audience configured")

    monkeypatch.setattr(google_auth.id_token, "verify_oauth2_token", must_not_run)
    r = sign_in(client, "anything")
    assert r.status_code == 503
    assert db.query(User).count() == 0


def test_username_collisions_are_resolved(client, google, make_user):
    make_user(username="ada")
    make_user(username="ada2")

    r = sign_in(client, google("tok", sub="g-1", email="ada@gmail.com"))
    assert r.status_code == 200, r.text
    assert r.json()["user"]["username"] == "ada3"

    r = sign_in(client, google("tok2", sub="g-2", email="ada@other.example"))
    assert r.json()["user"]["username"] == "ada4"


def test_email_linked_to_other_google_account_is_refused(client, google, db):
    sign_in(client, google("tok1", sub="g-1", email="ada@example.com"))
    r = sign_in(client, google("tok2", sub="g-2", email="ada@example.com"))

    assert r.status_code == 409
    db.expire_all()
    assert db.query(User).one().google_id == "g-1"
