"""
Lemon Squeezy's own numbers beside ours, so a missed webhook shows.

Our income (company_finance) is built from `payments` rows, which only the
webhook writes. If a webhook never arrives, or arrives and fails, the sale is
real at Lemon Squeezy and invisible here. This module asks Lemon Squeezy
directly and lines its orders up against our rows.

Read by the admin console (GET /api/v1/admin/money/lemonsqueezy).

    store    GET /v1/stores/{id}: total_sales, thirty_day_sales (counts) and
             total_revenue, thirty_day_revenue (USD cents, per the API docs).
             These count LIVE sales only: staging's test store answered 0
             for all four while listing 56 paid test orders (2026-10-20). So
             the comparison is built from the orders, never from these.
    orders   GET /v1/orders?filter[store_id]={id}, newest first, 100 a page,
             stopping a day past WINDOW_DAYS or at MAX_ORDERS. Every order that took money
             (paid, refunded, partial_refund) must have a payments row whose
             provider_ref is "lemonsqueezy:order:<order id>" - the key the
             webhook writes (app/api/payments.py::_record_payment).

Test or live: the API key decides which data comes back, so the mode is read
off the orders themselves (each carries `test_mode`) and falls back to
LEMONSQUEEZY_TEST_MODE when there are none. Only our rows of that same mode are
counted, so test sales never "match" live ones.

Only the Lemon Squeezy answer is cached (CACHE_SECONDS, errors for a minute,
like provider_balances); the comparison with our rows is redone on every read,
so a late webhook clears its warning on the next reload.

SECRETS: the key goes into the Authorization header and nowhere else. Error
hints are built from the status code or the exception's class name, never from
a response body.
"""
import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import requests
from sqlalchemy.orm import Session

from app.models import Payment
from app.services import lemonsqueezy

logger = logging.getLogger(__name__)

CACHE_SECONDS = 300
ERROR_CACHE_SECONDS = 60
TIMEOUT_SECONDS = 5.0
WINDOW_DAYS = 30
MAX_ORDERS = 200
PAGE_SIZE = 100

# Orders that took money. pending, failed and fraudulent never reach a webhook
# we act on, so their absence from our records is correct.
MONEY_STATUSES = ("paid", "refunded", "partial_refund")

# Ours: what _record_payment writes, and what an admin may mark it as later.
OUR_STATUSES = ("succeeded", "refunded")

REF_PREFIX = "lemonsqueezy:order:"

_cache: Optional[Dict[str, Any]] = None
_cache_until = 0.0
_lock = threading.Lock()


class CheckError(RuntimeError):
    """A reason the check could not run, safe to show an admin."""


def clear_cache() -> None:
    global _cache, _cache_until
    with _lock:
        _cache = None
        _cache_until = 0.0


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_time(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _cents_to_micros(value: Any) -> int:
    try:
        return int(value or 0) * 10_000
    except (TypeError, ValueError):
        return 0


def _get(url: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    try:
        r = requests.get(url, headers=lemonsqueezy._headers(), params=params, timeout=TIMEOUT_SECONDS)
    except requests.Timeout as exc:
        raise CheckError("Lemon Squeezy did not answer in time.") from exc
    except requests.RequestException as exc:
        raise CheckError(f"Could not reach Lemon Squeezy ({type(exc).__name__}).") from exc
    if r.status_code in (401, 403):
        raise CheckError(f"The API key was refused ({r.status_code}).")
    if r.status_code == 404:
        raise CheckError("Lemon Squeezy does not know this store id (404).")
    if r.status_code >= 400:
        raise CheckError(f"Lemon Squeezy answered {r.status_code}.")
    try:
        body = r.json()
    except ValueError as exc:
        raise CheckError("Lemon Squeezy sent something that is not JSON.") from exc
    if not isinstance(body, dict):
        raise CheckError("Lemon Squeezy sent an unexpected answer.")
    return body


def fetch_remote(now: Optional[datetime] = None) -> Dict[str, Any]:
    """Ask Lemon Squeezy for the store's totals and its recent orders. Raises CheckError."""
    now = now or _now()
    since = now - timedelta(days=WINDOW_DAYS)
    # A day further back than the window, so a payment row written seconds
    # after its order, on the window's edge, still finds that order.
    reach = since - timedelta(days=1)
    store_id = lemonsqueezy.store_id()

    store_body = _get(f"{lemonsqueezy.API_ROOT}/stores/{store_id}")
    attrs = ((store_body.get("data") or {}).get("attributes")) or {}
    store = {
        "name": attrs.get("name"),
        "currency": attrs.get("currency"),
        "total_sales": int(attrs.get("total_sales") or 0),
        "total_revenue_usd_micros": _cents_to_micros(attrs.get("total_revenue")),
        "thirty_day_sales": int(attrs.get("thirty_day_sales") or 0),
        "thirty_day_revenue_usd_micros": _cents_to_micros(attrs.get("thirty_day_revenue")),
    }

    orders: List[Dict[str, Any]] = []
    truncated = False
    page = 1
    done = False
    while not done:
        body = _get(
            f"{lemonsqueezy.API_ROOT}/orders",
            params={
                "filter[store_id]": store_id,
                "page[size]": PAGE_SIZE,
                "page[number]": page,
            },  # newest first is the API's default order
        )
        rows = body.get("data") or []
        for row in rows:
            a = row.get("attributes") or {}
            created = _parse_time(a.get("created_at"))
            if created is not None and created < reach:
                done = True
                break
            if len(orders) >= MAX_ORDERS:
                truncated = True
                done = True
                break
            total_usd = a.get("total_usd")
            orders.append({
                "order_id": str(row.get("id")),
                "order_number": a.get("order_number"),
                "status": a.get("status"),
                "total_usd_micros": _cents_to_micros(total_usd if total_usd is not None else a.get("total")),
                "created_at": created.isoformat() if created else None,
                "test_mode": bool(a.get("test_mode", False)),
            })
        if done or not rows or not (body.get("links") or {}).get("next"):
            break
        page += 1

    return {
        "store": store,
        "orders": orders,
        "truncated": truncated,
        "since": since.isoformat(),
        "checked_at": now.isoformat(),
    }


def _remote(refresh: bool) -> Dict[str, Any]:
    """fetch_remote through the cache. Returns {"ok": True, ...} or {"ok": False, "hint": ...}."""
    global _cache, _cache_until
    with _lock:
        if not refresh and _cache is not None and time.monotonic() < _cache_until:
            return {**_cache, "cached": True}
    try:
        res: Dict[str, Any] = {"ok": True, **fetch_remote()}
        ttl = CACHE_SECONDS
    except CheckError as exc:
        logger.warning("Lemon Squeezy check failed: %s", exc)
        res = {"ok": False, "hint": str(exc), "checked_at": _now().isoformat()}
        ttl = ERROR_CACHE_SECONDS
    except Exception as exc:  # a parsing bug must not take the Money page down
        logger.exception("Lemon Squeezy check crashed")
        res = {"ok": False, "hint": f"Could not read Lemon Squeezy ({type(exc).__name__}).",
               "checked_at": _now().isoformat()}
        ttl = ERROR_CACHE_SECONDS
    with _lock:
        _cache, _cache_until = res, time.monotonic() + ttl
    return {**res, "cached": False}


def _order_id(p: Payment) -> str:
    ref = p.provider_ref or ""
    return ref[len(REF_PREFIX):] if ref.startswith(REF_PREFIX) else ref


def _is_test(p: Payment) -> bool:
    return bool((p.metadata_json or {}).get("test_mode", False))


def reconcile(db: Session, remote: Dict[str, Any]) -> Dict[str, Any]:
    """Line Lemon Squeezy's orders up against our payments rows."""
    orders = remote["orders"]
    since = _parse_time(remote["since"])
    configured_test = lemonsqueezy.test_mode()
    modes = {o["test_mode"] for o in orders}
    test = modes.pop() if len(modes) == 1 else configured_test
    hint = None
    if orders and test != configured_test:
        hint = (f"The API key reads {'test' if test else 'live'} orders but "
                f"LEMONSQUEEZY_TEST_MODE says {'test' if configured_test else 'live'}.")

    def in_window(o: Dict[str, Any]) -> bool:
        created = _parse_time(o["created_at"])
        return since is None or created is None or created >= since

    taking = [o for o in orders if o["status"] in MONEY_STATUSES and o["test_mode"] == test and in_window(o)]

    refs = [REF_PREFIX + o["order_id"] for o in taking]
    recorded = set()
    if refs:
        recorded = {
            ref for (ref,) in db.query(Payment.provider_ref).filter(Payment.provider_ref.in_(refs)).all()
        }
    missing = [
        {k: o[k] for k in ("order_id", "order_number", "status", "total_usd_micros", "created_at")}
        for o in taking if REF_PREFIX + o["order_id"] not in recorded
    ]

    # Ours over the same window and mode, naive UTC like the column.
    since_naive = since.astimezone(timezone.utc).replace(tzinfo=None) if since else None
    q = db.query(Payment).filter(Payment.provider == "lemonsqueezy", Payment.status.in_(OUR_STATUSES))
    if since_naive is not None:
        q = q.filter(Payment.created_at >= since_naive)
    ours = [p for p in q.all() if _is_test(p) == test]

    # Ours that Lemon Squeezy does not list. Only knowable when its list was
    # read to the end of the window.
    unknown: List[Dict[str, Any]] = []
    if not remote["truncated"]:
        listed = {o["order_id"] for o in orders}
        unknown = [
            {
                "order_id": _order_id(p),
                "order_number": (p.metadata_json or {}).get("order_number"),
                "gross_usd_micros": int(p.gross_usd_micros or 0),
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in ours if _order_id(p) not in listed
        ]

    return {
        "status": "ok",
        "hint": hint,
        "checked_at": remote["checked_at"],
        "cached": remote.get("cached", False),
        "mode": "test" if test else "live",
        "window_days": WINDOW_DAYS,
        "since": remote["since"],
        "store": remote["store"],
        "orders": {
            "count": len(taking),
            "gross_usd_micros": sum(o["total_usd_micros"] for o in taking),
            "truncated": remote["truncated"],
            "max_orders": MAX_ORDERS,
        },
        "ours": {
            "count": len(ours),
            "gross_usd_micros": sum(int(p.gross_usd_micros or 0) for p in ours),
        },
        "missing": missing,
        "unknown_payments": unknown,
        "matches": not missing and not unknown,
    }


def get_check(db: Session, refresh: bool = False) -> Dict[str, Any]:
    """The whole check, for the admin console. Never raises."""
    mode = "test" if lemonsqueezy.test_mode() else "live"
    if not lemonsqueezy.is_configured():
        return {
            "status": "not_configured",
            "mode": mode,
            "hint": "Set LEMONSQUEEZY_API_KEY and LEMONSQUEEZY_STORE_ID to check against Lemon Squeezy.",
            "checked_at": _now().isoformat(),
            "cached": False,
        }
    remote = _remote(refresh)
    if not remote["ok"]:
        return {
            "status": "error",
            "mode": mode,
            "hint": remote["hint"],
            "checked_at": remote["checked_at"],
            "cached": remote.get("cached", False),
        }
    try:
        return reconcile(db, remote)
    except Exception as exc:
        logger.exception("Lemon Squeezy reconciliation crashed")
        return {
            "status": "error",
            "mode": mode,
            "hint": f"Could not compare with our records ({type(exc).__name__}).",
            "checked_at": remote["checked_at"],
            "cached": remote.get("cached", False),
        }
