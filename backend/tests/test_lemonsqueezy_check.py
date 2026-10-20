"""
GET /api/admin/money/lemonsqueezy: Lemon Squeezy's orders beside our payments.

Driven through the real app and the real reconciliation. Only Lemon Squeezy's
HTTP is faked, at the `requests` boundary inside
app/services/lemonsqueezy_check.py. Payment rows are written the way the
webhook writes them (provider_ref "lemonsqueezy:order:<id>").
"""
from datetime import datetime, timedelta, timezone

import pytest
import requests
from fastapi.testclient import TestClient

from app.main import app
from app.models import Payment
from app.services import lemonsqueezy, lemonsqueezy_check
from app.services.auth import create_access_token

URL = "/api/admin/money/lemonsqueezy"
STORE_URL = f"{lemonsqueezy.API_ROOT}/stores/4242"
ORDERS_URL = f"{lemonsqueezy.API_ROOT}/orders"
KEY = "ls-secret-api-key"


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def admin(make_user):
    return make_user(is_admin=True, username="theadmin")


@pytest.fixture
def as_admin(admin):
    return {"Authorization": f"Bearer {create_access_token(admin.id)}"}


@pytest.fixture(autouse=True)
def ls_env(monkeypatch):
    monkeypatch.setenv("LEMONSQUEEZY_API_KEY", KEY)
    monkeypatch.setenv("LEMONSQUEEZY_STORE_ID", "4242")
    monkeypatch.setenv("LEMONSQUEEZY_TEST_MODE", "true")
    lemonsqueezy_check.clear_cache()
    yield
    lemonsqueezy_check.clear_cache()


class _Resp:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000000Z")


def _order(oid, number, cents, *, status="paid", test_mode=True, days_ago=1):
    created = datetime.now(timezone.utc) - timedelta(days=days_ago)
    return {"type": "orders", "id": str(oid), "attributes": {
        "store_id": 4242, "order_number": number, "status": status,
        "total": cents, "total_usd": cents, "currency": "USD",
        "created_at": _iso(created), "test_mode": test_mode,
        "user_email": "buyer@example.com",
    }}


STORE = {"data": {"type": "stores", "id": "4242", "attributes": {
    "name": "HeroMaker", "currency": "USD",
    "total_sales": 12, "total_revenue": 18000,
    "thirty_day_sales": 3, "thirty_day_revenue": 4500,
}}}


def _fake(monkeypatch, orders_pages, store=STORE, calls=None):
    """requests.get answering the store, then the orders pages in turn."""
    calls = calls if calls is not None else []

    def fake_get(url, headers=None, params=None, timeout=None):
        calls.append((url, dict(params or {})))
        assert headers["Authorization"] == f"Bearer {KEY}"
        assert timeout and timeout <= 5
        if url == STORE_URL:
            return store if isinstance(store, _Resp) else _Resp(200, store)
        assert url == ORDERS_URL
        assert params["filter[store_id]"] == "4242"
        n = int(params["page[number]"])
        page = orders_pages[n - 1]
        links = {"next": f"{ORDERS_URL}?page[number]={n + 1}"} if n < len(orders_pages) else {}
        return _Resp(200, {"data": page, "links": links})

    monkeypatch.setattr(lemonsqueezy_check.requests, "get", fake_get)
    return calls


def _pay(db, user, order_id, gross_cents, *, test_mode=True, days_ago=1, number=None):
    db.add(Payment(
        user_id=user.id, provider="lemonsqueezy",
        provider_ref=f"lemonsqueezy:order:{order_id}",
        gross_usd_micros=gross_cents * 10_000, fee_usd_micros=0, net_usd_micros=gross_cents * 10_000,
        status="succeeded",
        metadata_json={"test_mode": test_mode, "order_number": number},
        created_at=datetime.utcnow() - timedelta(days=days_ago),
    ))
    db.commit()


# ---------------------------------------------------------------------------


def test_store_totals_are_parsed(client, as_admin, monkeypatch):
    _fake(monkeypatch, [[]])
    body = client.get(URL, headers=as_admin).json()
    assert body["status"] == "ok"
    assert body["store"] == {
        "name": "HeroMaker", "currency": "USD",
        "total_sales": 12, "total_revenue_usd_micros": 180_000_000,
        "thirty_day_sales": 3, "thirty_day_revenue_usd_micros": 45_000_000,
    }
    assert body["orders"]["count"] == 0
    assert body["matches"] is True


def test_every_order_recorded_matches(client, db, as_admin, make_user, monkeypatch):
    buyer = make_user(username="buyer")
    _fake(monkeypatch, [[_order(1, 101, 1500), _order(2, 102, 500, days_ago=3)]])
    _pay(db, buyer, 1, 1500)
    _pay(db, buyer, 2, 500, days_ago=3)
    body = client.get(URL, headers=as_admin).json()
    assert body["orders"] == {"count": 2, "gross_usd_micros": 20_000_000, "truncated": False, "max_orders": 200}
    assert body["ours"] == {"count": 2, "gross_usd_micros": 20_000_000}
    assert body["missing"] == [] and body["unknown_payments"] == []
    assert body["matches"] is True


def test_an_order_with_no_payment_row_is_flagged(client, db, as_admin, make_user, monkeypatch):
    buyer = make_user(username="buyer")
    _fake(monkeypatch, [[
        _order(1, 101, 1500),
        _order(2, 102, 500),                       # webhook never landed
        _order(3, 103, 900, status="refunded"),    # took money, then gave it back: still ours to record
        _order(4, 104, 700, status="failed"),      # never took money: correctly absent
        _order(5, 105, 800, status="pending"),
    ]])
    _pay(db, buyer, 1, 1500)
    body = client.get(URL, headers=as_admin).json()
    assert body["matches"] is False
    assert [m["order_number"] for m in body["missing"]] == [102, 103]
    assert body["missing"][0]["order_id"] == "2"
    assert body["missing"][0]["total_usd_micros"] == 5_000_000
    assert body["orders"]["count"] == 3
    assert body["ours"]["count"] == 1

    # The webhook arrives late: the next read clears it without asking Lemon Squeezy again.
    _pay(db, buyer, 2, 500)
    _pay(db, buyer, 3, 900)
    again = client.get(URL, headers=as_admin).json()
    assert again["cached"] is True
    assert again["missing"] == [] and again["matches"] is True


def test_a_payment_lemon_squeezy_does_not_list_is_flagged(client, db, as_admin, make_user, monkeypatch):
    buyer = make_user(username="buyer")
    _fake(monkeypatch, [[_order(1, 101, 1500)]])
    _pay(db, buyer, 1, 1500)
    _pay(db, buyer, 99, 2500, number=199)
    body = client.get(URL, headers=as_admin).json()
    assert body["missing"] == []
    assert [u["order_id"] for u in body["unknown_payments"]] == ["99"]
    assert body["matches"] is False


def test_orders_outside_the_window_and_other_modes_are_left_out(client, db, as_admin, make_user, monkeypatch):
    buyer = make_user(username="buyer")
    calls = _fake(monkeypatch, [
        [_order(i, 200 + i, 100, days_ago=1) for i in range(100)],
        [_order(500, 600, 100, days_ago=2), _order(501, 601, 100, days_ago=30.5), _order(502, 602, 100, days_ago=60)],
        [_order(900, 999, 100, days_ago=90)],      # never fetched: the walk stopped at day 60, a day past the window
    ])
    for i in range(100):
        _pay(db, buyer, i, 100)
    _pay(db, buyer, 500, 100)
    _pay(db, buyer, 501, 100, days_ago=30.5)        # just outside the window: on neither side
    _pay(db, buyer, 7777, 100, test_mode=False)     # a live payment never matches test orders
    body = client.get(URL, headers=as_admin).json()
    order_pages = [p for u, p in calls if u == ORDERS_URL]
    assert [p["page[number]"] for p in order_pages] == [1, 2]
    assert all(p["page[size]"] == 100 for p in order_pages)
    assert body["orders"]["count"] == 101
    assert body["ours"]["count"] == 101
    assert body["missing"] == [] and body["unknown_payments"] == []
    assert body["matches"] is True


def test_the_order_cap_stops_the_walk(client, db, as_admin, monkeypatch):
    monkeypatch.setattr(lemonsqueezy_check, "MAX_ORDERS", 3)
    _fake(monkeypatch, [[_order(i, i, 100) for i in range(5)]])
    body = client.get(URL, headers=as_admin).json()
    assert body["orders"]["truncated"] is True
    assert body["orders"]["count"] == 3
    assert len(body["missing"]) == 3


def test_mode_label_follows_the_orders_the_key_reads(client, db, as_admin, make_user, monkeypatch):
    _fake(monkeypatch, [[]])
    assert client.get(URL, headers=as_admin).json()["mode"] == "test"

    lemonsqueezy_check.clear_cache()
    monkeypatch.setenv("LEMONSQUEEZY_TEST_MODE", "false")
    assert client.get(URL, headers=as_admin).json()["mode"] == "live"

    # A live flag with a key that reads test orders: the orders win, and it says so.
    lemonsqueezy_check.clear_cache()
    buyer = make_user(username="buyer")
    _pay(db, buyer, 1, 1500, test_mode=True)
    _fake(monkeypatch, [[_order(1, 101, 1500, test_mode=True)]])
    body = client.get(URL, headers=as_admin).json()
    assert body["mode"] == "test"
    assert "LEMONSQUEEZY_TEST_MODE" in body["hint"]
    assert body["matches"] is True


@pytest.mark.parametrize("store,expect", [
    (_Resp(401, {"errors": [{"detail": "bad key ls-secret-api-key"}]}), "refused (401)"),
    (_Resp(404, {}), "404"),
    (_Resp(500, {}), "answered 500"),
    (_Resp(200, ValueError("no json")), "not JSON"),
])
def test_an_api_error_degrades_to_unavailable(client, as_admin, monkeypatch, caplog, store, expect):
    _fake(monkeypatch, [[]], store=store)
    r = client.get(URL, headers=as_admin)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "error"
    assert expect in body["hint"]
    assert body["mode"] == "test"
    assert KEY not in r.text and KEY not in caplog.text


def test_a_timeout_degrades_to_unavailable_and_is_cached_briefly(client, as_admin, monkeypatch):
    calls = []

    def boom(url, headers=None, params=None, timeout=None):
        calls.append(url)
        raise requests.Timeout(f"timed out with {KEY}")

    monkeypatch.setattr(lemonsqueezy_check.requests, "get", boom)
    r = client.get(URL, headers=as_admin)
    assert r.json()["status"] == "error"
    assert "in time" in r.json()["hint"]
    assert KEY not in r.text
    client.get(URL, headers=as_admin)
    assert len(calls) == 1
    client.get(URL + "?refresh=true", headers=as_admin)
    assert len(calls) == 2


def test_unconfigured_store_says_what_to_set(client, as_admin, monkeypatch):
    monkeypatch.delenv("LEMONSQUEEZY_API_KEY")
    monkeypatch.setattr(lemonsqueezy_check.requests, "get",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("no call expected")))
    body = client.get(URL, headers=as_admin).json()
    assert body["status"] == "not_configured"
    assert "LEMONSQUEEZY_API_KEY" in body["hint"]


def test_cached_for_five_minutes(client, as_admin, monkeypatch):
    calls = _fake(monkeypatch, [[]])
    client.get(URL, headers=as_admin)
    n = len(calls)
    assert client.get(URL, headers=as_admin).json()["cached"] is True
    assert len(calls) == n
    assert lemonsqueezy_check.CACHE_SECONDS == 300


def test_needs_a_token(client):
    assert client.get(URL).status_code == 401


def test_refuses_a_non_admin(client, make_user, monkeypatch):
    monkeypatch.setattr(lemonsqueezy_check.requests, "get",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("no call expected")))
    token = create_access_token(make_user(username="plain").id)
    assert client.get(URL, headers={"Authorization": f"Bearer {token}"}).status_code == 403
