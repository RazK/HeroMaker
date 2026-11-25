"""
PAYMENTS_PROVIDER=grow: the real Grow provider, end to end through its real
code path, with Grow played by the stand-in (app/api/grow_standin.py), which
speaks Grow's Light API over "HTTP" (requests.post routed into the app).

What must not be wrong:

  * credits come only from a VERIFIED notify: the order's secret notify
    token AND the processId/processToken Grow gave our server; the browser
    returning to successUrl grants nothing
  * forged, tokenless, wrong-token, wrong-process and other-order notifies
    grant nothing (401)
  * the same transaction delivered twice credits once (Grow resends when
    approveTransaction fails)
  * what is bought and its price come from OUR stored order
  * approveTransaction is sent after a paid notify
  * nothing sells without the notify secret; the stand-in never runs in
    production
"""
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient

from app.api import grow_standin
from app.config import packs as packs_config
from app.models import CheckoutOrder, ClassRoom
from app.services import grow, ledger
from app.services.auth import create_access_token

FRONTEND = "https://app.test"
HERO = packs_config.creation_credit_price()
STANDIN = f"{FRONTEND}/api/payments/grow-standin"


@pytest.fixture
def client():
    from app.main import app
    return TestClient(app)


@pytest.fixture
def calls():
    return []


@pytest.fixture
def notify_posts():
    """How each outbound POST to the notify route was encoded."""
    return []


@pytest.fixture
def grow_env(monkeypatch, client, calls, notify_posts):
    """grow, pointed at the stand-in, on a staging-like deployment, with every
    outbound requests.post routed into the app as Grow's calls would be."""
    monkeypatch.setenv("PAYMENTS_PROVIDER", "grow")
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "staging")
    monkeypatch.setenv("FRONTEND_URL", FRONTEND)
    monkeypatch.setenv("GROW_API_BASE", STANDIN)
    monkeypatch.setenv("GROW_USER_ID", "standin-user")
    monkeypatch.setenv("GROW_PAGE_CODE", "standin-page")
    monkeypatch.setenv("GROW_NOTIFY_SECRET", "test-notify-secret")
    monkeypatch.setenv("GROW_STANDIN_ENABLED", "1")
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)

    class Resp:
        def __init__(self, r):
            self.status_code, self._r = r.status_code, r

        def json(self):
            return self._r.json()

    def fake_post(url, files=None, data=None, timeout=None):
        parts = urlsplit(url)
        assert f"{parts.scheme}://{parts.netloc}" == FRONTEND, url
        path = parts.path + (f"?{parts.query}" if parts.query else "")
        calls.append((parts.path, dict((k, v[1]) for k, v in (files or {}).items()) or dict(data or {})))
        if "/grow/notify/" in parts.path:
            notify_posts.append("multipart" if files is not None else "urlencoded")
        if files is not None:
            return Resp(client.post(path, files=files))
        return Resp(client.post(path, data=data))

    monkeypatch.setattr(grow.requests, "post", fake_post)
    monkeypatch.setattr(grow_standin.requests, "post", fake_post)


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _balance(db, user_id):
    db.expire_all()
    return ledger.get_balance(user_id, db)


def _checkout(client, user, pack="single"):
    r = client.post("/api/v1/checkout", json={"pack": pack, "redirect_url": f"{FRONTEND}/?purchased=1"},
                    headers=_auth(user))
    assert r.status_code == 200, r.text
    return r.json()


def _last_order(db, user_id) -> CheckoutOrder:
    db.expire_all()
    return (db.query(CheckoutOrder).filter(CheckoutOrder.user_id == str(user_id))
            .order_by(CheckoutOrder.created_at.desc()).first())


def _page(url):
    parts = urlsplit(url)
    return parts.path, parse_qs(parts.query)["s"][0]


def _notify_url(calls):
    create = [f for p, f in calls if p.endswith("/createPaymentProcess")][-1]
    return create["notifyUrl"]


def _update(order, transaction_id="555000111", sum_ils="10.00", **over):
    meta = order.metadata_json
    form = grow_standin.server_update({
        "pid": meta["grow_process_id"], "ptok": meta["grow_process_token"], "sum": sum_ils,
        "desc": "x", "c1": order.id}, transaction_id)
    form.update(over)
    return form


def _post_notify(client, url, form, multipart=True):
    """Multipart by default, as real Grow posts it; urlencoded on request."""
    parts = urlsplit(url)
    path = parts.path + (f"?{parts.query}" if parts.query else "")
    if multipart:
        return client.post(path, files={k: (None, v) for k, v in form.items()})
    return client.post(path, data=form)


# --------------------------------------------------------------------------

def test_shekel_packs_are_on_sale(grow_env, client):
    packs = client.get("/api/v1/packs").json()
    assert [(p["slug"], p["price_display"], p["currency"]) for p in packs] == [
        ("single", "₪10", "ILS"), ("family", "₪39", "ILS")]


def test_nothing_sells_without_the_notify_secret(grow_env, client, monkeypatch, make_user):
    monkeypatch.delenv("GROW_NOTIFY_SECRET")
    assert client.get("/api/v1/packs").json() == []
    r = client.post("/api/v1/checkout", json={"pack": "single"}, headers=_auth(make_user()))
    assert r.status_code == 503


def test_checkout_calls_create_payment_process_and_grants_nothing(grow_env, client, make_user, db, calls):
    user = make_user(credits=0)
    out = _checkout(client, user, "family")
    assert out["checkout_url"].startswith(f"{STANDIN}/page/")
    path, sent = calls[0]
    assert path == "/api/payments/grow-standin/api/light/server/1.0/createPaymentProcess"
    order = _last_order(db, user.id)
    assert sent["sum"] == "39.00" and sent["cField1"] == order.id
    assert sent["pageCode"] == "standin-page" and sent["userId"] == "standin-user"
    # The token is the last path segment, never a query Grow could drop.
    assert sent["notifyUrl"] == f"{FRONTEND}/api/payments/grow/notify/{order.id}/{grow.notify_token(order.id)}"
    assert "?" not in sent["notifyUrl"]
    assert "checkout=failed" in sent["cancelUrl"]
    assert order.provider == "grow" and order.status == "pending" and order.amount_minor == 3900
    assert order.metadata_json["grow_process_id"] and order.metadata_json["grow_process_token"]
    assert _balance(db, user.id) == 0


def test_pay_on_the_page_credits_through_the_verified_notify(grow_env, client, make_user, db, calls,
                                                             notify_posts):
    user = make_user(credits=0)
    out = _checkout(client, user, "single")
    path, sig = _page(out["checkout_url"])
    page = client.get(path, params={"s": sig})
    assert "<title>TEST checkout - no real money</title>" in page.text and "₪10" in page.text

    r = client.post(f"{path}/pay", params={"s": sig}, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == f"{FRONTEND}/?purchased=1&response=success"
    # The stand-in posted the notify multipart, as Grow does, through the
    # real route and its multipart decoding, and that is what credited.
    assert notify_posts == ["multipart"]
    assert _balance(db, user.id) == HERO

    order = _last_order(db, user.id)
    assert order.status == "paid" and order.transaction_id
    assert order.metadata_json["grow_approved"] is True and order.metadata_json["grow_asmachta"]
    approve = [f for p, f in calls if p.endswith("/approveTransaction")]
    assert len(approve) == 1 and approve[0]["pageCode"] == "standin-page"
    assert approve[0]["transactionId"] == order.transaction_id

    receipts = client.get("/api/v1/receipts", headers=_auth(user)).json()
    assert len(receipts) == 1 and receipts[0]["credits"] == HERO and receipts[0]["paid_display"] == "₪10"


def test_returning_to_success_url_grants_nothing(grow_env, client, make_user, db):
    user = make_user(credits=0)
    _checkout(client, user)
    client.get("/?purchased=1&response=success")
    assert _balance(db, user.id) == 0


def test_the_same_transaction_twice_credits_once(grow_env, client, make_user, db, calls):
    user = make_user(credits=0)
    _checkout(client, user)
    order, url = _last_order(db, user.id), _notify_url(calls)
    form = _update(order)
    assert _post_notify(client, url, form).json()["status"] == "ok"
    assert _post_notify(client, url, form).json()["status"] == "ok"
    assert _balance(db, user.id) == HERO
    # A second, different transaction for the paid order: nothing.
    assert _post_notify(client, url, _update(order, "777")).json()["status"] == "ignored"
    assert _balance(db, user.id) == HERO


@pytest.mark.parametrize("how", ["no token", "wrong token", "wrong process token", "wrong process id",
                                 "other order's token", "unknown order"])
def test_unproven_notifies_grant_nothing(grow_env, client, make_user, db, calls, how):
    user, other = make_user(credits=0), make_user(credits=0)
    _checkout(client, other)
    other_url = _notify_url(calls)
    _checkout(client, user)
    order, url = _last_order(db, user.id), _notify_url(calls)
    form = _update(order)
    base, _, token = url.rpartition("/")
    if how == "no token":
        url = base
    elif how == "wrong token":
        url = base + "/" + "0" * 64
    elif how == "wrong process token":
        form["data[processToken]"] = "forged"
    elif how == "wrong process id":
        form["data[processId]"] = "1"
    elif how == "other order's token":
        url = base + "/" + other_url.rpartition("/")[2]
    elif how == "unknown order":
        url = f"{FRONTEND}/api/payments/grow/notify/not-an-order/{token}"
    # No token at all matches no route (404); every other forgery is 401.
    assert _post_notify(client, url, form).status_code == (404 if how == "no token" else 401)
    assert _balance(db, user.id) == 0


def test_a_sum_that_differs_from_the_order_grants_nothing(grow_env, client, make_user, db, calls):
    user = make_user(credits=0)
    _checkout(client, user, "family")
    order, url = _last_order(db, user.id), _notify_url(calls)
    assert _post_notify(client, url, _update(order, sum_ils="10.00")).json()["status"] == "ignored"
    assert _balance(db, user.id) == 0


def test_an_unpaid_status_grants_nothing(grow_env, client, make_user, db, calls):
    user = make_user(credits=0)
    _checkout(client, user)
    order, url = _last_order(db, user.id), _notify_url(calls)
    r = _post_notify(client, url, _update(order, **{"data[statusCode]": "3"}))
    assert r.json()["status"] == "ignored" and _balance(db, user.id) == 0
    assert not [p for p, _ in calls if p.endswith("/approveTransaction")]


def test_fail_returns_to_the_cancel_page_and_grants_nothing(grow_env, client, make_user, db):
    user = make_user(credits=0)
    path, sig = _page(_checkout(client, user)["checkout_url"])
    r = client.post(f"{path}/fail", params={"s": sig}, follow_redirects=False)
    assert r.headers["location"] == f"{FRONTEND}/?purchased=1&checkout=failed"
    assert _balance(db, user.id) == 0


def test_a_failed_approve_still_credits_and_a_resend_credits_once(grow_env, client, make_user, db, calls,
                                                                 monkeypatch):
    user = make_user(credits=0)
    _checkout(client, user)
    order, url = _last_order(db, user.id), _notify_url(calls)
    monkeypatch.setattr(grow, "APPROVE_PATH", "/api/light/server/1.0/nowhere")
    r = _post_notify(client, url, _update(order))
    assert r.json()["status"] == "ok" and r.json()["approved"] is False
    r = _post_notify(client, url, _update(order))        # Grow resends
    assert r.json()["status"] == "ok"
    assert _balance(db, user.id) == HERO


def test_class_seats_through_grow(grow_env, client, make_user, db):
    teacher = make_user(credits=0)
    r = client.post("/api/v1/classes/buy", json={"title": "Grade 2B", "seats": 10,
                                                 "redirect_url": f"{FRONTEND}/?class_paid={{class_id}}"},
                    headers=_auth(teacher))
    assert r.status_code == 201, r.text
    out = r.json()
    path, sig = _page(out["checkout_url"])
    client.post(f"{path}/pay", params={"s": sig}, follow_redirects=False)
    db.expire_all()
    room = db.query(ClassRoom).filter(ClassRoom.id == out["class_id"]).one()
    assert room.seats == 10 and _balance(db, room.wallet_user_id) == 10 * HERO
    assert _balance(db, teacher.id) == 0


def test_the_stand_in_never_runs_in_production(grow_env, client, monkeypatch):
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")
    r = client.post("/api/payments/grow-standin/api/light/server/1.0/createPaymentProcess",
                    files={"userId": (None, "standin-user")})
    assert r.status_code == 404


def test_the_notify_is_closed_unless_grow_sells(client, monkeypatch):
    monkeypatch.setenv("PAYMENTS_PROVIDER", "grow_sandbox")
    assert client.post("/api/payments/grow/notify/x/y", data={"a": "b"}).status_code == 404


def test_only_grows_live_host_is_real_money(monkeypatch):
    monkeypatch.setenv("GROW_API_BASE", "https://sandbox.meshulam.co.il")
    assert grow.test_mode() is True
    monkeypatch.setenv("GROW_API_BASE", "https://secure.meshulam.co.il")
    assert grow.test_mode() is False


def test_a_form_notify_is_read_as_grow_nests_it():
    body = grow.parse_notify_body(b"status=1&err=&data%5Bsum%5D=10.00&data%5BcustomFields%5D%5BcField1%5D=o1")
    assert body == {"status": "1", "err": "", "data": {"sum": "10.00", "customFields": {"cField1": "o1"}}}


def test_an_urlencoded_notify_credits_once_too(grow_env, client, make_user, db, calls):
    """Grow's docs say multipart; an account set to urlencoded must work alike."""
    user = make_user(credits=0)
    _checkout(client, user)
    order, url = _last_order(db, user.id), _notify_url(calls)
    form = _update(order)
    assert _post_notify(client, url, form, multipart=False).json()["status"] == "ok"
    assert _post_notify(client, url, form).json()["status"] == "ok"      # the same tx, multipart
    assert _balance(db, user.id) == HERO
