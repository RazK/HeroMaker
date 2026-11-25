"""
Grow (formerly Meshulam): the real payment provider, PAYMENTS_PROVIDER=grow.

Grow charges in shekels. This module is the only place that talks to it, over
Grow's "Light API" (developers.grow.business, read 2026-11-24/25):

    create_checkout          stores OUR order, then POST createPaymentProcess
                             (multipart, server side) -> Grow's hosted page URL
    Grow -> notifyUrl        a server-to-server form POST when the buyer paid
    verify_notify            decides whether that POST is Grow's, about OUR order
    approve_transaction      POST approveTransaction, which Grow requires after
                             each successful payment (else it resends the update)

Credits are granted ONLY from a verified notify (app/api/payments.py,
handle_grow_notify), never because the browser came back to successUrl.

HOW A NOTIFY IS VERIFIED
------------------------
Grow's docs describe no signature, secret or IP list for the server update,
and no transaction lookup. So the proof is built from two things only Grow
and our server ever hold:

1. The notify URL itself. Each order's notifyUrl carries a token as its
   last path segment, HMAC-SHA256(GROW_NOTIFY_SECRET, order id). We send that URL to Grow
   server to server; it is never shown to a browser. A POST without the
   right token for that order is rejected (401).
2. Grow's processId and processToken for the order. createPaymentProcess
   returns them to our server, and we store them on the order. The notify
   must carry the same pair, or it is rejected.

Then the order's own facts decide what is granted: the stored product, credits
and price. A notify whose sum differs from the stored price grants nothing.
cField1 carries our order id, which is only a lookup key. If Grow later
documents a signature, `verify_notify` is the one function to extend.

Configuration, from the environment; nothing secret is committed:

    GROW_API_BASE       https://sandbox.meshulam.co.il for Grow's sandbox,
                        https://secure.meshulam.co.il for live
    GROW_USER_ID        the merchant's userId (Grow issues it)
    GROW_PAGE_CODE      the payment page's pageCode (Grow issues it)
    GROW_API_KEY        the API key, when Grow issues one (sent as apiKey)
    GROW_NOTIFY_SECRET  ours: signs each order's notifyUrl. A Railway shared var.

Nothing is sold unless all of base, userId, pageCode and the notify secret are
set (`can_sell`): without the secret a buyer could pay and never be credited.
"""
import hashlib
import hmac
import json
import logging
import os
import re
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Mapping, Optional, Tuple
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import requests
from sqlalchemy.orm import Session

from app.config import packs
from app.config.settings import get_frontend_url
from app.models import CheckoutOrder

logger = logging.getLogger(__name__)

NAME = "grow"
API_PATH = "/api/light/server/1.0"
CREATE_PATH = f"{API_PATH}/createPaymentProcess"
APPROVE_PATH = f"{API_PATH}/approveTransaction"
NOTIFY_PATH = "/api/payments/grow/notify"
TIMEOUT_SECONDS = 20

# Grow's answers: top-level `status` "1" is a successful call; in a server
# update, data.statusCode "2" is a paid transaction (docs' sample: "שולם").
CALL_OK = "1"
STATUS_PAID = "2"

KIND_PACK = "pack"
KIND_CLASS_SEATS = packs.CLASS_SEATS_SLUG

# What approveTransaction is sent: pageCode plus "all data received" from the
# server update. These are the fields its reference lists.
APPROVE_FIELDS = (
    "transactionId", "transactionToken", "transactionTypeId", "paymentType", "sum",
    "firstPaymentSum", "periodicalPaymentSum", "paymentsNum", "allPaymentsNum",
    "paymentDate", "asmachta", "description", "fullName", "payerPhone", "payerEmail",
    "cardSuffix", "cardType", "cardTypeCode", "cardBrand", "cardBrandCode", "cardExp",
    "processId", "processToken",
)


class GrowError(RuntimeError):
    """Grow refused, or answered with something unusable: ours, 502."""


class NotConfiguredError(GrowError):
    """Grow cannot sell here (an identifier or the notify secret is missing): 503."""


class SeatsError(GrowError):
    """A class seat order outside what the shekel price sells."""


class NotifyRejected(GrowError):
    """A notify that is not provably Grow's, about this order: 401."""


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

def _env(name: str) -> Optional[str]:
    value = os.getenv(name, "").strip()
    return value or None


def api_base() -> Optional[str]:
    value = _env("GROW_API_BASE")
    return value.rstrip("/") if value else None


def user_id() -> Optional[str]:
    return _env("GROW_USER_ID")


def page_code() -> Optional[str]:
    return _env("GROW_PAGE_CODE")


def api_key() -> Optional[str]:
    return _env("GROW_API_KEY")


def notify_secret() -> Optional[str]:
    return _env("GROW_NOTIFY_SECRET")


def can_sell() -> bool:
    """A checkout may open only when Grow can be called AND its answer can be
    verified: base, userId, pageCode and the notify secret all set."""
    return bool(api_base() and user_id() and page_code() and notify_secret())


def test_mode() -> bool:
    """True unless pointed at Grow's live host. The safe way to be wrong: a
    stand-in or the sandbox is test; only secure.meshulam.co.il is money."""
    base = api_base() or ""
    host = (urlsplit(base).hostname or "").lower()
    return host != "secure.meshulam.co.il"


def config_status() -> Dict[str, Any]:
    """What is set and what is missing, WITHOUT any value."""
    return {
        "api_base_set": api_base() is not None,
        "user_id_set": user_id() is not None,
        "page_code_set": page_code() is not None,
        "api_key_set": api_key() is not None,
        "notify_secret_set": notify_secret() is not None,
        "test_mode": test_mode(),
        "can_sell": can_sell(),
    }


def list_packs():
    return packs.get_ils_products() if can_sell() else []


def seat_price() -> Optional[Dict[str, Any]]:
    if not can_sell():
        return None
    return {
        "order_cents": 0,
        "seat_cents": packs.CLASS_SEAT_AGOROT,
        "max_seats": packs.CLASS_MAX_SEATS,
        "min_seats": packs.CLASS_MIN_SEATS_ILS,
        "currency": packs.ILS,
        "seat_display": packs.agorot_display(packs.CLASS_SEAT_AGOROT),
    }


# --------------------------------------------------------------------------
# The notify URL and its token
# --------------------------------------------------------------------------

def notify_token(order_id: str) -> str:
    key = notify_secret()
    if not key:
        raise NotConfiguredError("GROW_NOTIFY_SECRET is not set")
    return hmac.new(key.encode("utf-8"), str(order_id).encode("utf-8"), hashlib.sha256).hexdigest()


def notify_url(order_id: str) -> str:
    """Where Grow sends the server update for one order. On the frontend's own
    origin, which proxies /api/ to this backend, like every other call.

    The token is a PATH segment, not a query parameter: we register this URL
    with Grow ourselves, and a path survives whether or not Grow keeps a
    query string when it posts. A dropped ?t= would have refused every real
    payment (the buyer pays and gets nothing)."""
    return f"{get_frontend_url()}{NOTIFY_PATH}/{order_id}/{notify_token(order_id)}"


def token_ok(order_id: str, token: Optional[str]) -> bool:
    if not token or not notify_secret():
        return False
    return hmac.compare_digest(notify_token(order_id), token.strip())


# --------------------------------------------------------------------------
# Opening a checkout
# --------------------------------------------------------------------------

def _with_param(url: str, key: str, value: str) -> str:
    parts = urlsplit(url)
    query = parse_qsl(parts.query, keep_blank_values=True) + [(key, value)]
    return urlunsplit(parts._replace(query=urlencode(query)))


def safe_return_url(url: Optional[str]) -> str:
    """Our own frontend only; never an arbitrary site."""
    from app.services import grow_sandbox  # the same rule, one implementation
    return grow_sandbox.safe_return_url(url)


def _post(path: str, fields: Dict[str, Any]) -> Dict[str, Any]:
    """One multipart POST to Grow. Returns `data` of a status-1 answer."""
    base = api_base()
    if not base:
        raise NotConfiguredError("GROW_API_BASE is not set")
    # multipart/form-data, as every Grow call is: (None, value) parts.
    files = {k: (None, str(v)) for k, v in fields.items() if v is not None and v != ""}
    try:
        resp = requests.post(f"{base}{path}", files=files, timeout=TIMEOUT_SECONDS)
    except requests.RequestException as exc:
        raise GrowError(f"Grow unreachable at {path}: {type(exc).__name__}") from exc
    try:
        body = resp.json()
    except ValueError as exc:
        raise GrowError(f"Grow answered {path} with HTTP {resp.status_code}, not JSON") from exc
    if str(body.get("status")) != CALL_OK:
        err = body.get("err")
        message = err.get("message") if isinstance(err, dict) else err
        code = err.get("id") if isinstance(err, dict) else None
        # The error text, never the fields we sent (they include identifiers).
        raise GrowError(f"Grow refused {path}: {code} {message}")
    data = body.get("data")
    return data if isinstance(data, dict) else {}


def _store_order(db: Session, **fields) -> CheckoutOrder:
    order = CheckoutOrder(provider=NAME, currency=packs.ILS, status="pending", **fields)
    db.add(order)
    db.commit()
    db.refresh(order)
    return order


_HEBREW_OR_LATIN_NAME = re.compile(r"^[^\W\d_]+(?:[ '\-][^\W\d_]+)+$")


def _open_page(db: Session, order: CheckoutOrder, description: str,
               full_name: Optional[str], email: Optional[str]) -> str:
    """createPaymentProcess for a stored order; keep Grow's handles on it."""
    back = order.redirect_url or safe_return_url(None)
    fields = {
        "pageCode": page_code(),
        "userId": user_id(),
        "apiKey": api_key(),
        "sum": f"{Decimal(order.amount_minor) / 100:.2f}",
        "description": description,
        "successUrl": back,
        "cancelUrl": _with_param(back, "checkout", "failed"),
        "notifyUrl": notify_url(order.id),
        "cField1": order.id,
        "pageField[email]": email,
        # Grow wants at least two names; otherwise its page asks the buyer.
        "pageField[fullName]": full_name if full_name and _HEBREW_OR_LATIN_NAME.match(full_name.strip()) else None,
    }
    if not (fields["pageCode"] and fields["userId"]):
        raise NotConfiguredError("GROW_USER_ID and GROW_PAGE_CODE must be set")
    try:
        data = _post(CREATE_PATH, fields)
    except GrowError:
        order.status = "failed"
        db.commit()
        raise
    url = data.get("url")
    if not url:
        order.status = "failed"
        db.commit()
        raise GrowError("Grow's createPaymentProcess answer has no url")
    order.metadata_json = {
        **(order.metadata_json or {}),
        "grow_process_id": str(data.get("processId") or ""),
        "grow_process_token": str(data.get("processToken") or ""),
    }
    db.commit()
    return str(url)


def create_checkout(db: Session, pack: Dict[str, Any], user_id: str,
                    email: Optional[str] = None, redirect_url: Optional[str] = None,
                    full_name: Optional[str] = None) -> str:
    if not can_sell():
        raise NotConfiguredError("Grow is not configured here")
    product = packs.get_ils_product(pack["slug"])
    if product is None:
        raise GrowError(f"{pack['slug']!r} is not sold in shekels")
    order = _store_order(
        db, user_id=str(user_id), kind=KIND_PACK, product=product["slug"],
        credits=product["credits"], amount_minor=product["price_agorot"],
        redirect_url=safe_return_url(redirect_url),
        metadata_json={"name": product["name"], "heroes": product["heroes"]},
    )
    return _open_page(db, order, f"HeroMaker - {product['name']}", full_name, email)


def create_class_seats_checkout(db: Session, class_id: str, class_title: str, seats: int,
                                user_id: str, email: Optional[str] = None,
                                redirect_url: Optional[str] = None) -> Tuple[str, Dict[str, Any]]:
    if not can_sell():
        raise NotConfiguredError("Grow is not configured here")
    seats = int(seats)
    if seats < packs.CLASS_MIN_SEATS_ILS or seats > packs.CLASS_MAX_SEATS:
        raise SeatsError(f"A class order is for {packs.CLASS_MIN_SEATS_ILS} to {packs.CLASS_MAX_SEATS} seats")
    quote = packs.class_seats_ils_quote(seats)
    order = _store_order(
        db, user_id=str(user_id), kind=KIND_CLASS_SEATS, product=packs.CLASS_SEATS_SLUG,
        class_id=str(class_id), seats=seats, credits=quote["credits"],
        amount_minor=quote["price_agorot"], redirect_url=safe_return_url(redirect_url),
        metadata_json={"name": f"{seats} class seats", "class_title": class_title},
    )
    return _open_page(db, order, f"HeroMaker - {seats} class seats", None, email), quote


# --------------------------------------------------------------------------
# The server update (notify)
# --------------------------------------------------------------------------

_BRACKETS = re.compile(r"\[([^\]]*)\]")


def _nest(pairs) -> Dict[str, Any]:
    """'data[customFields][cField1]=x' -> {'data': {'customFields': {'cField1': 'x'}}}."""
    out: Dict[str, Any] = {}
    for key, value in pairs:
        head = key.split("[", 1)[0]
        path = [head] + _BRACKETS.findall(key[len(head):])
        node = out
        for part in path[:-1]:
            nxt = node.get(part)
            if not isinstance(nxt, dict):
                nxt = node[part] = {}
            node = nxt
        node[path[-1]] = value
    return out


def parse_notify_body(raw: bytes, content_type: str = "") -> Dict[str, Any]:
    """Grow posts form data "the same way as you send CreatePaymentProcess,
    NOT as JSON". Accept urlencoded, multipart already decoded by the caller
    (pass a dict), and JSON in case Grow's account is set to it."""
    text = raw.decode("utf-8", errors="replace").strip()
    if "json" in content_type.lower() or text.startswith("{"):
        try:
            body = json.loads(text)
        except ValueError as exc:
            raise GrowError("Notify body is not readable JSON") from exc
        if not isinstance(body, dict):
            raise GrowError("Notify body is not an object")
        return body
    return _nest(parse_qsl(text, keep_blank_values=True))


def from_form(items) -> Dict[str, Any]:
    """A decoded multipart form (key, value pairs) -> the nested body."""
    return _nest([(k, v) for k, v in items if isinstance(v, str)])


def _agorot(value: Any) -> int:
    try:
        amount = Decimal(str(value).strip()) * 100
    except (InvalidOperation, ValueError) as exc:
        raise GrowError(f"Unreadable sum {value!r}") from exc
    if amount != amount.to_integral_value() or amount < 0:
        raise GrowError(f"Unusable sum {value!r}")
    return int(amount)


def notify_data(body: Mapping[str, Any]) -> Dict[str, Any]:
    """The `data` object, whether Grow nested it or sent it flat."""
    data = body.get("data")
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except ValueError:
            data = None
    if not isinstance(data, dict):
        data = {k: v for k, v in body.items() if k not in ("status", "err")}
    return data


def verify_notify(order: CheckoutOrder, token: Optional[str], body: Mapping[str, Any]) -> Dict[str, Any]:
    """
    Raise NotifyRejected unless this body is provably Grow's update for
    `order` (see the module docstring), and return what the handler needs:

        transaction_id, sum_minor, paid, status, data (for approveTransaction)
    """
    if not token_ok(order.id, token):
        raise NotifyRejected("notify token does not match the order")
    data = notify_data(body)
    meta = order.metadata_json or {}
    want_pid, want_ptok = meta.get("grow_process_id"), meta.get("grow_process_token")
    if not want_pid or not want_ptok:
        raise NotifyRejected("the order holds no Grow process to match")
    if not (hmac.compare_digest(str(data.get("processId") or ""), want_pid)
            and hmac.compare_digest(str(data.get("processToken") or ""), want_ptok)):
        raise NotifyRejected("processId/processToken do not match the order")
    custom = data.get("customFields") if isinstance(data.get("customFields"), dict) else {}
    named = custom.get("cField1") or data.get("cField1")
    if named and str(named) != order.id:
        raise NotifyRejected("cField1 names another order")
    transaction_id = data.get("transactionId")
    if not transaction_id or data.get("sum") in (None, ""):
        raise GrowError("Notify names no transaction or sum")
    return {
        "transaction_id": str(transaction_id),
        "sum_minor": _agorot(data["sum"]),
        "paid": str(body.get("status", CALL_OK)) == CALL_OK and str(data.get("statusCode")) == STATUS_PAID,
        "status": str(data.get("statusCode")),
        "asmachta": str(data.get("asmachta") or ""),
        "data": data,
    }


def approve_transaction(data: Mapping[str, Any]) -> bool:
    """Tell Grow we received the update. Never raises: Grow processes the
    payment either way, and resends the update if this fails, which is a
    harmless replay (the grant is keyed on the transaction)."""
    fields = {"pageCode": page_code()}
    for key in APPROVE_FIELDS:
        value = data.get(key)
        if value not in (None, ""):
            fields[key] = value
    try:
        _post(APPROVE_PATH, fields)
        return True
    except GrowError as exc:
        logger.error("approveTransaction for transaction %s failed: %s", data.get("transactionId"), exc)
        return False
