"""Cut a finished hero into printable parts: Meshy's Auto Split.

docs.meshy.ai/api/auto-split. Meshy cuts the hero's 3D model into separate
parts, each one printable on its own and glued back together: for a model too
big for a home printer's bed, or one printed a colour at a time. It only takes
a Meshy task id, never a file, so the input is the image-to-3D task the hero's
model came from (the meshy_3d step keeps it, cached heroes included).

Meshy deletes every task 3 days after it ends (docs.meshy.ai/api/asset-retention)
and then answers 404 "Task not found". Most heroes are older than that, and
every staging hero made from the result cache points at a task long gone. So
when Meshy no longer has the task, the split goes in two steps: hand Meshy our
own copy of model.glb as a remesh (it takes a model_url), then split that
remesh, which is a fresh task of ours.

An admin preview for now (POST/GET /api/v1/heroes/{id}/print-split): a split
costs our Meshy account 10 credits and is not part of a hero.

State lives next to the hero's files, not in a table: print_split.json, plus
split.glb (the parts, textured), split.3mf (the parts, for a slicer) and
split_preview.png once Meshy is done. Nothing polls in the background: each GET
asks Meshy, at most every few seconds, until the task ends, so a restart loses
nothing.
"""
from __future__ import annotations

import base64
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
SOURCE_MODEL = "model.glb"

MODES = ("auto", "by_parts")
PROMPT_MAX = 600
RUNNING = ("PENDING", "IN_PROGRESS")
ENDED = ("SUCCEEDED", "FAILED", "CANCELED")
# How often a GET may ask Meshy how it is going.
POLL_SECONDS = 3.0


# How much of the bar the remesh fills, when a split needs one first.
REMESH_SHARE = 30


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
    storage = get_storage()
    if not source and not storage.file_exists(creation.user_id, creation.id, SOURCE_MODEL):
        raise SplitError(409, "no_source", "This hero has no finished 3D model to split.")

    client = client or MeshyClient()
    state = {
        "task_id": None,
        "source_task_id": source,
        "remesh_task_id": None,
        "stage": "split",
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
    try:
        try:
            if not source:
                raise _Gone()
            state["task_id"] = _create_split(client, creation, state, source)
            logger.info("[%s] Meshy print split %s started from %s", creation.id, state["task_id"], source)
        except _Gone:
            state["stage"] = "remesh"
            state["remesh_task_id"] = client.create_remesh_from_model(
                _model_url(creation), usage=_usage(creation, by_user_id),
            )
            logger.info("[%s] Meshy no longer has task %s: remeshing our model.glb as %s, then splitting",
                        creation.id, source, state["remesh_task_id"])
    except MeshyOutOfCredits as e:
        raise SplitError(402, "meshy_plan", f"Meshy refused: our account needs a paid plan with credits ({e}).")
    except MeshyAPIError as e:
        raise SplitError(502, "meshy_refused", f"Meshy refused the split: {e}")
    _write_state(creation, state)
    return state


class _Gone(Exception):
    """Meshy has deleted the task (or the hero never kept its id)."""


def _usage(creation: Creation, by_user_id: str) -> UsageContext:
    return UsageContext(user_id=by_user_id, creation_id=creation.id, step_name="print_split")


def _create_split(client: MeshyClient, creation: Creation, state: Dict[str, Any], input_task_id: str) -> str:
    """Start Meshy's split of `input_task_id`; _Gone when Meshy no longer has that task."""
    try:
        return client.create_print_split_task(
            input_task_id, mode=state["mode"], prompt=state.get("prompt"), connectors=bool(state.get("connectors")),
            usage=_usage(creation, state["by"]),
        )
    except MeshyOutOfCredits:
        raise
    except MeshyAPIError as e:
        if getattr(e, "status_code", None) == 404 or "not found" in str(e).lower():
            raise _Gone() from e
        raise


def _model_url(creation: Creation) -> str:
    """Where Meshy can fetch the hero's model.glb: a presigned link, or the bytes inline."""
    storage = get_storage()
    url = storage.get_file_url(creation.user_id, creation.id, SOURCE_MODEL, expires_in=3600)
    if url.startswith("https://") or url.startswith("http://"):
        return url
    data = storage.download_file(creation.user_id, creation.id, SOURCE_MODEL)
    return "data:model/gltf-binary;base64," + base64.b64encode(data).decode()


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
    if state.get("stage") == "remesh":
        return _refresh_remesh(creation, state, client, now)
    try:
        task = client.get_print_split_status(state["task_id"])
    except MeshyAPIError as e:
        logger.warning("[%s] Meshy print split %s: status check failed: %s", creation.id, state["task_id"], e)
        state["checked"] = now
        _write_state(creation, state)
        return state

    status = task.get("status") or state["status"]
    progress = int(task.get("progress") or 0)
    if state.get("remesh_task_id"):
        progress = REMESH_SHARE + progress * (100 - REMESH_SHARE) // 100
    state["progress"] = progress
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


def _refresh_remesh(creation: Creation, state: Dict[str, Any], client: MeshyClient, now: float) -> Dict[str, Any]:
    """The first of two steps: Meshy taking in our model. Once it has, start the split."""
    state["checked"] = now
    try:
        task = client.get_remesh_status(state["remesh_task_id"])
    except MeshyAPIError as e:
        logger.warning("[%s] Meshy remesh %s: status check failed: %s", creation.id, state["remesh_task_id"], e)
        _write_state(creation, state)
        return state

    status = task.get("status")
    state["progress"] = int(task.get("progress") or 0) * REMESH_SHARE // 100
    ended = datetime.utcnow().isoformat() + "Z"
    if status == "SUCCEEDED":
        usage_service.finalize_usage_by_provider_ref(pricing.PROVIDER_MESHY, state["remesh_task_id"], "succeeded")
        try:
            state["task_id"] = _create_split(client, creation, state, state["remesh_task_id"])
            state.update(stage="split", status="PENDING", progress=REMESH_SHARE)
            logger.info("[%s] Meshy print split %s started from remesh %s",
                        creation.id, state["task_id"], state["remesh_task_id"])
        except (MeshyAPIError, _Gone) as e:
            state.update(status="FAILED", error=f"Meshy refused the split: {e or 'task not found'}", finished_at=ended)
    elif status in ("FAILED", "CANCELED"):
        err = task.get("task_error") or {}
        message = (err.get("message") if isinstance(err, dict) else str(err)) or status.lower()
        state.update(status=status, error=f"Meshy could not take the model: {message}", finished_at=ended)
        usage_service.finalize_usage_by_provider_ref(pricing.PROVIDER_MESHY, state["remesh_task_id"], "failed",
                                                     metadata={"task_error": err})
    elif status in RUNNING:
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
    stamp = f"?v={(state.get('task_id') or '')[:12]}"

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
        "stage": state.get("stage") or "split",
        "cost_meshy_credits": pricing.MESHY_PRINT_SPLIT_CREDITS,
        "files": {
            "parts": url(PARTS_GLB),
            "parts_3mf": url(PARTS_3MF),
            "preview": url(PREVIEW),
        },
    }
