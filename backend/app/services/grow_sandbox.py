"""
grow_sandbox: our own test mode for payments, shaped like Grow.

Grow (Israeli, charges in ILS) is the next payment provider, and its API
details are not in yet. This module lets the whole purchase path run on
staging before they are: a checkout opens, a buyer presses Pay, a SIGNED
server-to-server callback arrives, credits are granted by the same ledger
function a real sale uses, and a receipt shows. Only the hosted card page is
fake, and it says so: "TEST - no real money".

    create_checkout             stores OUR order, returns our fake page's URL
    GET  /api/payments/sandbox/checkout/<order>         the fake hosted page
    POST /api/payments/sandbox/checkout/<order>/pay     the SERVER sends the callback
    POST /api/payments/sandbox/checkout/<order>/fail    marks the order failed
    POST /api/payments/grow/callback                    verify, then grant

THE BROWSER NEVER SAYS A PAYMENT HAPPENED, here either. Pressing Pay does not
grant anything; it makes the server build and sign a callback and hand it to
the callback handler, which verifies the signature exactly as it would for a
request from outside. Fail only marks the order failed, which grants nothing.

SAFETY: the sandbox never arms in production
--------------------------------------------
`armed()` is False when RAILWAY_ENVIRONMENT_NAME is "production" (the same
variable frontend/apply-env-look.sh reads), and when GROW_SANDBOX_SECRET is
unset. Disarmed, nothing is listed, no checkout opens, and the page, its
buttons and the callback all answer 404. Setting PAYMENTS_PROVIDER=grow_sandbox
on production therefore sells nothing, and logs why.

The callback body is shaped like Grow's notifyUrl callback where that is known
(transactionId, processId, sum, statusCode, cField1...). The signature is ours:
Grow has not said how a real callback is authenticated. `verify_callback` is
the one function to replace when they do.
"""
import hashlib
import hmac
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Mapping, Optional, Tuple
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from app.config import packs
from app.config.settings import get_frontend_url
from app.models import CheckoutOrder

logger = logging.getLogger(__name__)

NAME = "grow_sandbox"
SECRET_ENV = "GROW_SANDBOX_SECRET"
SIGNATURE_HEADER = "X-Sandbox-Signature"
CHECKOUT_PATH = "/api/payments/sandbox/checkout"

# Grow's callback: `status` "1" is a successful call, and `statusCode` "2" is
# a paid transaction. Ours until Grow's docs confirm them.
CALLBACK_OK = "1"
STATUS_PAID = "2"

KIND_PACK = "pack"
KIND_CLASS_SEATS = packs.CLASS_SEATS_SLUG


class SandboxError(RuntimeError):
    """A sandbox order or callback is unusable."""


class NotArmedError(SandboxError):
    """The sandbox is off here: production, or no GROW_SANDBOX_SECRET."""


class SeatsError(SandboxError):
    """A class seat order outside what the shekel price sells."""


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

def secret() -> Optional[str]:
    value = os.getenv(SECRET_ENV, "").strip()
    return value or None


def is_production() -> bool:
    return os.getenv("RAILWAY_ENVIRONMENT_NAME", "").strip().lower() == "production"


_warned_production = False


def armed() -> bool:
    """
    May the sandbox take a (pretend) order here? Never in production, never
    without the signing secret. Everything else in this module asks this.
    """
    global _warned_production
    if is_production():
        if not _warned_production:
            logger.warning(
                "PAYMENTS_PROVIDER=grow_sandbox on production: the sandbox refuses to arm; "
                "nothing is sold"
            )
            _warned_production = True
        return False
    return secret() is not None


def can_sell() -> bool:
    return armed()


def test_mode() -> bool:
    """Always: no money moves through the sandbox."""
    return True


def list_packs():
    return packs.get_ils_products() if armed() else []


def get_pack(slug: str) -> Optional[Dict[str, Any]]:
    return packs.get_ils_product(slug)


def seat_price() -> Optional[Dict[str, Any]]:
    """The class price, shaped like Lemon Squeezy's (order part + seat part, in
    the currency's cents), plus the currency and the smallest order."""
    if not armed():
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
# Opening a checkout
# --------------------------------------------------------------------------

def checkout_url(order_id: str) -> str:
    """The fake hosted page, on the frontend's own origin: nginx sends /api/
    to this backend, as it does for every call the app makes."""
    return f"{get_frontend_url()}{CHECKOUT_PATH}/{order_id}"


def safe_return_url(url: Optional[str]) -> str:
    """Where the page sends the buyer afterwards: the URL the site passed when
    it is on our own frontend, else the frontend's home. Never an arbitrary
    site - the page must not be a redirector."""
    home = get_frontend_url()
    if not url:
        return home + "/"
    allowed = {_origin(home)}
    for origin in os.getenv("ALLOWED_ORIGINS", "").split(","):
        if origin.strip() and origin.strip() != "*":
            allowed.add(_origin(origin.strip()))
    return url if _origin(url) in allowed else home + "/"


def _origin(url: str) -> Tuple[str, str]:
    parts = urlsplit(url)
    return parts.scheme.lower(), parts.netloc.lower()


def _store_order(db: Session, **fields) -> CheckoutOrder:
    order = CheckoutOrder(provider=NAME, currency=packs.ILS, status="pending", **fields)
    db.add(order)
    db.commit()
    db.refresh(order)
    return order


def create_checkout(
    db: Session,
    pack: Dict[str, Any],
    user_id: str,
    email: Optional[str] = None,
    redirect_url: Optional[str] = None,
) -> str:
    """Store OUR order for `pack` and return the fake page's URL. Nothing is
    charged and no credits move here."""
    if not armed():
        raise NotArmedError("The payments sandbox is not armed here")
    product = packs.get_ils_product(pack["slug"])
    if product is None:
        raise SandboxError(f"{pack['slug']!r} is not sold in shekels")
    order = _store_order(
        db, user_id=str(user_id), kind=KIND_PACK, product=product["slug"],
        credits=product["credits"], amount_minor=product["price_agorot"],
        redirect_url=safe_return_url(redirect_url),
        metadata_json={"name": product["name"], "heroes": product["heroes"]},
    )
    return checkout_url(order.id)


def create_class_seats_checkout(
    db: Session,
    class_id: str,
    class_title: str,
    seats: int,
    user_id: str,
    email: Optional[str] = None,
    redirect_url: Optional[str] = None,
) -> Tuple[str, Dict[str, Any]]:
    """An order for `seats` seats of ONE class, at the shekel class price.
    Returns (page url, the quote it was opened at)."""
    if not armed():
        raise NotArmedError("The payments sandbox is not armed here")
    seats = int(seats)
    if seats < packs.CLASS_MIN_SEATS_ILS or seats > packs.CLASS_MAX_SEATS:
        raise SeatsError(
            f"A class order is for {packs.CLASS_MIN_SEATS_ILS} to {packs.CLASS_MAX_SEATS} seats"
        )
    quote = packs.class_seats_ils_quote(seats)
    order = _store_order(
        db, user_id=str(user_id), kind=KIND_CLASS_SEATS, product=packs.CLASS_SEATS_SLUG,
        class_id=str(class_id), seats=seats, credits=quote["credits"],
        amount_minor=quote["price_agorot"], redirect_url=safe_return_url(redirect_url),
        metadata_json={"name": f"{seats} class seats", "class_title": class_title},
    )
    return checkout_url(order.id), quote


# --------------------------------------------------------------------------
# The callback: built and signed by us, verified like anyone's
# --------------------------------------------------------------------------

def sign(raw_body: bytes) -> str:
    key = secret()
    if not key:
        raise NotArmedError(f"{SECRET_ENV} is not set")
    return hmac.new(key.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()


def callback_body(order: CheckoutOrder, transaction_id: str) -> bytes:
    """
    What Grow would POST to our notifyUrl for a paid `order`, as JSON. The
    sum is in shekels with two decimals, as Grow writes it; cField1 carries
    our order id, the one thing the handler looks the order up by.
    """
    return json.dumps({
        "status": CALLBACK_OK,
        "err": "",
        "data": {
            "transactionId": transaction_id,
            "transactionToken": uuid.uuid4().hex,
            "transactionTypeId": "1",
            "paymentType": "2",
            "sum": f"{Decimal(order.amount_minor) / 100:.2f}",
            "paymentsNum": "1",
            "paymentDate": datetime.now(timezone.utc).strftime("%d/%m/%y"),
            "asmachta": transaction_id[-8:],
            "description": (order.metadata_json or {}).get("name") or order.product,
            "statusCode": STATUS_PAID,
            "processId": order.id,
            "processToken": order.id,
            "customFields": {"cField1": order.id},
        },
    }, separators=(",", ":")).encode("utf-8")


def verify_callback(raw_body: bytes, headers: Mapping[str, str]) -> bool:
    """
    True when `raw_body` really came from the payment server.

    Here: HMAC-SHA256 of the raw body with GROW_SANDBOX_SECRET, hex, in
    X-Sandbox-Signature, compared in constant time. False, never an
    exception, when the secret or the header is missing. Grow's real
    callback is authenticated however Grow says (a signature, or a lookup of
    the transaction by id); this is the function that changes.
    """
    key = secret()
    signature = headers.get(SIGNATURE_HEADER) if headers is not None else None
    if not key or not signature:
        return False
    expected = hmac.new(key.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature.strip())


def _agorot(value: Any) -> int:
    """'10.00' shekels -> 1000 agorot. A sum that is not whole agorot is
    unusable, not rounded."""
    try:
        amount = Decimal(str(value).strip()) * 100
    except (InvalidOperation, ValueError) as exc:
        raise SandboxError(f"Unreadable sum {value!r}") from exc
    if amount != amount.to_integral_value() or amount < 0:
        raise SandboxError(f"Unusable sum {value!r}")
    return int(amount)


def parse_callback(raw_body: bytes) -> Dict[str, Any]:
    """
    The few fields the handler needs, out of a callback body:

        transaction_id  the provider's id for the payment: the idempotency key
        order_id        OUR order id, from cField1
        sum_minor       what the callback says was paid, in agorot
        paid            whether it says the payment succeeded

    Raises SandboxError when the body is not a callback at all.
    """
    try:
        body = json.loads(raw_body)
    except (ValueError, UnicodeDecodeError) as exc:
        raise SandboxError("Callback body is not JSON") from exc
    if not isinstance(body, dict) or not isinstance(body.get("data"), dict):
        raise SandboxError("Callback body has no data object")
    data = body["data"]
    custom = data.get("customFields") if isinstance(data.get("customFields"), dict) else {}
    order_id = custom.get("cField1") or data.get("cField1")
    transaction_id = data.get("transactionId")
    if not order_id or not transaction_id or data.get("sum") is None:
        raise SandboxError("Callback names no order, transaction or sum")
    return {
        "transaction_id": str(transaction_id),
        "order_id": str(order_id),
        "sum_minor": _agorot(data["sum"]),
        "paid": str(body.get("status")) == CALLBACK_OK and str(data.get("statusCode")) == STATUS_PAID,
        "status": str(data.get("statusCode")),
    }


def new_transaction_id() -> str:
    return f"sbx-{uuid.uuid4().hex}"
