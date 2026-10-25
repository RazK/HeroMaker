"""
Class seats bought with money, at the class price.

A teacher pays Lemon Squeezy for exactly the seats one class needs; the signed
webhook puts them on that class's wallet, never on the teacher's balance. What
must not be wrong, and is tested here through the real code paths (the
endpoints through TestClient, the webhook through its real handler, the ledger
through `ledger.post`):

  * the price clears the 50% margin floor at every size, and bigger is cheaper
  * an unsigned or tampered webhook grants nothing
  * the same order delivered many times, even at once, grants its seats once
  * custom data is not proof: an order that paid less than the seats cost
    grants nothing, so a forged buy link cannot turn $40 into 60 seats
  * the seats go to the class, and the teacher's own balance never moves
  * a refund takes back the unused seats only, once
"""
import hashlib
import hmac
import json
import os
import threading
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.config import packs as packs_config
from app.database import SessionLocal
from app.main import app
from app.models import ClassGuest, ClassRoom, ClassSession, Creation, CreditTransaction, Payment, User
from app.services import classes, ledger, lemonsqueezy
from app.services.auth import create_access_token

WEBHOOK_SECRET = "test-webhook-secret"
HERO = packs_config.creation_credit_price()


@pytest.fixture(autouse=True)
def _clean_classes():
    def wipe():
        db = SessionLocal()
        try:
            db.query(ClassGuest).delete()
            db.query(ClassSession).delete()
            db.query(Creation).update({Creation.class_id: None})
            db.query(ClassRoom).delete()
            db.commit()
        finally:
            db.close()
    wipe()
    yield
    wipe()


@pytest.fixture
def store(monkeypatch):
    """A configured store with a class-seats variant, pointed at nothing real."""
    monkeypatch.setenv("LEMONSQUEEZY_API_KEY", "test-api-key")
    monkeypatch.setenv("LEMONSQUEEZY_STORE_ID", "12345")
    monkeypatch.setenv("LEMONSQUEEZY_WEBHOOK_SECRET", WEBHOOK_SECRET)
    monkeypatch.setenv("LEMONSQUEEZY_TEST_MODE", "true")
    monkeypatch.setenv("LEMONSQUEEZY_VARIANT_CLASS_SEATS", "variant-class-seats")
    for pack in ("starter", "maker", "studio"):
        monkeypatch.setenv(f"LEMONSQUEEZY_VARIANT_{pack.upper()}", f"variant-{pack}")


@pytest.fixture
def client():
    return TestClient(app)


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _balance(db, user_id):
    db.expire_all()
    cached, summed = ledger.get_balance(user_id, db), ledger.get_ledger_balance(user_id, db)
    assert cached == summed, f"cached balance {cached} disagrees with the ledger sum {summed}"
    return cached


def _class(db, class_id):
    db.expire_all()
    return db.query(ClassRoom).filter(ClassRoom.id == class_id).one()


class _Checkout:
    """Stands in for POST /v1/checkouts and keeps what was sent."""

    def __init__(self, status=201):
        self.status = status
        self.sent = []

    def __call__(self, url, json=None, headers=None, timeout=None):
        self.sent.append(json)
        outer = self

        class _R:
            status_code = outer.status
            text = '{"errors":[{"detail":"no"}]}'

            def json(self):
                return {"data": {"attributes": {"url": "https://store.test/checkout/abc"}}}

        return _R()


def _buy_new(client, teacher, seats=28, title="Grade 2B", status=201):
    fake = _Checkout(status)
    with patch("app.services.lemonsqueezy.requests.post", fake):
        r = client.post("/api/v1/classes/buy", json={"title": title, "seats": seats,
                                                  "redirect_url": "https://app.test/?class_paid=1"},
                        headers=_auth(teacher))
    return r, fake


def order(order_id, class_id, seats, user_id="u", paid_cents=None, event="order_created", status="paid",
          discount_cents=0, refunded=False, tax_cents=0):
    if paid_cents is None:
        paid_cents = packs_config.price_cents(packs_config.class_seats_price_usd_micros(seats))
    return {
        "meta": {
            "event_name": event,
            "custom_data": {"user_id": str(user_id), "kind": "class_seats", "class_id": str(class_id),
                            "seats": str(seats)},
        },
        "data": {
            "type": "orders",
            "id": str(order_id),
            "attributes": {
                "order_number": 2001,
                "status": status,
                "subtotal": paid_cents, "subtotal_usd": paid_cents,
                "discount_total": discount_cents, "discount_total_usd": discount_cents,
                "tax": tax_cents,
                "total": paid_cents - discount_cents + tax_cents,
                "total_usd": paid_cents - discount_cents + tax_cents,
                "currency": "USD",
                "user_email": "teacher@example.test",
                "refunded": refunded,
                "test_mode": True,
            },
        },
    }


def deliver(client, body, secret=WEBHOOK_SECRET, tamper=None):
    raw = json.dumps(body).encode()
    sig = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    if tamper:
        raw = tamper(raw)
    return client.post("/api/payments/webhook", content=raw,
                       headers={"X-Signature": sig, "Content-Type": "application/json"})


# ---------------------------------------------------------------------------
# The price
# ---------------------------------------------------------------------------

def test_every_class_size_clears_the_margin_floor():
    assert packs_config.check_class_seats() == []
    for seats in range(1, packs_config.CLASS_MAX_SEATS + 1):
        m = packs_config.class_seats_quote(seats)["margin"]
        assert m["gross_margin_bps"] >= packs_config.MIN_GROSS_MARGIN_BPS, seats


def test_bigger_classes_are_cheaper_per_seat_and_never_dearer_than_packs():
    prices = [packs_config.class_seats_price_usd_micros(n) for n in range(1, packs_config.CLASS_MAX_SEATS + 1)]
    for n in range(2, len(prices) + 1):
        assert prices[n - 1] * (n - 1) <= prices[n - 2] * n, n
        assert prices[n - 1] <= packs_config.cheapest_as_packs_usd_micros(n * HERO), n


def test_the_teacher_price_is_five_percent_under_studio():
    studio = packs_config.get_pack("studio")
    thirty = packs_config.class_seats_quote(30)
    assert thirty["credits"] == studio["credits"]
    assert thirty["price_display"] == "$38.00"
    assert thirty["price_usd_micros"] == studio["price_usd_micros"] * 95 // 100
    assert packs_config.class_seats_quote(28)["price_display"] == "$35.50"


def test_a_flat_seat_price_would_sink_small_classes_under_the_floor(monkeypatch):
    """Why the price has a per-order part: without it, 1 to 6 seats lose."""
    monkeypatch.setattr(packs_config, "CLASS_ORDER_USD_MICROS", 0)
    monkeypatch.setattr(packs_config, "CLASS_SEAT_USD_MICROS", 1_270_000)
    problems = packs_config.check_class_seats()
    assert any(p.startswith("1 class seats") for p in problems)
    assert any(p.startswith("6 class seats") for p in problems)
    assert not any(p.startswith("7 class seats") for p in problems)
    assert packs_config.check_packs()   # and the price list as a whole fails


def test_the_guards_catch_a_price_that_rises_or_beats_packs(monkeypatch):
    monkeypatch.setattr(packs_config, "class_seats_price_usd_micros",
                        lambda n: 900_000 * n + (5_000_000 if n == 10 else 0))
    problems = packs_config.check_class_seats()
    assert any("more per seat than" in p for p in problems)
    monkeypatch.setattr(packs_config, "class_seats_price_usd_micros", lambda n: 2_000_000 * n)
    assert any("bought as packs" in p for p in packs_config.check_class_seats())


# ---------------------------------------------------------------------------
# Opening the checkout
# ---------------------------------------------------------------------------

def test_the_option_is_hidden_when_no_variant_is_configured(db, make_user, client, store, monkeypatch):
    teacher = make_user()
    assert client.get("/api/v1/classes", headers=_auth(teacher)).json()["seat_price"] == {
        "order_cents": 50, "seat_cents": 125, "max_seats": 60}
    monkeypatch.delenv("LEMONSQUEEZY_VARIANT_CLASS_SEATS")
    assert client.get("/api/v1/classes", headers=_auth(teacher)).json()["seat_price"] is None
    r, fake = _buy_new(client, teacher)
    assert r.status_code == 503
    assert fake.sent == [] and db.query(ClassRoom).count() == 0


def test_a_new_class_checkout_charges_exactly_the_seats(db, make_user, client, store):
    teacher = make_user(credits=7)
    r, fake = _buy_new(client, teacher, seats=28)
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["checkout_url"] == "https://store.test/checkout/abc"
    assert out["price_display"] == "$35.50" and out["seats"] == 28

    attrs = fake.sent[0]["data"]["attributes"]
    assert attrs["custom_price"] == 3550
    assert attrs["checkout_options"] == {"discount": False}
    assert attrs["checkout_data"]["custom"] == {
        "user_id": teacher.id, "kind": "class_seats", "class_id": out["class_id"], "seats": "28",
        "expected_cents": "3550"}
    assert fake.sent[0]["data"]["relationships"]["variant"]["data"]["id"] == "variant-class-seats"

    # The class exists with nothing on it yet; nobody's credits moved.
    room = _class(db, out["class_id"])
    assert (room.seats, room.owner_id) == (0, teacher.id)
    assert _balance(db, teacher.id) == 7
    assert _balance(db, room.wallet_user_id) == 0


def test_a_checkout_that_cannot_open_leaves_no_empty_class(db, make_user, client, store):
    teacher = make_user()
    r, _ = _buy_new(client, teacher, status=422)
    assert r.status_code == 502
    assert r.json()["detail"] == "Payments are unavailable right now."
    assert db.query(ClassRoom).count() == 0
    assert db.query(User).filter(User.kind == classes.WALLET_KIND).count() == 0


def test_more_seats_for_a_class_only_its_teacher_can_buy(db, make_user, client, store):
    teacher, other = make_user(), make_user()
    class_id = _buy_new(client, teacher)[0].json()["class_id"]
    fake = _Checkout()
    with patch("app.services.lemonsqueezy.requests.post", fake):
        assert client.post(f"/api/v1/classes/{class_id}/buy", json={"seats": 2}, headers=_auth(other)).status_code == 404
        r = client.post(f"/api/v1/classes/{class_id}/buy", json={"seats": 2}, headers=_auth(teacher))
        assert r.status_code == 200 and r.json()["price_display"] == "$3.00"
        too_many = client.post(f"/api/v1/classes/{class_id}/buy", json={"seats": 61}, headers=_auth(teacher))
        assert too_many.status_code == 400
    assert len(fake.sent) == 1


# ---------------------------------------------------------------------------
# Money arriving
# ---------------------------------------------------------------------------

def test_paid_seats_go_to_the_class_and_never_to_the_teacher(db, make_user, client, store):
    teacher = make_user(credits=7)
    class_id = _buy_new(client, teacher, seats=28)[0].json()["class_id"]

    r = deliver(client, order("ord-1", class_id, 28, user_id=teacher.id))
    assert r.status_code == 200 and r.json()["seats_granted"] == 28, r.text

    room = _class(db, class_id)
    assert room.seats == 28
    assert _balance(db, room.wallet_user_id) == 28 * HERO
    assert _balance(db, teacher.id) == 7
    tx = db.query(CreditTransaction).filter(CreditTransaction.external_ref == "lemonsqueezy:order:ord-1").one()
    assert (tx.user_id, tx.reason, tx.delta) == (room.wallet_user_id, "purchase", 280)
    pay = db.query(Payment).filter(Payment.provider_ref == "lemonsqueezy:order:ord-1").one()
    assert pay.gross_usd_micros == 35_500_000 and pay.metadata_json["class_id"] == class_id

    receipts = client.get("/api/v1/receipts", headers=_auth(teacher)).json()
    assert [(x["class_title"], x["seats"], x["paid_display"]) for x in receipts] == [("Grade 2B", 28, "$35.50")]


def test_sales_tax_on_top_does_not_get_in_the_way(db, make_user, client, store):
    teacher = make_user()
    class_id = _buy_new(client, teacher, seats=10)[0].json()["class_id"]
    assert deliver(client, order("ord-tax", class_id, 10, tax_cents=221)).json()["seats_granted"] == 10


def test_unsigned_or_tampered_webhooks_grant_nothing(db, make_user, client, store):
    teacher = make_user()
    class_id = _buy_new(client, teacher, seats=5)[0].json()["class_id"]
    body = order("ord-x", class_id, 5)
    assert deliver(client, body, secret="not-the-secret").status_code == 401
    assert deliver(client, body, tamper=lambda raw: raw.replace(b'"seats": "5"', b'"seats": "50"')).status_code == 401
    raw = json.dumps(body).encode()
    assert client.post("/api/payments/webhook", content=raw,
                       headers={"Content-Type": "application/json"}).status_code == 401
    assert _class(db, class_id).seats == 0
    assert db.query(Payment).count() == 0


def test_the_same_order_delivered_five_times_grants_once(db, make_user, client, store):
    teacher = make_user()
    class_id = _buy_new(client, teacher, seats=12)[0].json()["class_id"]
    granted = [deliver(client, order("ord-5", class_id, 12)).json()["seats_granted"] for _ in range(5)]
    assert granted == [12, 0, 0, 0, 0]
    room = _class(db, class_id)
    assert room.seats == 12 and _balance(db, room.wallet_user_id) == 120
    assert db.query(Payment).count() == 1


def test_the_same_order_delivered_at_once_grants_once(db, make_user, client, store):
    """Eight deliveries of one order racing each other, on separate sessions."""
    teacher = make_user()
    class_id = _buy_new(client, teacher, seats=9)[0].json()["class_id"]
    results, barrier = [], threading.Barrier(8)

    def go():
        s = SessionLocal()
        try:
            room = s.query(ClassRoom).filter(ClassRoom.id == class_id).one()
            barrier.wait()
            for _ in range(30):
                try:
                    results.append(classes.grant_bought_seats(s, room, 9, "ord-race")[1])
                    return
                except Exception:      # SQLite "database is locked": try again
                    s.rollback()
        finally:
            s.close()

    threads = [threading.Thread(target=go) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    room = _class(db, class_id)
    assert results.count(True) == 1 and len(results) == 8
    assert room.seats == 9 and _balance(db, room.wallet_user_id) == 90


def test_custom_data_is_not_proof_of_payment(db, make_user, client, store):
    """A public buy link with made-up custom data: Studio's $40 claiming 60 seats."""
    teacher = make_user()
    class_id = _buy_new(client, teacher, seats=2)[0].json()["class_id"]
    r = deliver(client, order("ord-forged", class_id, 60, paid_cents=4000))
    assert r.status_code == 200 and r.json()["status"] == "ignored"
    one_cent_short = packs_config.price_cents(packs_config.class_seats_price_usd_micros(20)) - 2
    assert deliver(client, order("ord-short", class_id, 20, paid_cents=one_cent_short)).json()["status"] == "ignored"
    assert deliver(client, order("ord-coupon", class_id, 20, discount_cents=500)).json()["status"] == "ignored"
    assert deliver(client, order("ord-nope", "no-such-class", 2)).json()["status"] == "ignored"
    assert deliver(client, order("ord-zero", class_id, 0, paid_cents=0)).json()["status"] == "ignored"
    room = _class(db, class_id)
    assert room.seats == 0 and _balance(db, room.wallet_user_id) == 0
    assert db.query(CreditTransaction).filter(CreditTransaction.reason == "purchase").count() == 0


def test_bought_seats_are_used_by_a_live_class(db, make_user, client, store):
    teacher = make_user()
    class_id = _buy_new(client, teacher, seats=3)[0].json()["class_id"]
    deliver(client, order("ord-live", class_id, 3))
    r = client.post(f"/api/v1/classes/{class_id}/start", json={"minutes": 45}, headers=_auth(teacher))
    assert r.status_code == 200 and r.json()["seats_left"] == 3


# ---------------------------------------------------------------------------
# Refunds
# ---------------------------------------------------------------------------

def test_a_refund_takes_back_only_the_unused_seats_once(db, make_user, client, store):
    teacher = make_user(credits=50)
    class_id = _buy_new(client, teacher, seats=10)[0].json()["class_id"]
    deliver(client, order("ord-r", class_id, 10))
    room = _class(db, class_id)
    # Four children have made their heroes: the seats are used and their
    # credits spent by the pipeline.
    room.seats_used = 4
    db.commit()
    ledger.spend_credits(room.wallet_user_id, 4 * HERO, db)

    refund = order("ord-r", class_id, 10, event="order_refunded", status="refunded", refunded=True)
    r = deliver(client, refund)
    assert r.status_code == 200 and r.json() == {"status": "ok", "seats_taken_back": 6, "seats_kept": 4}
    for _ in range(3):
        assert deliver(client, refund).json()["seats_taken_back"] == 0

    room = _class(db, class_id)
    assert (room.seats, room.seats_used) == (4, 4)
    assert _balance(db, room.wallet_user_id) == 0
    assert _balance(db, teacher.id) == 50
    assert db.query(CreditTransaction).filter(CreditTransaction.reason == "purchase_refunded").count() == 1


def test_a_refund_after_every_seat_is_used_takes_nothing(db, make_user, client, store):
    teacher = make_user()
    class_id = _buy_new(client, teacher, seats=2)[0].json()["class_id"]
    deliver(client, order("ord-used", class_id, 2))
    room = _class(db, class_id)
    room.seats_used = 2
    db.commit()
    r = deliver(client, order("ord-used", class_id, 2, event="order_refunded", status="refunded", refunded=True))
    assert r.json() == {"status": "ok", "seats_taken_back": 0, "seats_kept": 2}
    assert _class(db, class_id).seats == 2


def test_a_partial_refund_is_left_to_an_admin(db, make_user, client, store):
    teacher = make_user()
    class_id = _buy_new(client, teacher, seats=5)[0].json()["class_id"]
    deliver(client, order("ord-p", class_id, 5))
    r = deliver(client, order("ord-p", class_id, 5, event="order_refunded", status="partial_refund"))
    assert r.json()["status"] == "logged"
    assert _class(db, class_id).seats == 5


def test_a_refund_never_strands_a_child_who_took_a_seat_meanwhile(db, make_user, client, store, monkeypatch):
    """A child takes a seat between the refund reading the class and writing:
    the conditional update notices, nothing is half-written, and it recomputes."""
    teacher = make_user()
    class_id = _buy_new(client, teacher, seats=3)[0].json()["class_id"]
    deliver(client, order("ord-m", class_id, 3))
    real_post, raced = ledger.post, []

    def post_after_a_child_sits(**kw):
        if kw.get("reason") == "purchase_refunded" and not raced:
            raced.append(1)
            s = SessionLocal()
            s.query(ClassRoom).filter(ClassRoom.id == class_id).update({ClassRoom.seats_used: 1})
            s.commit()
            s.close()
        return real_post(**kw)

    monkeypatch.setattr(ledger, "post", post_after_a_child_sits)
    r = classes.refund_bought_seats(db, "ord-m")
    assert r == {"status": "ok", "seats_taken_back": 2, "seats_kept": 1}
    room = _class(db, class_id)
    assert (room.seats, room.seats_used) == (1, 1)
    assert _balance(db, room.wallet_user_id) == 10


def test_ledger_side_writes_roll_back_with_the_row(db, make_user):
    """`in_transaction` is all or nothing with the ledger row it rides on."""
    user = make_user(credits=10)

    def boom(session):
        session.query(User).filter(User.id == user.id).update({User.name: "half-written"})
        raise RuntimeError("no")

    with pytest.raises(RuntimeError):
        ledger.post(db=db, user_id=user.id, delta=5, reason="admin_adjust", in_transaction=boom)
    db.expire_all()
    assert _balance(db, user.id) == 10
    assert db.query(User).filter(User.id == user.id).one().name != "half-written"


@pytest.mark.skipif(not os.getenv("TEST_POSTGRES_URL"),
                    reason="set TEST_POSTGRES_URL: the row locks only exist on Postgres")
def test_concurrent_deliveries_grant_once_on_postgres():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.database import Base

    engine = create_engine(os.environ["TEST_POSTGRES_URL"])
    Base.metadata.create_all(bind=engine)
    Pg = sessionmaker(bind=engine)
    setup = Pg()
    teacher = User(email=None, username=f"pg-teacher-{os.getpid()}-{id(setup)}", credits=0)
    setup.add(teacher)
    setup.commit()
    room = classes.create_class_to_buy(setup, teacher, "PG class", 9)
    class_id, wallet_id = room.id, room.wallet_user_id
    setup.close()

    results, barrier = [], threading.Barrier(8)

    def go():
        s = Pg()
        try:
            r = s.query(ClassRoom).filter(ClassRoom.id == class_id).one()
            barrier.wait(timeout=30)
            results.append(classes.grant_bought_seats(s, r, 9, f"pg-{class_id}")[1])
        finally:
            s.close()

    threads = [threading.Thread(target=go) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)

    check = Pg()
    try:
        assert results.count(True) == 1 and len(results) == 8
        assert check.query(ClassRoom).filter(ClassRoom.id == class_id).one().seats == 9
        assert ledger.get_balance(wallet_id, check) == ledger.get_ledger_balance(wallet_id, check) == 90
        r = classes.refund_bought_seats(check, f"pg-{class_id}")
        assert r["seats_taken_back"] == 9
    finally:
        check.close()
