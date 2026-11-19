"""The grown-up check: "Is a grown-up with you?" before the sign-in sheet.

The app asks once per browser; a "Yes" is kept with the account when it signs
in (POST /api/v1/me/adult-confirmed): the first time only, never moved, and a
time the browser claims is believed only within the last month.
"""
from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.migrations import m021_user_adult_confirmed
from app.services import analytics
from app.services.auth import create_access_token

URL = "/api/v1/me/adult-confirmed"


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _at(response):
    return datetime.fromisoformat(response.json()["adult_confirmed_at"])


def test_it_needs_a_signed_in_account():
    assert TestClient(app).post(URL, json={}).status_code == 401


def test_the_first_yes_is_kept_and_shown_on_the_account(make_user):
    client = TestClient(app)
    user = make_user()
    assert client.get("/api/v1/me", headers=_auth(user)).json()["adult_confirmed_at"] is None

    tapped = datetime.utcnow() - timedelta(minutes=3)
    r = client.post(URL, json={"confirmed_at": tapped.isoformat() + "Z"}, headers=_auth(user))
    assert r.status_code == 200, r.text
    assert abs((_at(r) - tapped).total_seconds()) < 1

    # A later Yes (another browser, another day) does not move it.
    later = client.post(URL, json={"confirmed_at": datetime.utcnow().isoformat()}, headers=_auth(user))
    assert _at(later) == _at(r)
    assert client.get("/api/v1/me", headers=_auth(user)).json()["adult_confirmed_at"] == r.json()["adult_confirmed_at"]


def test_a_time_from_the_future_or_long_ago_is_not_believed(make_user):
    client = TestClient(app)
    for claimed in (datetime.utcnow() + timedelta(days=2), datetime.utcnow() - timedelta(days=400), None):
        user = make_user()
        before = datetime.utcnow()
        body = {"confirmed_at": claimed.isoformat()} if claimed else {}
        at = _at(client.post(URL, json=body, headers=_auth(user)))
        assert before - timedelta(seconds=1) <= at <= datetime.utcnow() + timedelta(seconds=1)


def test_the_answer_is_an_allowed_event_and_nothing_else_is(monkeypatch):
    monkeypatch.setenv(analytics.ENV_FLAG, "true")
    assert analytics.clean_props(analytics.BROWSER_EVENTS, "adult_confirmed", {"answer": "yes"}) == {"answer": "yes"}
    assert analytics.clean_props(analytics.BROWSER_EVENTS, "adult_confirmed", {"answer": "not_yet"}) == {"answer": "not_yet"}
    for bad in ({"answer": "maybe"}, {"answer": "yes", "age": 41}, {"answer": "Yes, I am Maya's mum"}):
        try:
            analytics.clean_props(analytics.BROWSER_EVENTS, "adult_confirmed", bad)
        except ValueError:
            continue
        raise AssertionError(f"{bad} was allowed")


def test_migration_adds_the_column_to_an_existing_database(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/old.db")
    s = sessionmaker(bind=engine)()
    s.execute(text("CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT)"))
    s.commit()
    m021_user_adult_confirmed.migrate(s)
    m021_user_adult_confirmed.migrate(s)    # idempotent
    assert "adult_confirmed_at" in {c["name"] for c in inspect(engine).get_columns("users")}
