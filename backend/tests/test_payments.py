"""
Tests for buying credits.

The two things that must not be wrong are here:

  * an unsigned or wrongly-signed webhook grants nothing
  * the same webhook delivered twice grants credits once

Everything else in payments.py is plumbing. These two are the difference
between a business and a giveaway.
"""
import hashlib
import hmac
import json

import pytest
from fastapi.testclient import TestClient

from app.config import packs as packs_config
from app.services import ledger, lemonsqueezy

WEBHOOK_SECRET = "test-webhook-secret"


@pytest.fixture
def configured(monkeypatch):
    """A fully configured store, pointed at nothing real."""
    monkeypatch.setenv("LEMONSQUEEZY_API_KEY", "test-api-key")
    monkeypatch.setenv("LEMONSQUEEZY_STORE_ID", "12345")
    monkeypatch.setenv("LEMONSQUEEZY_WEBHOOK_SECRET", WEBHOOK_SECRET)
    monkeypatch.setenv("LEMONSQUEEZY_TEST_MODE", "true")
    for pack in ("starter", "maker", "studio"):
        monkeypatch.setenv(f"LEMONSQUEEZY_VARIANT_{pack.upper()}", f"variant-{pack}")


@pytest.fixture
def client():
    from app.main import app
    return TestClient(app)


def balance(user_id, db):
    """
    This user's balance, read fresh.

    The webhook ran on the request's own session, so the test's session still
    has the pre-purchase User cached. Expiring it first is the difference
    between reading the database and reading our own stale copy.
    """
    db.expire_all()
    cached = ledger.get_balance(user_id, db)
    summed = ledger.get_ledger_balance(user_id, db)
    assert cached == summed, (
        f"cached balance {cached} disagrees with the ledger sum {summed}"
    )
    return cached


def order_body(order_id, user_id, pack="maker", event="order_created", status="paid", total_usd=1500):
    return {
        "meta": {
            "event_name": event,
            "custom_data": {"user_id": str(user_id), "pack": pack},
        },
        "data": {
            "type": "orders",
            "id": str(order_id),
            "attributes": {
                "order_number": 1001,
                "status": status,
                "total": total_usd,
                "total_usd": total_usd,
                "currency": "USD",
                "user_email": "buyer@example.test",
                "refunded": event == "order_refunded",
                "test_mode": True,
            },
        },
    }


def signed(body: dict):
    raw = json.dumps(body).encode("utf-8")
    sig = hmac.new(WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    return raw, {"X-Signature": sig, "Content-Type": "application/json"}


# --------------------------------------------------------------------------
# The pack table
# --------------------------------------------------------------------------

def test_every_pack_clears_the_margin_floor():
    assert packs_config.check_packs() == []


def test_credit_cost_is_derived_not_declared():
    # One hero's provider cost, divided over the credits a hero is charged.
    cost = packs_config.creation_cost_usd_micros()
    credits = packs_config.creation_credit_price()
    assert packs_config.credit_cost_usd_micros() == -(-cost // credits)


def test_bigger_packs_are_better_value():
    ordered = sorted(packs_config.get_packs(), key=lambda p: p["price_usd_micros"])
    per_credit = [p["margin"]["price_per_credit_usd_micros"] for p in ordered]
    assert per_credit == sorted(per_credit, reverse=True)


def test_processor_fee_rounds_against_us():
    # $5.00 -> 5% is exactly 25c, plus the 50c fixed fee.
    assert packs_config.processor_fee_usd_micros(5_000_000) == 750_000
    # A price whose 5% does not divide evenly rounds UP, never down.
    assert packs_config.processor_fee_usd_micros(1) == 500_001


def test_unconfigured_packs_are_hidden_from_customers(monkeypatch):
    monkeypatch.delenv("LEMONSQUEEZY_VARIANT_STARTER", raising=False)
    monkeypatch.delenv("LEMONSQUEEZY_VARIANT_MAKER", raising=False)
    monkeypatch.delenv("LEMONSQUEEZY_VARIANT_STUDIO", raising=False)
    assert packs_config.get_packs(include_unconfigured=False) == []
    assert len(packs_config.get_packs(include_unconfigured=True)) == 3


# --------------------------------------------------------------------------
# Signature verification
# --------------------------------------------------------------------------

def test_signature_accepts_the_real_thing(configured):
    raw, headers = signed(order_body("o1", "u1"))
    assert lemonsqueezy.verify_signature(raw, headers["X-Signature"]) is True


def test_signature_rejects_a_tampered_body(configured):
    raw, headers = signed(order_body("o1", "u1"))
    tampered = raw.replace(b'"maker"', b'"studio"')
    assert lemonsqueezy.verify_signature(tampered, headers["X-Signature"]) is False


def test_signature_rejects_a_missing_header(configured):
    raw, _ = signed(order_body("o1", "u1"))
    assert lemonsqueezy.verify_signature(raw, None) is False


def test_signature_rejects_everything_when_no_secret_is_set(monkeypatch):
    """An unconfigured endpoint must be closed, not open."""
    monkeypatch.delenv("LEMONSQUEEZY_WEBHOOK_SECRET", raising=False)
    raw, headers = signed(order_body("o1", "u1"))
    assert lemonsqueezy.verify_signature(raw, headers["X-Signature"]) is False


def test_webhook_endpoint_rejects_an_unsigned_post(configured, client, make_user, db):
    user = make_user(credits=0)
    body = order_body("o1", user.id)
    response = client.post("/api/payments/webhook", json=body)
    assert response.status_code == 401
    assert balance(user.id, db) == 0


# --------------------------------------------------------------------------
# Money becoming credits
# --------------------------------------------------------------------------

def test_a_paid_order_grants_the_pack_credits(configured, client, make_user, db):
    user = make_user(credits=0)
    raw, headers = signed(order_body("order-1", user.id, pack="maker"))

    response = client.post("/api/payments/webhook", content=raw, headers=headers)

    assert response.status_code == 200, response.text
    assert response.json()["credits_granted"] == 100
    assert balance(user.id, db) == 100


def test_the_same_order_delivered_twice_grants_credits_once(configured, client, make_user, db):
    """Lemon Squeezy WILL deliver twice. This is the guard that matters most."""
    user = make_user(credits=0)
    raw, headers = signed(order_body("order-dup", user.id, pack="starter"))

    first = client.post("/api/payments/webhook", content=raw, headers=headers)
    second = client.post("/api/payments/webhook", content=raw, headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert balance(user.id, db) == 30
    purchases = [t for t in ledger.list_transactions(user.id, db) if t.reason == "purchase"]
    assert len(purchases) == 1


def test_an_unpaid_order_grants_nothing(configured, client, make_user, db):
    user = make_user(credits=0)
    raw, headers = signed(order_body("order-pending", user.id, status="pending"))
    response = client.post("/api/payments/webhook", content=raw, headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "ignored"
    assert balance(user.id, db) == 0


def test_an_order_with_no_custom_data_grants_nothing(configured, client, make_user, db):
    """A checkout opened from the storefront: we have no idea whose it is."""
    user = make_user(credits=0)
    body = order_body("order-orphan", user.id)
    body["meta"]["custom_data"] = {}
    raw, headers = signed(body)
    response = client.post("/api/payments/webhook", content=raw, headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "ignored"
    assert balance(user.id, db) == 0


def test_an_order_for_an_unknown_user_is_not_a_retry_loop(configured, client):
    raw, headers = signed(order_body("order-ghost", "no-such-user"))
    response = client.post("/api/payments/webhook", content=raw, headers=headers)
    # 200, not 4xx: retrying will never make this user exist.
    assert response.status_code == 200
    assert response.json()["status"] == "ignored"


def test_a_refund_does_not_silently_claw_back_credits(configured, client, make_user, db):
    user = make_user(credits=0)
    raw, headers = signed(order_body("order-refund", user.id, pack="maker"))
    client.post("/api/payments/webhook", content=raw, headers=headers)
    assert balance(user.id, db) == 100

    raw, headers = signed(order_body("order-refund", user.id, event="order_refunded"))
    response = client.post("/api/payments/webhook", content=raw, headers=headers)

    assert response.status_code == 200
    assert response.json()["status"] == "logged"
    assert balance(user.id, db) == 100


def test_an_unhandled_event_is_acknowledged(configured, client):
    raw, headers = signed(order_body("sub-1", "u1", event="subscription_updated"))
    response = client.post("/api/payments/webhook", content=raw, headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "ignored"


def test_a_malformed_body_is_rejected(configured, client):
    body = {"data": {"id": "x"}}  # no meta.event_name
    raw, headers = signed(body)
    response = client.post("/api/payments/webhook", content=raw, headers=headers)
    assert response.status_code == 400


# --------------------------------------------------------------------------
# The storefront
# --------------------------------------------------------------------------

def test_packs_endpoint_lists_configured_packs_only(configured, client, monkeypatch):
    monkeypatch.delenv("LEMONSQUEEZY_VARIANT_STUDIO", raising=False)
    slugs = [p["slug"] for p in client.get("/api/payments/packs").json()]
    assert slugs == ["starter", "maker"]


def test_packs_endpoint_never_leaks_our_margins(configured, client):
    body = client.get("/api/payments/packs").text
    assert "margin" not in body
    assert "cost" not in body


def test_checkout_requires_a_signed_in_user(configured, client):
    response = client.post("/api/payments/checkout", json={"pack": "maker"})
    assert response.status_code == 401
