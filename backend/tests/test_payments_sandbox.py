"""
grow_sandbox: our own test mode for payments, through the real code path.

The sandbox fakes ONE thing, Grow's hosted card page. Everything after the
Pay button is the product's own code: a signed callback, verified by
payments.handle_grow_callback, granting through ledger.record_purchase or
classes.grant_bought_seats, with a receipt on GET /api/v1/receipts. These
drive it through TestClient, the way a buyer and Grow would.

What must not be wrong, as for Lemon Squeezy (test_payments.py):

  * the browser never says a payment happened: Pay makes the SERVER sign a
    callback; a forged or unsigned callback grants nothing (401)
  * the same transaction delivered twice credits once
  * what was bought and what it costs come from OUR stored order: a callback
    whose sum differs grants nothing, and class seats are priced from the
    order, never from anything the callback carries
  * Fail grants nothing
  * production never arms the sandbox, and the default provider is unchanged
"""
import hashlib
import hmac
import json
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient

from app.config import packs as packs_config
from app.models import CheckoutOrder, ClassRoom, CreditTransaction, Payment
from app.services import grow_sandbox, ledger, payments_provider
from app.services.auth import create_access_token

SECRET = "test-sandbox-secret"
FRONTEND = "https://app.test"
HERO = packs_config.creation_credit_price()
CALLBACK = "/api/payments/grow/callback"


@pytest.fixture
def sandbox(monkeypatch):
    """PAYMENTS_PROVIDER=grow_sandbox, armed, on a staging-like deployment."""
    monkeypatch.setenv("PAYMENTS_PROVIDER", "grow_sandbox")
    monkeypatch.setenv("GROW_SANDBOX_SECRET", SECRET)
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "staging")
    monkeypatch.setenv("FRONTEND_URL", FRONTEND)
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)


@pytest.fixture
def client():
    from app.main import app
    return TestClient(app)


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _balance(db, user_id):
    db.expire_all()
    cached, summed = ledger.get_balance(user_id, db), ledger.get_ledger_balance(user_id, db)
    assert cached == summed, f"cached balance {cached} disagrees with the ledger sum {summed}"
    return cached


def _order(db, url) -> CheckoutOrder:
    """The stored order a checkout URL points at."""
    db.expire_all()
    order_id = urlsplit(url).path.rsplit("/", 1)[-1]
    return db.query(CheckoutOrder).filter(CheckoutOrder.id == order_id).one()


def _checkout(client, user, pack, redirect_url=f"{FRONTEND}/?purchased=1"):
    r = client.post("/api/v1/checkout", json={"pack": pack, "redirect_url": redirect_url}, headers=_auth(user))
    assert r.status_code == 200, r.text
    return r.json()


def _path(url):
    return urlsplit(url).path


def _signed(raw: bytes, secret=SECRET):
    sig = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return {grow_sandbox.SIGNATURE_HEADER: sig, "Content-Type": "application/json"}


def _body(order_id, transaction_id, sum_ils, status_code="2", **custom):
    return json.dumps({
        "status": "1", "err": "",
        "data": {"transactionId": transaction_id, "processId": order_id, "sum": sum_ils,
                 "statusCode": status_code, "customFields": {"cField1": order_id, **custom}},
    }).encode()


# --------------------------------------------------------------------------
# What is on sale
# --------------------------------------------------------------------------

def test_the_shekel_products_are_listed(sandbox, client):
    packs = client.get("/api/v1/packs").json()
    assert [(p["slug"], p["price_display"], p["price_cents"], p["credits"], p["heroes"], p["currency"])
            for p in packs] == [
        ("single", "₪10", 1000, HERO, 1, "ILS"),
        ("family", "₪39", 3900, 5 * HERO, 5, "ILS"),
    ]
    assert "margin" not in client.get("/api/v1/packs").text


def test_credits_follow_the_price_of_a_hero(sandbox, client, monkeypatch):
    """"One hero" is one hero's credits, whatever a hero costs."""
    monkeypatch.setattr(packs_config, "creation_credit_price", lambda: 12)
    assert [p["credits"] for p in client.get("/api/v1/packs").json()] == [12, 60]


def test_the_class_price_is_ten_shekels_a_child(sandbox, client, make_user):
    price = client.get("/api/v1/classes", headers=_auth(make_user())).json()["seat_price"]
    assert price == {"order_cents": 0, "seat_cents": 1000, "max_seats": 60, "min_seats": 10,
                     "currency": "ILS", "seat_display": "₪10"}


def test_agorot_are_shown_the_way_a_customer_reads_them():
    assert packs_config.agorot_display(1000) == "₪10"
    assert packs_config.agorot_display(3950) == "₪39.50"
    assert packs_config.agorot_display(5) == "₪0.05"


# --------------------------------------------------------------------------
# Paying
# --------------------------------------------------------------------------

def test_a_checkout_stores_our_order_and_grants_nothing(sandbox, client, make_user, db):
    user = make_user(credits=0)
    out = _checkout(client, user, "family")
    assert out["checkout_url"].startswith(f"{FRONTEND}/api/payments/sandbox/checkout/")
    assert out["test_mode"] is True and out["price_display"] == "₪39"

    order = _order(db, out["checkout_url"])
    assert (order.user_id, order.kind, order.product, order.credits, order.amount_minor, order.currency,
            order.status) == (user.id, "pack", "family", 5 * HERO, 3900, "ILS", "pending")

    page = client.get(_path(out["checkout_url"]))
    assert page.status_code == 200
    assert "TEST &mdash; no real money" in page.text and "₪39" in page.text
    assert f'action="/api/payments/sandbox/checkout/{order.id}/pay"' in page.text
    assert _balance(db, user.id) == 0


def test_pay_credits_the_product_once(sandbox, client, make_user, db):
    user = make_user(credits=0)
    url = _checkout(client, user, "family")["checkout_url"]

    r = client.post(_path(url) + "/pay", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == f"{FRONTEND}/?purchased=1"
    assert _balance(db, user.id) == 5 * HERO

    order = _order(db, url)
    assert order.status == "paid" and order.transaction_id.startswith("sbx-")
    tx = db.query(CreditTransaction).filter(CreditTransaction.reason == "purchase").one()
    assert tx.external_ref == f"grow_sandbox:tx:{order.transaction_id}"
    pay = db.query(Payment).one()
    assert (pay.provider, pay.provider_ref, pay.status) == ("grow_sandbox", tx.external_ref, "succeeded")
    assert pay.metadata_json["amount_minor"] == 3900 and pay.metadata_json["currency"] == "ILS"

    # Pay pressed again (a double tap, the back button): nothing more.
    assert client.post(_path(url) + "/pay", follow_redirects=False).status_code == 303
    assert _balance(db, user.id) == 5 * HERO
    assert "This order is paid." in client.get(_path(url)).text

    receipts = client.get("/api/v1/receipts", headers=_auth(user)).json()
    assert [(x["pack"], x["credits"], x["paid_display"], x["test_mode"]) for x in receipts] == [
        ("family", 5 * HERO, "₪39", True)]


def test_a_forged_or_unsigned_callback_grants_nothing(sandbox, client, make_user, db):
    user = make_user(credits=0)
    order = _order(db, _checkout(client, user, "single")["checkout_url"])
    raw = _body(order.id, "tx-forged", "10.00")

    assert client.post(CALLBACK, content=raw, headers={"Content-Type": "application/json"}).status_code == 401
    assert client.post(CALLBACK, content=raw, headers=_signed(raw, secret="not-the-secret")).status_code == 401
    tampered = _signed(_body(order.id, "tx-forged", "1.00"))   # signed for another body
    assert client.post(CALLBACK, content=raw, headers=tampered).status_code == 401

    assert _balance(db, user.id) == 0
    assert _order(db, f"/{order.id}").status == "pending"
    assert db.query(Payment).count() == 0


def test_the_same_transaction_twice_credits_once(sandbox, client, make_user, db):
    user = make_user(credits=0)
    order = _order(db, _checkout(client, user, "single")["checkout_url"])
    raw = grow_sandbox.callback_body(order, "tx-twice")

    first = client.post(CALLBACK, content=raw, headers=_signed(raw))
    second = client.post(CALLBACK, content=raw, headers=_signed(raw))
    assert first.status_code == second.status_code == 200
    assert first.json()["status"] == second.json()["status"] == "ok"
    assert _balance(db, user.id) == HERO
    assert db.query(CreditTransaction).filter(CreditTransaction.reason == "purchase").count() == 1
    assert db.query(Payment).count() == 1

    # A different transaction for the order already paid: nothing.
    other = grow_sandbox.callback_body(order, "tx-another")
    assert client.post(CALLBACK, content=other, headers=_signed(other)).json()["status"] == "ignored"
    assert _balance(db, user.id) == HERO


def test_a_sum_that_differs_from_our_order_grants_nothing(sandbox, client, make_user, db):
    """The callback says what was paid; our order says what it costs."""
    user = make_user(credits=0)
    order = _order(db, _checkout(client, user, "family")["checkout_url"])
    for sum_ils in ("10.00", "38.99", "390.00"):
        raw = _body(order.id, f"tx-{sum_ils}", sum_ils)
        r = client.post(CALLBACK, content=raw, headers=_signed(raw))
        assert r.status_code == 200 and r.json() == {"status": "ignored", "reason": "sum does not match the order"}
    assert _balance(db, user.id) == 0
    assert _order(db, f"/{order.id}").status == "pending"


def test_an_unpaid_or_unknown_order_grants_nothing(sandbox, client, make_user, db):
    user = make_user(credits=0)
    order = _order(db, _checkout(client, user, "single")["checkout_url"])
    raw = _body(order.id, "tx-declined", "10.00", status_code="3")
    assert client.post(CALLBACK, content=raw, headers=_signed(raw)).json()["status"] == "ignored"
    raw = _body("no-such-order", "tx-ghost", "10.00")
    assert client.post(CALLBACK, content=raw, headers=_signed(raw)).json()["reason"] == "unknown order"
    raw = b'{"data": {}}'
    assert client.post(CALLBACK, content=raw, headers=_signed(raw)).status_code == 400
    assert _balance(db, user.id) == 0


def test_fail_grants_nothing(sandbox, client, make_user, db):
    user = make_user(credits=0)
    url = _checkout(client, user, "family")["checkout_url"]

    r = client.post(_path(url) + "/fail", follow_redirects=False)
    assert r.status_code == 303
    assert parse_qs(urlsplit(r.headers["location"]).query) == {"purchased": ["1"], "checkout": ["failed"]}
    assert _order(db, url).status == "failed"

    # Pay after Fail, or a signed callback for the failed order: still nothing.
    client.post(_path(url) + "/pay", follow_redirects=False)
    order = _order(db, url)
    raw = grow_sandbox.callback_body(order, "tx-after-fail")
    assert client.post(CALLBACK, content=raw, headers=_signed(raw)).json()["status"] == "ignored"
    assert _balance(db, user.id) == 0
    assert db.query(Payment).count() == 0


def test_the_page_sends_the_buyer_only_back_to_our_site(sandbox, client, make_user, db):
    url = _checkout(client, make_user(), "single", redirect_url="https://evil.example/steal")["checkout_url"]
    r = client.post(_path(url) + "/pay", follow_redirects=False)
    assert r.headers["location"] == f"{FRONTEND}/"


# --------------------------------------------------------------------------
# Class seats
# --------------------------------------------------------------------------

def _buy_class(client, teacher, seats):
    return client.post("/api/v1/classes/buy", json={"title": "Grade 2B", "seats": seats,
                                                   "redirect_url": f"{FRONTEND}/?class_paid={{class_id}}"},
                       headers=_auth(teacher))


def test_class_seats_are_priced_from_our_order(sandbox, client, make_user, db):
    teacher = make_user(credits=7)
    r = _buy_class(client, teacher, 12)
    assert r.status_code == 201, r.text
    out = r.json()
    assert (out["seats"], out["price_cents"], out["price_display"]) == (12, 12_000, "₪120")
    order = _order(db, out["checkout_url"])
    assert (order.kind, order.class_id, order.seats, order.amount_minor) == ("class_seats", out["class_id"], 12, 12_000)

    # A callback that claims 60 seats, priced for 60: not what was ordered.
    raw = _body(order.id, "tx-60", "600.00", cField2="60", seats="60")
    assert client.post(CALLBACK, content=raw, headers=_signed(raw)).json()["status"] == "ignored"
    # Paid for the 12 ordered, with "60" in its custom fields: 12 seats.
    raw = _body(order.id, "tx-12", "120.00", cField2="60", seats="60")
    r = client.post(CALLBACK, content=raw, headers=_signed(raw))
    assert r.json()["seats_granted"] == 12, r.text

    db.expire_all()
    room = db.query(ClassRoom).filter(ClassRoom.id == out["class_id"]).one()
    assert room.seats == 12
    assert _balance(db, room.wallet_user_id) == 12 * HERO
    assert _balance(db, teacher.id) == 7     # never the teacher's balance
    receipts = client.get("/api/v1/receipts", headers=_auth(teacher)).json()
    assert [(x["class_title"], x["seats"], x["paid_display"]) for x in receipts] == [("Grade 2B", 12, "₪120")]


def test_class_seats_through_the_pay_button(sandbox, client, make_user, db):
    teacher = make_user()
    out = _buy_class(client, teacher, 10).json()
    r = client.post(_path(out["checkout_url"]) + "/pay", follow_redirects=False)
    assert r.headers["location"] == f"{FRONTEND}/?class_paid={out['class_id']}"
    db.expire_all()
    assert db.query(ClassRoom).filter(ClassRoom.id == out["class_id"]).one().seats == 10


def test_a_class_order_is_for_ten_children_at_least(sandbox, client, make_user, db):
    teacher = make_user()
    assert _buy_class(client, teacher, 9).status_code == 400
    assert db.query(ClassRoom).count() == 0 and db.query(CheckoutOrder).count() == 0
    class_id = _buy_class(client, teacher, 10).json()["class_id"]
    more = client.post(f"/api/v1/classes/{class_id}/buy", json={"seats": 2}, headers=_auth(teacher))
    assert more.status_code == 400


# --------------------------------------------------------------------------
# Where the sandbox never runs
# --------------------------------------------------------------------------

@pytest.mark.parametrize("why", ["production", "no secret"])
def test_the_sandbox_refuses_to_arm(sandbox, client, make_user, db, monkeypatch, why):
    teacher = make_user()
    # An order opened while armed, then the deployment is production / unkeyed.
    url = _checkout(client, teacher, "single")["checkout_url"]
    order = _order(db, url)
    raw = grow_sandbox.callback_body(order, "tx-prod")
    headers = _signed(raw)
    if why == "production":
        monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")
    else:
        monkeypatch.delenv("GROW_SANDBOX_SECRET")

    assert payments_provider.can_sell() is False
    assert client.get("/api/v1/packs").json() == []
    assert client.get("/api/v1/classes", headers=_auth(teacher)).json()["seat_price"] is None
    assert client.post("/api/v1/checkout", json={"pack": "single"}, headers=_auth(teacher)).status_code == 503
    assert client.get(_path(url)).status_code == 404
    assert client.post(_path(url) + "/pay").status_code == 404
    assert client.post(_path(url) + "/fail").status_code == 404
    assert client.post(CALLBACK, content=raw, headers=headers).status_code == 404
    assert _balance(db, teacher.id) == 0
    assert _order(db, url).status == "pending"


def test_lemon_squeezy_is_the_default_and_hears_no_grow_callback(client, monkeypatch, make_user, db):
    monkeypatch.delenv("PAYMENTS_PROVIDER", raising=False)
    monkeypatch.setenv("GROW_SANDBOX_SECRET", SECRET)
    assert payments_provider.name() == "lemonsqueezy"
    raw = _body("any", "tx", "10.00")
    assert client.post(CALLBACK, content=raw, headers=_signed(raw)).status_code == 404
    assert client.get("/api/payments/sandbox/checkout/any").status_code == 404


def test_while_the_sandbox_sells_the_lemon_squeezy_webhook_is_closed(sandbox, client, make_user, db, monkeypatch):
    """One provider sells at a time: a correctly signed Lemon Squeezy order
    grants nothing while grow_sandbox is selected."""
    monkeypatch.setenv("LEMONSQUEEZY_WEBHOOK_SECRET", "ls-secret")
    user = make_user(credits=0)
    raw = json.dumps({"meta": {"event_name": "order_created", "custom_data": {"user_id": user.id, "pack": "maker"}},
                      "data": {"id": "o1", "attributes": {"status": "paid", "total_usd": 1500}}}).encode()
    sig = hmac.new(b"ls-secret", raw, hashlib.sha256).hexdigest()
    r = client.post("/api/payments/webhook", content=raw, headers={"X-Signature": sig, "Content-Type": "application/json"})
    assert r.status_code == 401
    assert _balance(db, user.id) == 0


def test_grow_itself_is_not_built_and_sells_nothing(client, monkeypatch, make_user):
    monkeypatch.setenv("PAYMENTS_PROVIDER", "grow")
    monkeypatch.setenv("GROW_SANDBOX_SECRET", SECRET)
    assert payments_provider.can_sell() is False
    assert client.get("/api/v1/packs").json() == []
    assert client.post("/api/v1/checkout", json={"pack": "single"}, headers=_auth(make_user())).status_code == 503
    raw = _body("any", "tx", "10.00")
    assert client.post(CALLBACK, content=raw, headers=_signed(raw)).status_code == 404
