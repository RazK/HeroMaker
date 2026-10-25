"""
Live balances and spend at the providers we pay: Meshy, OpenAI, Railway.

Read by the admin console (GET /api/v1/admin/money/providers). Each provider is
asked in parallel with its own short timeout, and each answer is cached for
CACHE_SECONDS, so a slow or broken provider costs the page one empty card and
never a spinner that does not end.

Every result has the same outer shape:

    {"provider": "meshy", "status": "ok" | "not_configured" | "error",
     "checked_at": iso, "hint": str | None, ...provider fields}

A provider whose balance we can read also says whether it can pay for one
more step of its kind: "out_of_credit" (bool) and, when true,
"out_of_credit_effect" ("every 3D step fails"). The console turns that into
its red notice; nothing there knows which provider is which.

SECRETS: keys are read from the environment at call time and only ever placed
in an Authorization header. Error text is built from the HTTP status or the
exception's class name, never from the request or the provider's response
body, so no key can come back out through the API or a log line.

    Meshy    GET https://api.meshy.ai/openapi/v1/balance with MESHY_API_KEY
             (the key the pipeline already uses). Credits, plus their USD
             value at pricing.MESHY_USD_MICROS_PER_CREDIT.
    OpenAI   There is no prepaid-balance API for a normal key. Spend comes from
             GET /v1/organization/costs, which only accepts an ADMIN key
             (sk-admin-...): OPENAI_ADMIN_KEY, optional.
    Railway  The public GraphQL API (backboard.railway.com/graphql/v2) with an
             account or workspace token: RAILWAY_API_TOKEN, optional. A project
             token cannot read billing. The project is RAILWAY_PROJECT_ID, which
             Railway injects into every service it runs.
"""
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

import requests

from app.config import pricing

logger = logging.getLogger(__name__)

CACHE_SECONDS = 300
TIMEOUT_SECONDS = 6.0

MESHY_BALANCE_URL = "https://api.meshy.ai/openapi/v1/balance"
OPENAI_COSTS_URL = "https://api.openai.com/v1/organization/costs"
RAILWAY_GRAPHQL_URL = "https://backboard.railway.com/graphql/v2"

_cache: Dict[str, Dict[str, Any]] = {}
_cache_at: Dict[str, float] = {}
_lock = threading.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _result(provider: str, status: str, hint: Optional[str] = None, **fields: Any) -> Dict[str, Any]:
    return {"provider": provider, "status": status, "hint": hint, "checked_at": _now_iso(), **fields}


def _http_error(provider: str, exc: Exception) -> Dict[str, Any]:
    """An error result that cannot carry a secret: status code or class name only."""
    if isinstance(exc, requests.HTTPError) and exc.response is not None:
        code = exc.response.status_code
        if code in (401, 403):
            reason = f"The key was refused ({code})."
        else:
            reason = f"{provider.capitalize()} answered {code}."
    elif isinstance(exc, requests.Timeout):
        reason = f"{provider.capitalize()} did not answer in time."
    else:
        reason = f"Could not reach {provider.capitalize()} ({type(exc).__name__})."
    logger.warning("Provider balance %s failed: %s", provider, reason)
    return _result(provider, "error", hint=reason)


# ---------------------------------------------------------------------------
# Meshy
# ---------------------------------------------------------------------------

def fetch_meshy() -> Dict[str, Any]:
    key = os.getenv("MESHY_API_KEY")
    if not key:
        return _result("meshy", "not_configured", hint="Set MESHY_API_KEY to see Meshy credits.")
    try:
        r = requests.get(MESHY_BALANCE_URL, headers={"Authorization": f"Bearer {key}"}, timeout=TIMEOUT_SECONDS)
        r.raise_for_status()
        data = r.json()
    except Exception as exc:
        return _http_error("meshy", exc)
    balance = int(data.get("balance") or 0)
    resets_ms = data.get("monthly_resets_at")
    # The dearest step Meshy runs for us is image-to-3D. Below its price the
    # account cannot run one more, so every hero fails at 3D until a top-up.
    step_credits = pricing.MESHY_IMAGE_TO_3D_CREDITS
    return _result(
        "meshy", "ok",
        credits=balance,
        step_credits=step_credits,
        out_of_credit=balance < step_credits,
        out_of_credit_effect="every 3D step fails" if balance < step_credits else None,
        monthly_credits=data.get("monthly_credits"),
        permanent_credits=data.get("permanent_credits"),
        monthly_resets_at=(
            datetime.fromtimestamp(int(resets_ms) / 1000, tz=timezone.utc).isoformat() if resets_ms else None
        ),
        value_usd_micros=balance * pricing.MESHY_USD_MICROS_PER_CREDIT,
        usd_micros_per_credit=pricing.MESHY_USD_MICROS_PER_CREDIT,
    )


# ---------------------------------------------------------------------------
# OpenAI
# ---------------------------------------------------------------------------

def fetch_openai(now: Optional[datetime] = None) -> Dict[str, Any]:
    key = os.getenv("OPENAI_ADMIN_KEY")
    if not key:
        return _result(
            "openai", "not_configured",
            hint="Connect an OpenAI admin key (OPENAI_ADMIN_KEY) to see spend.",
        )
    now = now or datetime.now(timezone.utc)
    month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    params: Dict[str, Any] = {
        "start_time": int(month_start.timestamp()),
        "bucket_width": "1d",
        "limit": 31,
    }
    total = 0.0
    currency = "usd"
    try:
        for _ in range(5):  # a month is at most 31 daily buckets: one page, two at most
            r = requests.get(
                OPENAI_COSTS_URL, headers={"Authorization": f"Bearer {key}"},
                params=params, timeout=TIMEOUT_SECONDS,
            )
            r.raise_for_status()
            page = r.json()
            for bucket in page.get("data") or []:
                for res in bucket.get("results") or []:
                    amount = res.get("amount") or {}
                    total += float(amount.get("value") or 0)
                    currency = amount.get("currency") or currency
            if not page.get("has_more") or not page.get("next_page"):
                break
            params["page"] = page["next_page"]
    except Exception as exc:
        return _http_error("openai", exc)
    return _result(
        "openai", "ok",
        month_to_date_usd_micros=int(round(total * pricing.USD_MICROS)),
        currency=currency,
        since=month_start.isoformat(),
    )


# ---------------------------------------------------------------------------
# Railway
# ---------------------------------------------------------------------------

_CUSTOMER_FIELDS = "currentUsage creditBalance remainingUsageCreditBalance billingPeriod { start end }"
_RAILWAY_PROJECT_QUERY = (
    "query($id: String!) { project(id: $id) { name workspace { name customer { %s } } } }" % _CUSTOMER_FIELDS
)


def _projected(current: float, start: Optional[str], end: Optional[str]) -> Optional[float]:
    """Straight-line projection of this cycle's usage to its end. None if unknowable."""
    try:
        s = datetime.fromisoformat(start.replace("Z", "+00:00"))
        e = datetime.fromisoformat(end.replace("Z", "+00:00"))
    except Exception:
        return None
    now = datetime.now(timezone.utc)
    elapsed = (now - s).total_seconds()
    length = (e - s).total_seconds()
    if elapsed <= 3600 or length <= 0:
        return None
    return current * min(length / elapsed, 1e6)


def _usd(value: Any) -> Optional[int]:
    """Railway reports dollars as floats; we carry integer micros."""
    if value is None:
        return None
    return int(round(float(value) * pricing.USD_MICROS))


def fetch_railway() -> Dict[str, Any]:
    token = os.getenv("RAILWAY_API_TOKEN")
    if not token:
        return _result(
            "railway", "not_configured",
            hint="Connect a Railway account token (RAILWAY_API_TOKEN) to see the bill.",
        )
    project_id = os.getenv("RAILWAY_PROJECT_ID")
    if not project_id:
        return _result("railway", "error", hint="RAILWAY_PROJECT_ID is not set, so the project is unknown.")
    try:
        r = requests.post(
            RAILWAY_GRAPHQL_URL,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"query": _RAILWAY_PROJECT_QUERY, "variables": {"id": project_id}},
            timeout=TIMEOUT_SECONDS,
        )
        r.raise_for_status()
        body = r.json()
    except Exception as exc:
        return _http_error("railway", exc)
    if body.get("errors"):
        # GraphQL errors arrive as 200. Their messages are Railway's own words
        # ("Not Authorized"), not our token, but keep only a short, fixed hint.
        return _result("railway", "error", hint="Railway refused the query. Is the token an account token?")
    workspace = ((body.get("data") or {}).get("project") or {}).get("workspace") or {}
    customer = workspace.get("customer") or {}
    period = customer.get("billingPeriod") or {}
    current = customer.get("currentUsage")
    projected = (
        _projected(float(current), period.get("start"), period.get("end")) if current is not None else None
    )
    return _result(
        "railway", "ok",
        workspace=workspace.get("name"),
        current_usage_usd_micros=_usd(current),
        projected_usage_usd_micros=_usd(projected),
        credit_balance_usd_micros=_usd(customer.get("creditBalance")),
        period_start=period.get("start"),
        period_end=period.get("end"),
    )


# ---------------------------------------------------------------------------
# All of them
# ---------------------------------------------------------------------------

FETCHERS: Dict[str, Callable[[], Dict[str, Any]]] = {
    "meshy": fetch_meshy,
    "openai": fetch_openai,
    "railway": fetch_railway,
}


def clear_cache() -> None:
    with _lock:
        _cache.clear()
        _cache_at.clear()


def get_all(refresh: bool = False) -> List[Dict[str, Any]]:
    """Every provider's latest answer, from cache when fresh. Never raises."""
    now = time.monotonic()
    out: Dict[str, Dict[str, Any]] = {}
    stale: List[str] = []
    with _lock:
        for name in FETCHERS:
            if not refresh and name in _cache and now - _cache_at[name] < CACHE_SECONDS:
                out[name] = {**_cache[name], "cached": True}
            else:
                stale.append(name)

    if stale:
        pool = ThreadPoolExecutor(max_workers=len(stale))
        futures = {name: pool.submit(FETCHERS[name]) for name in stale}
        # The fetchers time out on their own; this is the belt to their braces.
        wait(list(futures.values()), timeout=TIMEOUT_SECONDS * 2 + 1)
        pool.shutdown(wait=False)
        for name, fut in futures.items():
            if not fut.done():
                res = _result(name, "error", hint=f"{name.capitalize()} did not answer in time.")
            else:
                try:
                    res = fut.result()
                except Exception as exc:  # a fetcher bug must not take the page down
                    logger.exception("Provider balance %s crashed", name)
                    res = _result(name, "error", hint=f"Could not read {name} ({type(exc).__name__}).")
            out[name] = {**res, "cached": False}
            # Errors are cached too, briefly, so a dead provider is not hammered
            # by every reload; "not_configured" changes only on a redeploy.
            with _lock:
                _cache[name] = res
                _cache_at[name] = time.monotonic() - (CACHE_SECONDS - 60 if res["status"] == "error" else 0)

    return [out[name] for name in FETCHERS]
