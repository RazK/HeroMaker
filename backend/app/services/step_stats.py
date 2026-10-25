"""How long each pipeline step really takes, measured from recent heroes.

The step config's ``estimated_duration`` was a guess written once (meshy_3d:
309s). Measured on staging, Sept-Oct 2026: 3D modelling's median was 166s, the
painting 53s. So the estimates people and API clients see come from the last
heroes that actually finished each step:

- ``p50`` (the median) is what we quote as "about this long";
- ``p90`` is the "almost always under" figure, for timeouts and for clients
  that want a safe upper bound.

A step answered from the result cache (``metadata.result_cache.hit``) took no
real time and is left out: counting it would tell the next person their 3D
model takes a second. Until a step has ``MIN_SAMPLES`` real runs, the config
guess stands in for it.

The figures are recomputed at most every ``TTL_SECONDS``: one small query per
step, shared by every request in between.
"""
from __future__ import annotations

import logging
import statistics
import threading
import time
from datetime import datetime, timedelta
from typing import Dict, Optional

from app.config.steps import STEPS, get_step_by_name

logger = logging.getLogger(__name__)

WINDOW = 50  # the most recent finished runs of each step
MAX_AGE_DAYS = 60  # older runs say little about today's providers
MIN_SAMPLES = 5
TTL_SECONDS = 600

_lock = threading.Lock()
_cache: Dict[str, dict] = {}
_cached_at = 0.0


def _configured(name: str) -> dict:
    guess = int((get_step_by_name(name) or {}).get("estimated_duration") or 0)
    return {"p50": guess, "p90": guess * 2, "samples": 0, "source": "configured"}


def _percentile(sorted_values, q: float) -> float:
    if len(sorted_values) == 1:
        return sorted_values[0]
    pos = (len(sorted_values) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(sorted_values) - 1)
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (pos - lo)


def compute(db, now: Optional[datetime] = None) -> Dict[str, dict]:
    """The measured figures for every step, straight from the database."""
    from app.models import CreationStep

    now = now or datetime.utcnow()
    since = now - timedelta(days=MAX_AGE_DAYS)
    out: Dict[str, dict] = {}
    for step in STEPS:
        name = step["name"]
        rows = (
            db.query(CreationStep.started_at, CreationStep.completed_at, CreationStep.metadata_json)
            .filter(
                CreationStep.step_name == name,
                CreationStep.status == "completed",
                CreationStep.started_at.isnot(None),
                CreationStep.completed_at.isnot(None),
                CreationStep.completed_at >= since,
            )
            .order_by(CreationStep.completed_at.desc())
            .limit(WINDOW * 2)  # room for the cache hits dropped below
            .all()
        )
        durations = []
        for started, completed, meta in rows:
            if ((meta or {}).get("result_cache") or {}).get("hit"):
                continue
            seconds = (completed - started).total_seconds()
            if seconds >= 0:
                durations.append(seconds)
            if len(durations) == WINDOW:
                break
        if len(durations) < MIN_SAMPLES:
            out[name] = _configured(name)
            continue
        durations.sort()
        out[name] = {
            "p50": max(1, round(statistics.median(durations))),
            "p90": max(1, round(_percentile(durations, 0.9))),
            "samples": len(durations),
            "source": "measured",
        }
    return out


def estimates(db=None) -> Dict[str, dict]:
    """Per step: {"p50", "p90", "samples", "source"}. Cached for TTL_SECONDS.

    Never raises: if the database can't be read, the last figures (or the
    config guesses) are returned.
    """
    global _cached_at
    with _lock:
        if _cache and time.monotonic() - _cached_at < TTL_SECONDS:
            return dict(_cache)
    try:
        if db is not None:
            fresh = compute(db)
        else:
            from app.database import SessionLocal

            own = SessionLocal()
            try:
                fresh = compute(own)
            finally:
                own.close()
    except Exception as e:  # a stale estimate beats a failed request
        logger.warning(f"step estimates: falling back ({e})")
        with _lock:
            return dict(_cache) if _cache else {s["name"]: _configured(s["name"]) for s in STEPS}
    with _lock:
        _cache.clear()
        _cache.update(fresh)
        _cached_at = time.monotonic()
        return dict(_cache)


def typical_seconds(step_name: str, db=None) -> Optional[int]:
    """The step's median length in seconds: what "about N seconds" quotes."""
    figure = estimates(db).get(step_name)
    return figure["p50"] if figure and figure["p50"] else None


def total(db=None) -> dict:
    """The whole pipeline end to end: medians and p90s added up.

    Adding p90s overstates the p90 of the sum a little (steps are not all slow
    at once), which is the safe direction for a promise.
    """
    figures = estimates(db)
    return {
        "p50": sum(f["p50"] for f in figures.values()),
        "p90": sum(f["p90"] for f in figures.values()),
    }


def reset_cache() -> None:
    """For tests."""
    global _cached_at
    with _lock:
        _cache.clear()
        _cached_at = 0.0
