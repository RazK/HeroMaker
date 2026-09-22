"""
Lemon Squeezy: opening a checkout, and trusting what comes back.

Lemon Squeezy is our merchant of record. It takes the money, handles sales tax
and VAT, and tells us about it over a webhook. This module is the only place
that talks to it.

TWO THINGS MATTER HERE, AND THEY ARE BOTH SECURITY PROPERTIES
-------------------------------------------------------------
1. `verify_signature` must be the first thing the webhook endpoint does.
   Without it, anyone who learns the URL can POST themselves free credits.
   It is a constant-time HMAC-SHA256 comparison; do not "optimise" it into `==`.

2. The user id we credit comes from `custom_data.user_id`, which WE put into
   the checkout and Lemon Squeezy echoes back. We never credit by email: two
   accounts can share one, and a buyer can type someone else's into the
   checkout form.

Everything here reads its configuration from the environment, so the test and
live stores are the same code with different variables.
"""
import hashlib
import hmac
import logging
import os
from typing import Any, Dict, Optional

import requests

from app.config import packs

logger = logging.getLogger(__name__)

API_ROOT = "https://api.lemonsqueezy.com/v1"
TIMEOUT_SECONDS = 20

# Events we act on. Anything else is acknowledged and ignored - Lemon Squeezy
# sends a lot of subscription traffic we have no use for, and a 4xx on those
# would make it retry forever.
EVENT_ORDER_CREATED = "order_created"
EVENT_ORDER_REFUNDED = "order_refunded"
HANDLED_EVENTS = (EVENT_ORDER_CREATED, EVENT_ORDER_REFUNDED)


class LemonSqueezyError(RuntimeError):
    """Lemon Squeezy refused a request, or answered with something unusable."""


class NotConfiguredError(LemonSqueezyError):
    """The store's credentials are missing from the environment."""


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

def api_key() -> Optional[str]:
    value = os.getenv("LEMONSQUEEZY_API_KEY", "").strip()
    return value or None


def store_id() -> Optional[str]:
    value = os.getenv("LEMONSQUEEZY_STORE_ID", "").strip()
    return value or None


def webhook_secret() -> Optional[str]:
    value = os.getenv("LEMONSQUEEZY_WEBHOOK_SECRET", "").strip()
    return value or None


def test_mode() -> bool:
    """
    Whether we are pointed at the test store. Default TRUE: a deployment that
    forgets to set this takes no real money, which is the safe way to be wrong.
    """
    return os.getenv("LEMONSQUEEZY_TEST_MODE", "true").strip().lower() != "false"


def is_configured() -> bool:
    """Can we open a checkout at all?"""
    return bool(api_key() and store_id())


def config_status() -> Dict[str, Any]:
    """
    What is set and what is missing, WITHOUT revealing any value. Safe to
    return from an admin endpoint and safe to log.
    """
    configured_packs = [p["slug"] for p in packs.get_packs() if p["configured"]]
    missing_packs = [p["slug"] for p in packs.get_packs() if not p["configured"]]
    return {
        "api_key_set": api_key() is not None,
        "store_id_set": store_id() is not None,
        "webhook_secret_set": webhook_secret() is not None,
        "test_mode": test_mode(),
        "packs_configured": configured_packs,
        "packs_missing_variant": missing_packs,
        "ready_for_checkout": is_configured() and bool(configured_packs),
        "ready_for_webhook": webhook_secret() is not None,
    }


def _headers() -> Dict[str, str]:
    key = api_key()
    if not key:
        raise NotConfiguredError("LEMONSQUEEZY_API_KEY is not set")
    return {
        "Accept": "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
        "Authorization": f"Bearer {key}",
    }


# --------------------------------------------------------------------------
# Opening a checkout
# --------------------------------------------------------------------------

def create_checkout(
    pack: Dict[str, Any],
    user_id: str,
    email: Optional[str] = None,
    redirect_url: Optional[str] = None,
) -> str:
    """
    Ask Lemon Squeezy for a hosted checkout page for `pack`, and return its URL.

    `user_id` is stamped into the checkout's custom data. It comes back on the
    webhook and is the ONLY thing we use to decide whose balance to credit.

    Raises NotConfiguredError when the store or the pack's variant is unset, and
    LemonSqueezyError when the API says no.
    """
    if not is_configured():
        raise NotConfiguredError(
            "Lemon Squeezy is not configured; set LEMONSQUEEZY_API_KEY and "
            "LEMONSQUEEZY_STORE_ID"
        )
    variant = pack.get("variant_id")
    if not variant:
        raise NotConfiguredError(
            f"No Lemon Squeezy variant for pack {pack['slug']!r}; set "
            f"LEMONSQUEEZY_VARIANT_{pack['slug'].upper()}"
        )

    checkout_data: Dict[str, Any] = {
        # Stamped onto the order and echoed on the webhook. Strings only:
        # Lemon Squeezy returns custom data as strings whatever you send.
        "custom": {"user_id": str(user_id), "pack": pack["slug"]},
    }
    if email:
        checkout_data["email"] = email

    payload = {
        "data": {
            "type": "checkouts",
            "attributes": {
                "checkout_data": checkout_data,
                "product_options": {
                    "name": f"{pack['name']} - {pack['credits']} HeroMaker credits",
                    "description": pack["blurb"],
                    **({"redirect_url": redirect_url} if redirect_url else {}),
                },
                "test_mode": test_mode(),
            },
            "relationships": {
                "store": {"data": {"type": "stores", "id": str(store_id())}},
                "variant": {"data": {"type": "variants", "id": str(variant)}},
            },
        }
    }

    try:
        response = requests.post(
            f"{API_ROOT}/checkouts",
            json=payload,
            headers=_headers(),
            timeout=TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise LemonSqueezyError(f"Could not reach Lemon Squeezy: {exc}") from exc

    if response.status_code >= 400:
        # Their errors are JSON:API `errors[].detail`. Log the detail, never the
        # request - it carries the Authorization header.
        detail = response.text[:500]
        logger.error("Lemon Squeezy checkout failed (%s): %s", response.status_code, detail)
        raise LemonSqueezyError(
            f"Lemon Squeezy rejected the checkout ({response.status_code})"
        )

    try:
        url = response.json()["data"]["attributes"]["url"]
    except (ValueError, KeyError, TypeError) as exc:
        raise LemonSqueezyError("Lemon Squeezy returned a checkout with no URL") from exc

    if not url:
        raise LemonSqueezyError("Lemon Squeezy returned an empty checkout URL")
    return url


# --------------------------------------------------------------------------
# Trusting the webhook
# --------------------------------------------------------------------------

def verify_signature(raw_body: bytes, signature: Optional[str]) -> bool:
    """
    True when `raw_body` really came from our store.

    Lemon Squeezy signs the RAW request body with the webhook's signing secret
    and sends the hex digest in `X-Signature`. This must be computed over the
    exact bytes received - re-serialising the parsed JSON changes them and the
    signature will never match.

    Returns False rather than raising, including when the secret is unset: an
    endpoint with no secret configured must reject everything, not accept
    everything.
    """
    secret = webhook_secret()
    if not secret or not signature:
        return False
    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature.strip())


def parse_order_event(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Pull the few fields we care about out of a Lemon Squeezy webhook body.

    Returns a dict with:
        event         the event name, e.g. "order_created"
        order_id      Lemon Squeezy's order id - our idempotency key
        user_id       from custom_data, or None if the checkout was not ours
        pack_slug     from custom_data, or None
        status        "paid", "refunded", ...
        total_usd_micros  what the customer actually paid, in USD micros
        currency      the currency they paid in
        email         the buyer's email, for the receipt only - never for lookup

    Raises LemonSqueezyError if the body is not shaped like a webhook at all.
    """
    if not isinstance(payload, dict):
        raise LemonSqueezyError("Webhook body is not an object")

    meta = payload.get("meta") or {}
    data = payload.get("data") or {}
    attributes = data.get("attributes") or {}

    event = meta.get("event_name")
    if not event:
        raise LemonSqueezyError("Webhook body has no meta.event_name")

    order_id = data.get("id")
    if not order_id:
        raise LemonSqueezyError("Webhook body has no data.id")

    custom = meta.get("custom_data") or {}

    # `total` is in cents of `currency`; `total_usd` is Lemon Squeezy's own
    # conversion to US cents and is what we want for the margin report, since
    # every cost in `pricing` is in USD.
    total_us_cents = attributes.get("total_usd")
    if total_us_cents is None:
        total_us_cents = attributes.get("total") or 0

    return {
        "event": event,
        "order_id": str(order_id),
        "user_id": (str(custom["user_id"]) if custom.get("user_id") else None),
        "pack_slug": (str(custom["pack"]) if custom.get("pack") else None),
        "status": attributes.get("status"),
        "total_usd_micros": int(total_us_cents) * 10_000,
        "currency": attributes.get("currency"),
        "email": attributes.get("user_email"),
        "order_number": attributes.get("order_number"),
        "refunded": bool(attributes.get("refunded")),
        "test_mode": bool(attributes.get("test_mode", False)),
    }
