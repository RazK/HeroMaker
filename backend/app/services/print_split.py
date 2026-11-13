"""Cut a finished hero into printable parts: Meshy's Auto Split.

docs.meshy.ai/api/auto-split. Meshy cuts the hero's 3D model into separate
parts, each one printable on its own and glued back together: for a model too
big for a home printer's bed, or one printed a colour at a time. It only takes
a Meshy task id, never a file, so the input is the image-to-3D task the hero's
model came from (the meshy_3d step keeps it, cached heroes included).

An admin preview for now (POST/GET /api/v1/heroes/{id}/print-split): a split
costs our Meshy account 10 credits and is not part of a hero.

State lives next to the hero's files, not in a table: print_split.json, plus
split.glb (the parts, textured), split.3mf (the parts, for a slicer) and
split_preview.png once Meshy is done. Nothing polls in the background: each GET
asks Meshy, at most every few seconds, until the task ends, so a restart loses
nothing.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime
from typing import Any, Dict, Optional

import requests
from sqlalchemy.orm import Session

from app.config import pricing
from app.models import Creation, CreationStep
from app.services import usage as usage_service
from app.services.meshy import MeshyAPIError, MeshyClient, MeshyOutOfCredits
from app.services.usage import UsageContext
from app.utils.storage import get_storage

logger = logging.getLogger(__name__)

STATE_FILE = "print_split.json"
PARTS_GLB = "split.glb"
PARTS_3MF = "split.3mf"
PREVIEW = "split_preview.png"

MODES = ("auto", "by_parts")
PROMPT_MAX = 600
RUNNING = ("PENDING", "IN_PROGRESS")
ENDED = ("SUCCEEDED", "FAILED", "CANCELED")
# How often a GET may ask Meshy how it is going.
POLL_SECONDS = 3.0


class SplitError(Exception):
    """Why a split could not start: an HTTP status, a code and a plain message."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def source_task_id(db: Session, creation: Creation) -> Optional[str]:
    """The Meshy image-to-3D task the hero's model came from, if it has one."""
    step = (
        db.query(CreationStep)
        .filter(CreationStep.creation_id == creation.id, CreationStep.step_name == "meshy_3d")
        .first()
    )
    if step is None or step.status != "completed":
        return None
    return (step.metadata_json or {}).get("meshy_3d_task_id")


def read_state(creation: Creation) -> Optional[Dict[str, Any]]:
    storage = get_storage()
    if not storage.file_exists(creation.user_id, creation.id, STATE_FILE):
        return None
    return json.loads(storage.download_file(creation.user_id, creation.id, STATE_FILE))


def _write_state(creation: Creation, state: Dict[str, Any]) -> None:
    get_storage().upload_file(
        creation.user_id, creation.id, STATE_FILE,
        json.dumps(state).encode(), content_type="application/json",
    )


def start(db: Session, creation: Creation, *, by_user_id: str, mode: str = "auto",
          prompt: Optional[str] = None, connectors: bool = False,
          client: Optional[MeshyClient] = None) -> Dict[str, Any]:
    """Ask Meshy to split the hero. A split already running is returned, not started twice."""
    if mode not in MODES:
        raise SplitError(400, "bad_mode", f"mode must be one of: {', '.join(MODES)}")
    prompt = (prompt or "").strip() or None
    if mode == "by_parts" and not prompt:
        raise SplitError(400, "prompt_required", "Name the parts to cut along, e.g. head, body, arms, legs.")
    if prompt and len(prompt) > PROMPT_MAX:
        raise SplitError(400, "prompt_too_long", f"The parts list is at most {PROMPT_MAX} characters.")

    state = read_state(creation)
    if state and state.get("status") in RUNNING:
        return state
    source = source_task_id(db, creation)
    if not source:
        raise SplitError(409, "no_source", "This hero has no finished 3D model to split.")

    client = client or MeshyClient()
    try:
        task_id = client.create_print_split_task(
            source, mode=mode, prompt=prompt if mode == "by_parts" else None, connectors=connectors,
            usage=UsageContext(user_id=by_user_id, creation_id=creation.id, step_name="print_split"),
        )
    except MeshyOutOfCredits as e:
        raise SplitError(402, "meshy_plan", f"Meshy refused: our account needs a paid plan with credits ({e}).")
    except MeshyAPIError as e:
        raise SplitError(502, "meshy_refused", f"Meshy refused the split: {e}")

    state = {
        "task_id": task_id,
        "source_task_id": source,
        "status": "PENDING",
        "progress": 0,
        "mode": mode,
        "prompt": prompt if mode == "by_parts" else None,
        "connectors": connectors,
        "part_count": None,
        "error": None,
        "files": [],
        "by": by_user_id,
        "started_at": datetime.utcnow().isoformat() + "Z",
        "finished_at": None,
        "checked": 0,
    }
    _write_state(creation, state)
    logger.info("[%s] Meshy print split %s started from %s", creation.id, task_id, source)
    return state


def _download(url: str) -> bytes:
    response = requests.get(url, timeout=120)
    response.raise_for_status()
    return response.content


def refresh(creation: Creation, client: Optional[MeshyClient] = None,
            now: Optional[float] = None) -> Optional[Dict[str, Any]]:
    """The split as it stands, after asking Meshy if it is still running."""
    state = read_state(creation)
    if not state or state.get("status") in ENDED:
        return state
    now = time.time() if now is None else now
    if now - float(state.get("checked") or 0) < POLL_SECONDS:
        return state

    client = client or MeshyClient()
    try:
        task = client.get_print_split_status(state["task_id"])
    except MeshyAPIError as e:
        logger.warning("[%s] Meshy print split %s: status check failed: %s", creation.id, state["task_id"], e)
        state["checked"] = now
        _write_state(creation, state)
        return state

    status = task.get("status") or state["status"]
    state["progress"] = int(task.get("progress") or 0)
    state["checked"] = now
    if status == "SUCCEEDED":
        storage = get_storage()
        urls = task.get("model_urls") or {}
        files = []
        for name, key, kind in ((PARTS_GLB, "glb", "model/gltf-binary"), (PARTS_3MF, "3mf", "model/3mf")):
            if urls.get(key):
                storage.upload_file(creation.user_id, creation.id, name, _download(urls[key]), content_type=kind)
                files.append(name)
        preview = task.get("alpha_thumbnail_url") or task.get("thumbnail_url")
        if preview:
            storage.upload_file(creation.user_id, creation.id, PREVIEW, _download(preview), content_type="image/png")
            files.append(PREVIEW)
        state.update(status="SUCCEEDED", progress=100, part_count=task.get("part_count"), files=files,
                     finished_at=datetime.utcnow().isoformat() + "Z")
        usage_service.finalize_usage_by_provider_ref(
            pricing.PROVIDER_MESHY, state["task_id"], "succeeded",
            metadata={"part_count": task.get("part_count"), "consumed_credits": task.get("consumed_credits")},
        )
    elif status in ("FAILED", "CANCELED"):
        err = task.get("task_error") or {}
        state.update(status=status, error=(err.get("message") if isinstance(err, dict) else str(err)) or status.lower(),
                     finished_at=datetime.utcnow().isoformat() + "Z")
        usage_service.finalize_usage_by_provider_ref(pricing.PROVIDER_MESHY, state["task_id"], "failed",
                                                     metadata={"task_error": err})
    else:
        state["status"] = status
    _write_state(creation, state)
    return state


def view(creation: Creation, base: str, state: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """What the app reads: the split's state and, once done, its files."""
    from app.services.api_heroes import file_url

    if not state:
        return {"object": "print_split", "hero_id": creation.id, "status": "none"}
    files = set(state.get("files") or [])
    # Each split overwrites the same names: the task id in the URL keeps a
    # browser from showing the previous split's file.
    stamp = f"?v={state['task_id'][:12]}"

    def url(name: str) -> Optional[str]:
        return file_url(base, creation, name) + stamp if name in files else None

    return {
        "object": "print_split",
        "hero_id": creation.id,
        "status": state["status"].lower(),
        "progress": state.get("progress") or 0,
        "mode": state.get("mode"),
        "prompt": state.get("prompt"),
        "connectors": bool(state.get("connectors")),
        "part_count": state.get("part_count"),
        "error": state.get("error"),
        "started_at": state.get("started_at"),
        "finished_at": state.get("finished_at"),
        "cost_meshy_credits": pricing.MESHY_PRINT_SPLIT_CREDITS,
        "files": {
            "parts": url(PARTS_GLB),
            "parts_3mf": url(PARTS_3MF),
            "preview": url(PREVIEW),
        },
    }
