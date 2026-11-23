"""
Grow (formerly Meshulam): opening a payment page, and NOT yet trusting what
comes back.

Grow is the Israeli processor replacing Lemon Squeezy (docs/launch/READINESS.md).
It charges in shekels. This module is the only place that talks to it.

WHAT IS BUILT, AND WHAT IS NOT
------------------------------
Built, from Grow's public "Light API" docs (developers.grow.business):

* `create_payment_process`: POST {GROW_API_BASE}/api/light/server/1.0/
  createPaymentProcess, multipart/form-data, server side only, and return the
  hosted payment page's URL.

NOT built, on purpose:

* Crediting a buyer from a callback. Grow's docs do not say how a callback to
  `notifyUrl` is authenticated, so a callback is anyone's word. The notify
  endpoint (app/api/payments.py) stores it as unverified and grants nothing.
  Before credits move it needs: (1) a way to verify the callback (a signature,
  or a server-side lookup of the transaction by id), and (2) the
  `approveTransaction` call Grow requires after a callback. Neither is
  documented publicly; both are asked of Grow's API team.

* Custom fields (cField1..9) are NOT proof of anything. We put them on the
  payment page, but anyone can open a page with whatever fields they like
  (the same trap as Lemon Squeezy's custom_data, CLAUDE.md).

Configuration is from the environment, nothing secret is committed:

    GROW_API_BASE   https://sandbox.meshulam.co.il for the sandbox; the
                    production base is not published yet
    GROW_USER_ID    the merchant's userId
    GROW_PAGE_CODE  the payment page's pageCode
"""
import logging
import os
import re
from typing import Any, Dict, Mapping, NamedTuple, Optional

import requests

logger = logging.getLogger(__name__)

SANDBOX_API_BASE = "https://sandbox.meshulam.co.il"
CREATE_PATH = "/api/light/server/1.0/createPaymentProcess"
TIMEOUT_SECONDS = 20
MAX_CUSTOM_FIELDS = 9


class GrowError(RuntimeError):
    """Grow refused a request, or answered with something unusable.
    Ours to fix, not the buyer's: answer 502."""
    status_code = 502


class NotConfiguredError(GrowError):
    """GROW_API_BASE, GROW_USER_ID or GROW_PAGE_CODE is missing: answer 503."""
    status_code = 503


class InvalidBuyerError(ValueError):
    """The buyer's name or phone will not be accepted by Grow: answer 422."""
    status_code = 422


class PaymentPage(NamedTuple):
    url: str
    # Grow's handles for this payment, when the response carries them. Kept
    # for the future server-side lookup of a callback; never shown to a buyer.
    process_id: Optional[str] = None
    process_token: Optional[str] = None


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


def can_sell() -> bool:
    """May a payment page be opened? Only with the base URL, userId and
    pageCode all set. Note this says nothing about crediting: no callback is
    trusted yet, so nothing should be put on sale through Grow until it is."""
    return bool(api_base() and user_id() and page_code())


def test_mode() -> bool:
    """True when pointed at Grow's sandbox (or at nothing at all): the safe
    way to be wrong."""
    base = api_base()
    return base is None or "sandbox" in base.lower()


def config_status() -> Dict[str, Any]:
    """What is set and what is missing, WITHOUT revealing any value."""
    return {
        "api_base_set": api_base() is not None,
        "user_id_set": user_id() is not None,
        "page_code_set": page_code() is not None,
        "test_mode": test_mode(),
        "can_open_payment_page": can_sell(),
        # Always False until a callback can be authenticated.
        "callbacks_verified": False,
    }


# --------------------------------------------------------------------------
# The buyer: Grow requires a full name and an Israeli mobile number
# --------------------------------------------------------------------------

_MOBILE = re.compile(r"^05\d{8}$")


def normalize_israeli_mobile(phone: str) -> str:
    """
    An Israeli mobile number as Grow wants it: ten digits starting 05.
    Accepts spaces, dashes, dots, brackets and a +972 / 972 prefix.
    Raises InvalidBuyerError for anything else.
    """
    digits = re.sub(r"[\s\-().]", "", phone or "")
    if digits.startswith("+"):
        digits = digits[1:]
    if digits.startswith("972"):
        digits = "0" + digits[3:].lstrip("0")
    if not _MOBILE.match(digits):
        raise InvalidBuyerError("Enter an Israeli mobile number, like 050-1234567.")
    return digits


def normalize_full_name(full_name: str) -> str:
    """At least two words (first and last name), as Grow requires."""
    words = (full_name or "").split()
    if len(words) < 2 or any(len(w) < 2 for w in words[:2]):
        raise InvalidBuyerError("Enter a first and last name.")
    name = " ".join(words)
    if len(name) > 100:
        raise InvalidBuyerError("That name is too long.")
    return name


def format_sum(amount_agorot: int) -> str:
    """Agorot as the number Grow reads: 1900 -> "19", 1950 -> "19.50"."""
    amount = int(amount_agorot)
    if amount <= 0:
        raise ValueError("A payment is for a positive amount")
    shekels, agorot = divmod(amount, 100)
    return str(shekels) if agorot == 0 else f"{shekels}.{agorot:02d}"


# --------------------------------------------------------------------------
# Opening a payment page
# --------------------------------------------------------------------------

def create_payment_process(
    amount_agorot: int,
    description: str,
    full_name: str,
    phone: str,
    success_url: str,
    cancel_url: str,
    custom_fields: Optional[Mapping[int, str]] = None,
    email: Optional[str] = None,
    notify_url: Optional[str] = None,
) -> PaymentPage:
    """
    Ask Grow for a hosted payment page for `amount_agorot` (ILS, in agorot)
    and return it. Nothing is charged here.

    `custom_fields` maps 1..9 to the value of cField1..cField9. They come back
    on the callback, but they are NOT proof of payment (module docstring).

    Raises InvalidBuyerError (422) for a bad name or phone, NotConfiguredError
    (503) when Grow is not configured, and GrowError (502) when Grow says no.
    """
    if not can_sell():
        raise NotConfiguredError(
            "Grow is not configured; set GROW_API_BASE, GROW_USER_ID and GROW_PAGE_CODE"
        )
    form: Dict[str, str] = {
        "pageCode": page_code(),
        "userId": user_id(),
        "sum": format_sum(amount_agorot),
        "successUrl": success_url,
        "cancelUrl": cancel_url,
        "description": description,
        "pageField[fullName]": normalize_full_name(full_name),
        "pageField[phone]": normalize_israeli_mobile(phone),
        "chargeType": "1",  # a regular, one-off charge
    }
    if email:
        form["pageField[email]"] = email
    if notify_url:
        form["notifyUrl"] = notify_url
    for index, value in (custom_fields or {}).items():
        if not 1 <= int(index) <= MAX_CUSTOM_FIELDS:
            raise ValueError(f"Grow has cField1..cField{MAX_CUSTOM_FIELDS}, not cField{index}")
        form[f"cField{int(index)}"] = str(value)

    try:
        response = requests.post(
            f"{api_base()}{CREATE_PATH}",
            # (None, value) makes every field a plain multipart part: Grow
            # wants multipart/form-data, and `data=` alone would send
            # application/x-www-form-urlencoded.
            files={key: (None, value) for key, value in form.items()},
            timeout=TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise GrowError(f"Could not reach Grow: {exc}") from exc

    if response.status_code >= 400:
        # Log their answer, never our request: it carries the buyer's name and phone.
        logger.error("Grow createPaymentProcess failed (%s): %s",
                     response.status_code, response.text[:500])
        raise GrowError(f"Grow rejected the payment process ({response.status_code})")

    try:
        body = response.json()
    except ValueError as exc:
        raise GrowError("Grow answered with something that is not JSON") from exc
    page = parse_payment_page(body)
    logger.info("Grow payment page opened (process %s, test_mode=%s)", page.process_id, test_mode())
    return page


def parse_payment_page(body: Any) -> PaymentPage:
    """
    The payment page out of a createPaymentProcess response.

    The exact keys are not documented. The expected shape is
    {"status": 1, "err": "", "data": {"processId", "processToken", "url"}};
    a top-level "url" is accepted too. A status other than 1, or no https URL,
    is a GrowError.
    """
    if not isinstance(body, dict):
        raise GrowError("Grow's response is not an object")
    status = body.get("status")
    if status is not None and str(status).strip() != "1":
        err = body.get("err")
        if isinstance(err, dict):
            err = err.get("message") or err
        raise GrowError(f"Grow refused the payment process: {str(err)[:200] or 'no reason given'}")

    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    url = data.get("url") or body.get("url")
    if not isinstance(url, str) or not url.startswith("https://"):
        raise GrowError("Grow returned no payment page URL")

    def _str(value):
        return str(value) if value not in (None, "") else None

    return PaymentPage(
        url=url,
        process_id=_str(data.get("processId") or body.get("processId")),
        process_token=_str(data.get("processToken") or body.get("processToken")),
    )


# --------------------------------------------------------------------------
# A callback, kept as evidence only
# --------------------------------------------------------------------------

# Callback keys whose VALUES are safe to keep: our own custom fields, and
# Grow's references and amounts. Every other value is withheld, because the
# callback's shape is undocumented and may carry card details, a name, a phone
# number or an ID number. Key NAMES are all kept, so the shape can be learned.
_KEEP_VALUES = {
    "cfield1", "cfield2", "cfield3", "cfield4", "cfield5",
    "cfield6", "cfield7", "cfield8", "cfield9",
    "sum", "status", "statuscode", "processid", "transactionid",
    "transactioncode", "transactiontypeid", "paymenttype", "asmachta",
    "paymentsnum", "allpaymentsnum", "paymentdate", "description",
}
WITHHELD = "[withheld]"
_MAX_KEYS = 100
_MAX_VALUE = 200


def _bare_key(key: str) -> str:
    """"data[cField1]" -> "cfield1": Grow may nest fields under data[...]."""
    match = re.fullmatch(r"\w+\[(\w+)\]", key)
    return (match.group(1) if match else key).lower()


def sanitize_callback(form: Mapping[str, Any]) -> Dict[str, str]:
    """The callback with every value not known to be harmless withheld."""
    out: Dict[str, str] = {}
    for key in list(form.keys())[:_MAX_KEYS]:
        name = str(key)[:_MAX_VALUE]
        out[name] = str(form[key])[:_MAX_VALUE] if _bare_key(name) in _KEEP_VALUES else WITHHELD
    return out


def callback_field(form: Mapping[str, Any], name: str) -> Optional[str]:
    """A field by its bare name, top level or nested under data[...]."""
    wanted = name.lower()
    for key, value in form.items():
        if _bare_key(str(key)) == wanted and value not in (None, ""):
            return str(value)[:_MAX_VALUE]
    return None
