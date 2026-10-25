"""The pre-v1 routes are gone: every client calls /api/v1.

What stays outside /api/v1 is not a client's API: the files (their URLs are in
every hero), health and version, the MCP server, and Lemon Squeezy's webhook,
which the store is configured to call at /api/payments/webhook. Removing that
one would lose every purchase silently, so it is checked here too.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.auth import create_access_token

GONE = [
    ("GET", "/api/creations/"),
    ("GET", "/api/creations/some-id"),
    ("POST", "/api/creations/create"),
    ("POST", "/api/creations/some-id/run-pipeline"),
    ("POST", "/api/creations/some-id/steps/openai_render/run"),
    ("POST", "/api/creations/some-id/steps/openai_render/cancel"),
    ("GET", "/api/creations/some-id/steps/openai_render"),
    ("PUT", "/api/creations/some-id/featured"),
    ("DELETE", "/api/creations/some-id"),
    ("GET", "/api/creations/cost"),
    ("GET", "/api/creations/steps/config"),
    ("GET", "/api/creations/estimates"),
    ("POST", "/api/auth/signup"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/google"),
    ("GET", "/api/auth/config"),
    ("GET", "/api/auth/me"),
    ("POST", "/api/auth/forgot-password"),
    ("POST", "/api/auth/reset-password"),
    ("GET", "/api/payments/packs"),
    ("POST", "/api/payments/checkout"),
    ("GET", "/api/payments/receipts"),
    ("POST", "/api/coupons/redeem"),
    ("GET", "/api/styles"),
    ("GET", "/api/admin/users"),
    ("GET", "/api/classes"),
    ("GET", "/api/classes/some-id/stage"),
    ("GET", "/api/class/join/123456"),
]


@pytest.mark.parametrize("method,path", GONE)
def test_an_old_route_is_not_found(method, path, make_user):
    admin = make_user(is_admin=True)
    r = TestClient(app).request(method, path, headers={"Authorization": f"Bearer {create_access_token(admin.id)}"})
    # No route at all, not a route that looked and found nothing.
    assert (r.status_code, r.json()) == (404, {"detail": "Not Found"}), (method, path, r.text)


def test_no_old_route_is_mounted():
    old = ("/api/creations", "/api/auth", "/api/coupons", "/api/admin", "/api/styles", "/api/classes",
           "/api/class/", "/api/payments/packs", "/api/payments/checkout", "/api/payments/receipts")
    paths = set(app.openapi()["paths"])
    assert "/api/v1/heroes" in paths     # the listing is the app's whole surface
    assert not [p for p in paths if p.startswith(old)]
    assert [p for p in paths if p.startswith("/api/payments")] == ["/api/payments/webhook"]


def test_the_lemon_squeezy_webhook_is_still_there(monkeypatch):
    """An unsigned delivery is refused (401), not lost to a 404."""
    monkeypatch.setenv("LEMONSQUEEZY_WEBHOOK_SECRET", "test-webhook-secret")
    r = TestClient(app).post("/api/payments/webhook", json={"meta": {"event_name": "order_created"}})
    assert r.status_code == 401, r.text


def test_their_v1_addresses_answer(make_user):
    user = make_user()
    auth = {"Authorization": f"Bearer {create_access_token(user.id)}"}
    client = TestClient(app)
    assert client.get("/api/v1/gallery?view=featured").status_code == 200
    assert client.get("/api/v1/me", headers=auth).status_code == 200
    assert client.get("/api/v1/auth/config").status_code == 200
    assert client.get("/api/v1/packs").status_code == 200
    assert client.get("/api/v1/receipts", headers=auth).status_code == 200
    assert client.get("/api/v1/styles").status_code == 200
    assert client.get("/api/v1/estimates").status_code == 200
    assert client.get("/api/v1/classes", headers=auth).status_code == 200
