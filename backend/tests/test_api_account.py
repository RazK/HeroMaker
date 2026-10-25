"""The account on /api/v1: sign-in, profile, credits, coupons. Same code as
the old routes; what is new is who may call them (scope "app")."""
from fastapi.testclient import TestClient

from test_public_api import _bearer, _jwt, _key, client  # noqa: F401


def test_signup_login_me_and_logout(client):
    r = client.post("/api/v1/signup", json={"username": "newbie", "email": "newbie@example.test", "password": "longenough1",
                                           "name": "New Bie", "date_of_birth": "1990-01-01"})
    assert r.status_code == 201, r.text
    token = client.post("/api/v1/login", json={"username": "newbie", "password": "longenough1"}).json()["access_token"]
    me = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"}).json()
    assert me["username"] == "newbie" and "password_hash" not in me
    assert client.post("/api/v1/logout").status_code == 200
    assert client.post("/api/v1/login", json={"username": "newbie", "password": "wrong-one"}).status_code == 401


def test_profile_update(client, make_user):
    user = make_user()
    r = client.patch("/api/v1/me", headers=_jwt(user), json={"name": "Renamed"})
    assert r.status_code == 200 and r.json()["name"] == "Renamed"


def test_a_key_cannot_touch_the_account(client, make_user):
    user = make_user(credits=50)
    key = _bearer(_key(client, user)["key"])
    assert client.get("/api/v1/me", headers=key).status_code == 403
    assert client.patch("/api/v1/me", headers=key, json={"name": "Hijacked"}).status_code == 403
    assert client.request("DELETE", "/api/v1/me", headers=key, json={"confirm": user.username}).status_code == 403
    assert client.post("/api/v1/checkout", headers=key, json={"pack": "starter"}).status_code == 403
    assert client.get("/api/v1/receipts", headers=key).status_code == 403
    assert client.post("/api/v1/coupons/redeem", headers=key, json={"code": "HERO-X"}).status_code == 403
    # It may still read its credits.
    assert client.get("/api/v1/account", headers=key).json()["credits"] == 50


def test_packs_are_public_and_carry_no_margin(client):
    r = client.get("/api/v1/packs")
    assert r.status_code == 200
    for p in r.json():
        assert not any("margin" in k or "cost" in k for k in p), p


def test_receipts_and_auth_config(client, make_user):
    user = make_user()
    assert client.get("/api/v1/receipts", headers=_jwt(user)).json() == []
    cfg = client.get("/api/v1/auth/config").json()
    assert set(cfg) >= {"password_reset", "google_client_id"}


def test_forgot_password_never_says_who_has_an_account(client):
    r = client.post("/api/v1/password/forgot", json={"email": "nobody@example.test"})
    assert r.status_code == 200 and "If that email has an account" in r.json()["message"]


def test_bad_coupon(client, make_user):
    r = client.post("/api/v1/coupons/redeem", headers=_jwt(make_user()), json={"code": "HERO-NOPE"})
    assert r.status_code in (400, 404)


def test_a_coupon_credits_the_account_once(client, db, make_user):
    from app.models import Coupon

    db.add(Coupon(code="HERO-WELCOME", credit_amount=20))
    db.commit()
    user = make_user(credits=5)
    r = client.post("/api/v1/coupons/redeem", headers=_jwt(user), json={"code": "HERO-WELCOME"})
    assert r.status_code == 200, r.text
    assert (r.json()["credits_added"], r.json()["new_balance"]) == (20, 25)
    assert client.get("/api/v1/account", headers=_jwt(user)).json()["credits"] == 25
    again = client.post("/api/v1/coupons/redeem", headers=_jwt(user), json={"code": "HERO-WELCOME"})
    assert again.status_code == 400
    assert client.get("/api/v1/account", headers=_jwt(user)).json()["credits"] == 25


def test_delete_my_account(client, make_user):
    user = make_user()
    assert client.request("DELETE", "/api/v1/me", headers=_jwt(user), json={"confirm": user.username}).status_code == 204
    assert client.get("/api/v1/me", headers=_jwt(user)).status_code == 401
