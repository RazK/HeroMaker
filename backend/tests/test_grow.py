"""
Tests for the Grow (formerly Meshulam) client and its callback endpoint.

What must not be wrong:

  * a Grow callback NEVER changes a balance - it is not authenticated yet
  * a callback's card data, names and phone numbers are never stored
  * opening a payment page sends what Grow's docs ask for, and the three ways
    it can fail map to 503 (ours: unconfigured), 502 (Grow said no) and 422
    (the buyer's name or phone)
"""
import pytest
import requests
from fastapi.testclient import TestClient

from app.models import CreditTransaction, GrowNotification, Payment
from app.services import grow, ledger

PAGE = {
    "status": 1,
    "err": "",
    "data": {
        "processId": "123456",
        "processToken": "tok-abc",
        "url": "https://sandbox.meshulam.co.il/s/abcd-1234",
    },
}


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("GROW_API_BASE", "https://sandbox.meshulam.co.il/")
    monkeypatch.setenv("GROW_USER_ID", "test-user-id")
    monkeypatch.setenv("GROW_PAGE_CODE", "test-page-code")


@pytest.fixture
def client():
    from app.main import app
    return TestClient(app)


class FakeResponse:
    def __init__(self, body=None, status_code=200, text=None):
        self._body = body
        self.status_code = status_code
        self.text = text if text is not None else str(body)

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


@pytest.fixture
def grow_http(monkeypatch):
    """Records every POST to Grow and answers with `answer["response"]`."""
    calls = []
    answer = {"response": FakeResponse(PAGE)}

    def fake_post(url, **kwargs):
        calls.append({"url": url, **kwargs})
        if isinstance(answer["response"], Exception):
            raise answer["response"]
        return answer["response"]

    monkeypatch.setattr(grow.requests, "post", fake_post)
    return calls, answer


def open_page(**overrides):
    args = dict(
        amount_agorot=1900,
        description="HeroMaker credits",
        full_name="Dana Levi",
        phone="050-123-4567",
        success_url="https://app.example.test/?paid=1",
        cancel_url="https://app.example.test/",
        custom_fields={1: "user-1", 2: "starter", 3: "nonce-xyz"},
    )
    args.update(overrides)
    return grow.create_payment_process(**args)


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

@pytest.mark.parametrize("missing", ["GROW_API_BASE", "GROW_USER_ID", "GROW_PAGE_CODE"])
def test_cannot_sell_unless_fully_configured(configured, monkeypatch, missing):
    assert grow.can_sell() is True
    monkeypatch.delenv(missing)
    assert grow.can_sell() is False


def test_unconfigured_raises_503_and_calls_nobody(monkeypatch, grow_http):
    for name in ("GROW_API_BASE", "GROW_USER_ID", "GROW_PAGE_CODE"):
        monkeypatch.delenv(name, raising=False)
    calls, _ = grow_http
    with pytest.raises(grow.NotConfiguredError) as exc:
        open_page()
    assert exc.value.status_code == 503
    assert calls == []


def test_sandbox_is_test_mode(configured, monkeypatch):
    assert grow.test_mode() is True
    monkeypatch.setenv("GROW_API_BASE", "https://secure.example-grow.test")
    assert grow.test_mode() is False


def test_config_status_reveals_no_values(configured):
    status = grow.config_status()
    assert "test-user-id" not in str(status)
    assert "test-page-code" not in str(status)
    assert status["can_open_payment_page"] is True
    assert status["callbacks_verified"] is False


# --------------------------------------------------------------------------
# Opening a payment page
# --------------------------------------------------------------------------

def test_payment_page_request_is_what_grow_documents(configured, grow_http):
    calls, _ = grow_http
    page = open_page(email="dana@example.test", notify_url="https://api.example.test/api/payments/grow/notify")

    assert page.url == "https://sandbox.meshulam.co.il/s/abcd-1234"
    assert page.process_id == "123456"
    assert page.process_token == "tok-abc"

    (call,) = calls
    assert call["url"] == "https://sandbox.meshulam.co.il/api/light/server/1.0/createPaymentProcess"
    # multipart/form-data: every field is a (None, value) part.
    form = {k: v[1] for k, v in call["files"].items()}
    assert all(v[0] is None for v in call["files"].values())
    assert form == {
        "pageCode": "test-page-code",
        "userId": "test-user-id",
        "sum": "19",
        "successUrl": "https://app.example.test/?paid=1",
        "cancelUrl": "https://app.example.test/",
        "description": "HeroMaker credits",
        "pageField[fullName]": "Dana Levi",
        "pageField[phone]": "0501234567",
        "pageField[email]": "dana@example.test",
        "notifyUrl": "https://api.example.test/api/payments/grow/notify",
        "chargeType": "1",
        "cField1": "user-1",
        "cField2": "starter",
        "cField3": "nonce-xyz",
    }
    assert call["timeout"] == grow.TIMEOUT_SECONDS


@pytest.mark.parametrize("agorot, expected", [(1900, "19"), (1950, "19.50"), (16905, "169.05"), (1, "0.01")])
def test_sum_is_written_in_shekels(agorot, expected):
    assert grow.format_sum(agorot) == expected


def test_sum_must_be_positive():
    with pytest.raises(ValueError):
        grow.format_sum(0)


def test_there_are_only_nine_custom_fields(configured, grow_http):
    with pytest.raises(ValueError):
        open_page(custom_fields={10: "x"})


@pytest.mark.parametrize("phone, normal", [
    ("0501234567", "0501234567"),
    ("050-123-4567", "0501234567"),
    ("+972 50 123 4567", "0501234567"),
    ("972-54-7654321", "0547654321"),
    ("(052) 111.2233", "0521112233"),
])
def test_israeli_mobiles_are_accepted_and_normalised(phone, normal):
    assert grow.normalize_israeli_mobile(phone) == normal


@pytest.mark.parametrize("phone", ["", "02-1234567", "050123456", "05012345678", "+1 415 555 0100", "abc"])
def test_anything_else_is_not_a_mobile(phone):
    with pytest.raises(grow.InvalidBuyerError) as exc:
        grow.normalize_israeli_mobile(phone)
    assert exc.value.status_code == 422


@pytest.mark.parametrize("name", ["", "Dana", "  Dana  ", "D L"])
def test_grow_needs_a_first_and_last_name(name):
    with pytest.raises(grow.InvalidBuyerError):
        grow.normalize_full_name(name)


def test_a_bad_phone_never_reaches_grow(configured, grow_http):
    calls, _ = grow_http
    with pytest.raises(grow.InvalidBuyerError):
        open_page(phone="03-1234567")
    assert calls == []


@pytest.mark.parametrize("response", [
    FakeResponse({"status": 0, "err": "pageCode invalid", "data": ""}),
    FakeResponse({"status": 1, "data": {"processId": "1"}}),            # no url
    FakeResponse({"status": 1, "data": {"url": "http://insecure"}}),     # not https
    FakeResponse(ValueError("not json"), text="<html>"),
    FakeResponse({"message": "nope"}, status_code=500),
    requests.ConnectionError("down"),
])
def test_grow_refusing_is_a_502(configured, grow_http, response):
    _, answer = grow_http
    answer["response"] = response
    with pytest.raises(grow.GrowError) as exc:
        open_page()
    assert exc.value.status_code == 502
    assert not isinstance(exc.value, grow.NotConfiguredError)


def test_parser_accepts_a_top_level_url():
    page = grow.parse_payment_page({"url": "https://pay.example.test/x"})
    assert page == grow.PaymentPage(url="https://pay.example.test/x")


def test_parser_reads_the_documented_shape():
    assert grow.parse_payment_page(PAGE).url == PAGE["data"]["url"]


# --------------------------------------------------------------------------
# The callback: stored, never believed
# --------------------------------------------------------------------------

CALLBACK = {
    "data[processId]": "123456",
    "data[transactionId]": "987654",
    "data[sum]": "19",
    "data[cField1]": "",  # filled per test
    "data[cField2]": "studio",
    "data[fullName]": "Dana Levi",
    "data[payerPhone]": "0501234567",
    "data[payerEmail]": "dana@example.test",
    "data[cardSuffix]": "4580",
    "data[cardExp]": "1230",
    "data[cardBrand]": "Visa",
    "status": "1",
}


def test_a_callback_never_changes_a_balance(client, make_user, db):
    user = make_user(credits=7)
    body = {**CALLBACK, "data[cField1]": user.id}

    for _ in range(3):
        response = client.post("/api/payments/grow/notify", data=body)
        assert response.status_code == 200
        assert response.json() == {"status": "received", "verified": False, "credits_granted": 0}

    db.expire_all()
    assert ledger.get_balance(user.id, db) == 7
    assert ledger.get_ledger_balance(user.id, db) == 7
    assert db.query(CreditTransaction).filter(CreditTransaction.reason == "purchase").count() == 0
    assert db.query(Payment).count() == 0


def test_a_callback_is_stored_unverified_without_card_or_personal_data(client, db):
    client.post("/api/payments/grow/notify", data={**CALLBACK, "data[cField1]": "user-1"})

    (row,) = db.query(GrowNotification).all()
    assert row.verified is False
    assert row.process_id == "123456"
    assert row.transaction_id == "987654"
    # Every key name is kept, so the shape can be learned...
    assert set(row.fields) == set(CALLBACK)
    # ...our own fields and Grow's references keep their values...
    assert row.fields["data[cField1]"] == "user-1"
    assert row.fields["data[sum]"] == "19"
    # ...and nothing about the card or the person does.
    stored = str(row.fields)
    for secret in ("Dana", "0501234567", "dana@example.test", "4580", "1230", "Visa"):
        assert secret not in stored, secret


def test_an_empty_or_odd_callback_is_still_a_200(client, db):
    assert client.post("/api/payments/grow/notify").status_code == 200
    assert client.post("/api/payments/grow/notify", content=b"\x00\xff",
                       headers={"Content-Type": "application/json"}).status_code == 200
