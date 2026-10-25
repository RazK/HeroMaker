"""Heroes as the public API (app/api/v1.py) sees them, and its webhooks.

A hero goes through stages, each with a file you can download as soon as it
is done:

    drawing   original.jpg    the upload, as received
    cleanup   processed.jpg   straightened and cleaned up
    painting  rendered.png    painted as a character (cut_rendered.png: cut out)
    model     model.glb       sculpted in 3D (no skeleton)
    rig       rigged.glb      rigged, plus walking.glb when the rigger made one
    avatar    avatar.vrm      the finished VRM humanoid (opt_avatar.vrm: ~5x smaller)

Progress and time left are measured, not promised: each stage's typical
length is the median of its recent real runs (app/services/step_stats.py).
"""
from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import socket
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from urllib.parse import urlsplit

from app.config.steps import STEPS, get_all_step_names, calculate_steps_cost
from app.services import step_errors, step_stats

logger = logging.getLogger(__name__)

# (stage, pipeline step, its main file)
STAGES = [
    ("drawing", None, "original.jpg"),
    ("cleanup", "image_processing", "processed.jpg"),
    ("painting", "openai_render", "rendered.png"),
    ("model", "meshy_3d", "model.glb"),
    ("rig", "meshy_rig", "rigged.glb"),
    ("avatar", "convert_vrm", "avatar.vrm"),
]
TERMINAL = ("completed", "failed", "cancelled")
STATUS = {"pending": "queued", "processing": "processing", "completed": "completed", "failed": "failed"}


def hero_cost() -> int:
    return calculate_steps_cost(get_all_step_names())


def base_url(request) -> str:
    """This API's public origin, as the caller reached it (behind Railway's proxy)."""
    proto = request.headers.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip()
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}"


def file_url(base: str, creation, name: str) -> str:
    return f"{base}/api/files/{creation.user_id}/{creation.id}/{name}"


def _seconds(a: Optional[datetime], b: Optional[datetime]) -> Optional[float]:
    if a and b:
        return max(0.0, (b - a).total_seconds())
    return None


def view(creation, base: str, *, api_hero=None, now: Optional[datetime] = None) -> dict:
    """The hero as the API answers it: status, stages, progress, time left, files."""
    now = now or datetime.utcnow()
    figures = step_stats.estimates()
    steps = {s.step_name: s for s in (creation.steps or [])}
    status = STATUS.get(creation.status, creation.status)
    if creation.deleted_at is not None:
        status = "cancelled"

    stages: List[dict] = []
    done_weight = 0.0
    total_weight = 0.0
    left_p50 = 0.0
    left_p90 = 0.0
    current = None
    error = None
    for key, step_name, filename in STAGES:
        if step_name is None:
            stages.append({
                "stage": key, "status": "completed", "started_at": creation.created_at,
                "completed_at": creation.created_at, "typical_seconds": 0, "progress": 100,
                "file": file_url(base, creation, filename),
            })
            continue
        fig = figures.get(step_name) or {"p50": 0, "p90": 0}
        p50, p90 = float(fig["p50"] or 0), float(fig["p90"] or 0)
        total_weight += p50
        step = steps.get(step_name)
        st = step.status if step else "pending"
        entry = {
            "stage": key,
            "status": st if st in ("pending", "processing", "completed", "failed") else st,
            "started_at": step.started_at if step else None,
            "completed_at": step.completed_at if step else None,
            "typical_seconds": int(p50),
            "progress": 0,
            "file": None,
        }
        if st == "completed":
            entry["progress"] = 100
            entry["file"] = file_url(base, creation, filename)
            done_weight += p50
        elif st == "processing":
            current = current or key
            elapsed = _seconds(step.started_at, now) or 0.0
            reported = step.estimated_progress
            if reported:
                frac = max(0.0, min(0.99, reported / 100.0))
            else:
                frac = min(0.95, elapsed / p50) if p50 else 0.0
            entry["progress"] = int(frac * 100)
            done_weight += p50 * frac
            if step.estimated_completion_time and step.estimated_completion_time > now:
                left = (step.estimated_completion_time - now).total_seconds()
            else:
                left = max(p50 - elapsed, p50 * 0.05)
            left_p50 += left
            left_p90 += max(p90 - elapsed, left)
        elif st == "failed":
            current = current or key
            fields = step_errors.response_fields(step, admin=False)
            error = {
                "stage": key,
                "code": fields["error_code"] or "failed",
                "message": fields["error_user"] or "This stage failed.",
                "credits_refunded": fields["credits_refunded"],
            }
        else:
            if status in ("queued", "processing"):
                current = current or key
                left_p50 += p50
                left_p90 += p90
        stages.append(entry)

    extras = {}
    if steps.get("openai_render") and steps["openai_render"].status == "completed":
        extras["painting_cutout"] = file_url(base, creation, "cut_rendered.png")
        extras["thumbnail"] = file_url(base, creation, "thumb_rendered.png")
    rig = steps.get("meshy_rig")
    if rig and rig.status == "completed" and (rig.metadata_json or {}).get("walking_glb_url"):
        extras["walking_animation"] = file_url(base, creation, "walking.glb")
    if steps.get("meshy_3d") and steps["meshy_3d"].status == "completed":
        extras["model_optimized"] = file_url(base, creation, "opt_model.glb")
    if status == "completed":
        extras["avatar_optimized"] = file_url(base, creation, "opt_avatar.vrm")

    running = status in ("queued", "processing")
    progress = 100 if status == "completed" else int(100 * done_weight / total_weight) if total_weight else 0
    out = {
        "id": creation.id,
        "object": "hero",
        "status": status,
        "name": creation.character_name,
        "client_ref": getattr(api_hero, "client_ref", None),
        "created_at": creation.created_at,
        "completed_at": creation.completed_at,
        "stage": current if running or status == "failed" else None,
        "progress": min(progress, 99) if running else progress,
        "eta": {
            "seconds_left": int(round(left_p50)),
            "seconds_left_p90": int(round(left_p90)),
            "finishes_at": now + timedelta(seconds=left_p50),
        } if running else None,
        "stages": stages,
        "files": {
            "drawing": stages[0]["file"],
            "painting": stages[2]["file"],
            "model": stages[3]["file"],
            "rigged": stages[4]["file"],
            "avatar": stages[5]["file"],
            **extras,
        },
        "cost_credits": hero_cost(),
        "error": error,
        "public": bool(creation.is_public),
        "web_url": None,
    }
    return out


def estimates_view() -> dict:
    figures = step_stats.estimates()
    by_stage = []
    for key, step_name, _ in STAGES[1:]:
        f = figures.get(step_name) or {}
        by_stage.append({"stage": key, "typical_seconds": f.get("p50"), "p90_seconds": f.get("p90"),
                         "samples": f.get("samples"), "source": f.get("source")})
    total = step_stats.total()
    return {
        "object": "estimates",
        "total": {"typical_seconds": total["p50"], "p90_seconds": total["p90"]},
        "stages": by_stage,
        "cost_credits": hero_cost(),
        "method": "Median (typical) and 90th percentile of the most recent real runs of each stage, past 60 days; cached results excluded.",
    }


# --- Fetching a drawing by URL, and calling webhooks: never inside our network.

MAX_DRAWING_BYTES = 15 * 1024 * 1024


class UnsafeURL(ValueError):
    pass


def check_public_url(url: str) -> str:
    """Refuse a URL that is not https on a public address (SSRF guard)."""
    parts = urlsplit(url or "")
    if parts.scheme != "https" or not parts.hostname:
        raise UnsafeURL("Use an https:// URL.")
    if parts.username or parts.password:
        raise UnsafeURL("A URL with a user name or password is not allowed.")
    try:
        infos = socket.getaddrinfo(parts.hostname, parts.port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise UnsafeURL(f"Can't find the host {parts.hostname}.")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global or ip.is_multicast:
            raise UnsafeURL("That address is not on the public internet.")
    return url


def fetch_drawing(url: str) -> bytes:
    """The bytes at `url` (https, public, at most 15 MB, no redirects to elsewhere)."""
    import requests

    check_public_url(url)
    with requests.get(url, timeout=(5, 20), stream=True, allow_redirects=False,
                      headers={"User-Agent": "HeroMaker/1 (+https://heromaker.up.railway.app/developers)"}) as r:
        if r.status_code in (301, 302, 303, 307, 308):
            raise UnsafeURL("The image URL redirects. Give the final URL.")
        if r.status_code != 200:
            raise UnsafeURL(f"The image URL answered {r.status_code}.")
        data = bytearray()
        for chunk in r.iter_content(64 * 1024):
            data.extend(chunk)
            if len(data) > MAX_DRAWING_BYTES:
                raise UnsafeURL("The image is over 15 MB.")
    return bytes(data)


# --- Webhooks: a watcher per hero, posting each stage as it finishes.

_watchers: Dict[str, asyncio.Task] = {}
POLL_SECONDS = 3
WATCH_FOR_SECONDS = 3 * 3600
RETRIES = (1, 5, 15)


def _snapshot(v: dict) -> tuple:
    return (v["status"],) + tuple(s["status"] for s in v["stages"])


def _events(before: Optional[dict], after: dict) -> List[str]:
    """What happened between two views of a hero."""
    events = []
    prev = {s["stage"]: s["status"] for s in (before or {}).get("stages", [])}
    for s in after["stages"][1:]:
        if s["status"] == "completed" and prev.get(s["stage"]) != "completed":
            events.append(f"stage.completed:{s['stage']}")
    if after["status"] != (before or {}).get("status") and after["status"] in TERMINAL:
        events.append(f"hero.{after['status']}")
    return events


def _post(url: str, secret: str, event: str, hero: dict) -> bool:
    import requests
    from app.services.api_keys import sign

    body = json.dumps({"type": event.split(":")[0], "stage": event.split(":")[1] if ":" in event else None,
                       "hero": hero, "sent_at": datetime.utcnow().isoformat() + "Z"}, default=str).encode()
    ts = str(int(time.time()))
    headers = {"Content-Type": "application/json", "User-Agent": "HeroMaker-Webhooks/1",
               "X-HeroMaker-Event": event.split(":")[0], "X-HeroMaker-Timestamp": ts,
               "X-HeroMaker-Signature": sign(secret, ts, body)}
    for i, wait in enumerate((0,) + RETRIES):
        if wait:
            time.sleep(wait)
        try:
            check_public_url(url)
            r = requests.post(url, data=body, headers=headers, timeout=10, allow_redirects=False)
            if 200 <= r.status_code < 300:
                return True
            logger.info(f"webhook {event} -> {r.status_code} (try {i + 1})")
        except Exception as e:
            logger.info(f"webhook {event} failed (try {i + 1}): {e}")
    return False


async def _watch(creation_id: str) -> None:
    from app.database import SessionLocal
    from app.models import ApiHero, Creation

    before: Optional[dict] = None
    started = time.monotonic()
    while time.monotonic() - started < WATCH_FOR_SECONDS:
        db = SessionLocal()
        try:
            api_hero = db.query(ApiHero).filter(ApiHero.creation_id == creation_id).first()
            creation = db.query(Creation).filter(Creation.id == creation_id).first()
            if not api_hero or not api_hero.webhook_url or not creation:
                return
            url, secret = api_hero.webhook_url, api_hero.api_key.webhook_secret
            after = view(creation, api_hero.api_base or "", api_hero=api_hero)
        finally:
            db.close()
        if before is None or _snapshot(after) != _snapshot(before):
            for event in _events(before, after):
                await asyncio.to_thread(_post, url, secret, event, after)
        before = after
        if after["status"] in TERMINAL:
            return
        await asyncio.sleep(POLL_SECONDS)


def watch(creation_id: str) -> None:
    """Start posting this hero's stages to its webhook (must be on the event loop)."""
    old = _watchers.get(creation_id)
    if old and not old.done():
        return
    task = asyncio.get_running_loop().create_task(_watch(creation_id))
    _watchers[creation_id] = task
    task.add_done_callback(lambda t: _watchers.pop(creation_id, None) if _watchers.get(creation_id) is t else None)


def resume_watchers() -> int:
    """After a restart: watch again every API hero with a webhook still being made."""
    from app.database import SessionLocal
    from app.models import ApiHero

    since = datetime.utcnow() - timedelta(seconds=WATCH_FOR_SECONDS)
    db = SessionLocal()
    try:
        rows = db.query(ApiHero).filter(ApiHero.webhook_url.isnot(None), ApiHero.created_at >= since).all()
        ids = [r.creation_id for r in rows if r.creation and r.creation.status in ("pending", "processing")]
    finally:
        db.close()
    for cid in ids:
        watch(cid)
    return len(ids)
