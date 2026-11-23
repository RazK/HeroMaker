"""
Which payment provider sells, and the one surface the app calls it through.

    PAYMENTS_PROVIDER=lemonsqueezy   (default) app/services/lemonsqueezy.py, unchanged
    PAYMENTS_PROVIDER=grow_sandbox   app/services/grow_sandbox.py: our own test mode,
                                     shekel prices, never armed in production
    PAYMENTS_PROVIDER=grow           Grow itself. Not built yet: sells nothing.

app/api/payments.py and app/api/classes.py call this module, never a provider
directly. Exactly one provider sells at a time: the storefront lists its
products, checkouts open through it, and only ITS callback is believed. The
Lemon Squeezy webhook rejects everything while another provider is selected,
and the Grow callback answers 404 unless grow_sandbox is selected and armed.

Errors come out as this module's own two, whichever provider raised them:
NotConfiguredError (ours to fix: 503) and PaymentsError (the provider said
no: 502).
"""
import logging
import os
from typing import Any, Dict, List, Mapping, Optional, Tuple

from sqlalchemy.orm import Session

from app.config import packs as packs_config
from app.services import grow_sandbox, lemonsqueezy

logger = logging.getLogger(__name__)

LEMONSQUEEZY = "lemonsqueezy"
GROW_SANDBOX = grow_sandbox.NAME
GROW = "grow"
PROVIDERS = (LEMONSQUEEZY, GROW_SANDBOX, GROW)

# Lemon Squeezy's webhook events, for its handler in payments.py.
EVENT_ORDER_CREATED = lemonsqueezy.EVENT_ORDER_CREATED
EVENT_ORDER_REFUNDED = lemonsqueezy.EVENT_ORDER_REFUNDED
HANDLED_EVENTS = lemonsqueezy.HANDLED_EVENTS


class PaymentsError(RuntimeError):
    """The provider refused, or answered with something unusable."""


class NotConfiguredError(PaymentsError):
    """The selected provider cannot sell here (credentials missing, or not built)."""


class SeatsError(PaymentsError):
    """A class seat order the provider does not sell (e.g. under its minimum)."""


def name() -> str:
    """The selected provider. Unknown values sell nothing, and say so."""
    value = os.getenv("PAYMENTS_PROVIDER", "").strip().lower() or LEMONSQUEEZY
    if value not in PROVIDERS:
        logger.error("PAYMENTS_PROVIDER=%r is not one of %s; nothing is sold", value, PROVIDERS)
    return value


# --------------------------------------------------------------------------
# What is on sale
# --------------------------------------------------------------------------

def can_sell() -> bool:
    provider = name()
    if provider == LEMONSQUEEZY:
        return lemonsqueezy.can_sell()
    if provider == GROW_SANDBOX:
        return grow_sandbox.can_sell()
    return False


def test_mode() -> bool:
    provider = name()
    if provider == LEMONSQUEEZY:
        return lemonsqueezy.test_mode()
    # The sandbox never takes money; Grow is not built, so it takes none either.
    return True


def list_packs() -> List[Dict[str, Any]]:
    """
    The packs a customer can buy right now, each with slug, name, blurb,
    credits, heroes, price_cents, price_display, highlight and currency.

    Nothing unless the provider can both open a checkout and hear that it was
    paid (can_sell). Lemon Squeezy also omits packs with no variant.
    """
    provider = name()
    if provider == LEMONSQUEEZY:
        if not lemonsqueezy.can_sell():
            return []
        return [{**p, "currency": "USD"} for p in packs_config.get_packs(include_unconfigured=False)]
    if provider == GROW_SANDBOX:
        return grow_sandbox.list_packs()
    return []


def get_pack(slug: str) -> Optional[Dict[str, Any]]:
    """The pack `slug` names in the selected provider's price list, or None.
    Found even when it cannot be sold here: the checkout then answers 503."""
    provider = name()
    if provider == LEMONSQUEEZY:
        return packs_config.get_pack(slug)
    if provider in (GROW_SANDBOX, GROW):
        return packs_config.get_ils_product(slug)
    return None


def seat_price() -> Optional[Dict[str, Any]]:
    """The class price for "Pay X for N seats", or None to hide the option.
    Lemon Squeezy's shape is unchanged; others add currency and min_seats."""
    provider = name()
    if provider == LEMONSQUEEZY:
        if not (lemonsqueezy.can_sell() and packs_config.class_seats_variant_id()):
            return None
        return {
            "order_cents": packs_config.price_cents(packs_config.CLASS_ORDER_USD_MICROS),
            "seat_cents": packs_config.price_cents(packs_config.CLASS_SEAT_USD_MICROS),
            "max_seats": packs_config.CLASS_MAX_SEATS,
        }
    if provider == GROW_SANDBOX:
        return grow_sandbox.seat_price()
    return None


# --------------------------------------------------------------------------
# Opening a checkout
# --------------------------------------------------------------------------

def create_checkout(
    pack: Dict[str, Any],
    user_id: str,
    email: Optional[str] = None,
    redirect_url: Optional[str] = None,
    db: Optional[Session] = None,
) -> str:
    """A checkout URL for `pack`. Nothing is charged and no credits move."""
    provider = name()
    try:
        if provider == LEMONSQUEEZY:
            return lemonsqueezy.create_checkout(pack=pack, user_id=user_id, email=email,
                                                redirect_url=redirect_url)
        if provider == GROW_SANDBOX:
            return grow_sandbox.create_checkout(db, pack=pack, user_id=user_id, email=email,
                                                redirect_url=redirect_url)
    except (lemonsqueezy.NotConfiguredError, grow_sandbox.NotArmedError) as exc:
        raise NotConfiguredError(str(exc)) from exc
    except (lemonsqueezy.LemonSqueezyError, grow_sandbox.SandboxError) as exc:
        raise PaymentsError(str(exc)) from exc
    raise NotConfiguredError(f"Payments provider {provider!r} cannot open a checkout")


def create_class_seats_checkout(
    class_id: str,
    class_title: str,
    seats: int,
    user_id: str,
    email: Optional[str] = None,
    redirect_url: Optional[str] = None,
    db: Optional[Session] = None,
) -> Tuple[str, Dict[str, Any]]:
    """A checkout for `seats` seats of one class. Returns (url, quote)."""
    provider = name()
    kwargs = dict(class_id=class_id, class_title=class_title, seats=seats, user_id=user_id,
                  email=email, redirect_url=redirect_url)
    try:
        if provider == LEMONSQUEEZY:
            return lemonsqueezy.create_class_seats_checkout(**kwargs)
        if provider == GROW_SANDBOX:
            return grow_sandbox.create_class_seats_checkout(db, **kwargs)
    except (lemonsqueezy.NotConfiguredError, grow_sandbox.NotArmedError) as exc:
        raise NotConfiguredError(str(exc)) from exc
    except grow_sandbox.SeatsError as exc:
        raise SeatsError(str(exc)) from exc
    except (lemonsqueezy.LemonSqueezyError, grow_sandbox.SandboxError) as exc:
        raise PaymentsError(str(exc)) from exc
    raise NotConfiguredError(f"Payments provider {provider!r} cannot open a checkout")


# --------------------------------------------------------------------------
# Lemon Squeezy's webhook (POST /api/payments/webhook)
# --------------------------------------------------------------------------

def verify_signature(raw_body: bytes, signature: Optional[str]) -> bool:
    """Lemon Squeezy's signature check, and False while another provider sells."""
    if name() != LEMONSQUEEZY:
        return False
    return lemonsqueezy.verify_signature(raw_body, signature)


def parse_order_event(payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        return lemonsqueezy.parse_order_event(payload)
    except lemonsqueezy.LemonSqueezyError as exc:
        raise PaymentsError(str(exc)) from exc


# --------------------------------------------------------------------------
# Grow's callback (POST /api/payments/grow/callback)
# --------------------------------------------------------------------------

def callbacks_open() -> bool:
    """Is there a Grow-shaped provider here to hear a callback? Only the armed
    sandbox, for now; Grow itself once it is built."""
    return name() == GROW_SANDBOX and grow_sandbox.armed()


def verify_callback(raw_body: bytes, headers: Mapping[str, str]) -> bool:
    if not callbacks_open():
        return False
    return grow_sandbox.verify_callback(raw_body, headers)


def parse_callback(raw_body: bytes) -> Dict[str, Any]:
    try:
        return grow_sandbox.parse_callback(raw_body)
    except grow_sandbox.SandboxError as exc:
        raise PaymentsError(str(exc)) from exc
