"""
DEMO ONLY, opt-in, never in production: make a hero from a drawing we already have.

WHY
---
Recording a demo of the class flow means making several heroes in a couple of
minutes, locally, with no OpenAI or Meshy key and no Blender converter. The
pipeline already has a way to run without providers: its admin "mock" mode
(`run_pipeline(..., mock_creation_id=...)`), which copies each step's output
from an existing hero instead of calling the provider. Everything else is the
real thing: `execute_step` charges each step to the owner before the copy and
refunds it if the step fails, the steps go processing -> completed one by one,
and the app polls them as usual.

This module decides WHEN to use it: only when the drawing uploaded is
byte-identical to the original drawing of one of the heroes listed in
PIPELINE_DEMO_LIBRARY. A different drawing gets the real providers, so the
demo can never show a stranger's hero for a child's drawing.

    PIPELINE_DEMO_LIBRARY=<creation id>,<creation id>,...
    PIPELINE_MOCK_STEP_SECONDS=2      # optional: hold each mocked step this long

Same production guard as the staging result cache (app/services/result_cache.py):
ignored in a Railway environment named "production", whatever the flag says.
"""
import hashlib
import logging
import os
from typing import Optional

from sqlalchemy.orm import Session

from app.models import Creation
from app.services.result_cache import _is_production
from app.utils.storage import get_storage

logger = logging.getLogger(__name__)

ENV_LIBRARY = "PIPELINE_DEMO_LIBRARY"
ENV_STEP_SECONDS = "PIPELINE_MOCK_STEP_SECONDS"


def _library_ids() -> list:
    raw = os.getenv(ENV_LIBRARY, "")
    ids = [x.strip() for x in raw.split(",") if x.strip()]
    if ids and _is_production():
        logger.error("%s is set in production; ignoring it. It is for demos only.", ENV_LIBRARY)
        return []
    return ids


def match(db: Session, drawing: bytes) -> Optional[Creation]:
    """The library hero whose original drawing is exactly `drawing`, if any.

    Never raises: any problem reading the library is a miss, and the hero is
    made by the real providers.
    """
    ids = _library_ids()
    if not ids:
        return None
    wanted = hashlib.sha256(drawing).hexdigest()
    storage = get_storage()
    for creation in db.query(Creation).filter(Creation.id.in_(ids)).all():
        try:
            original = storage.download_file(creation.user_id, creation.id, "original.jpg")
        except Exception:
            continue
        if hashlib.sha256(original).hexdigest() == wanted:
            logger.info("DEMO: drawing matches library hero %s; mocking providers", creation.id)
            return creation
    return None


def mock_step_seconds() -> float:
    """How long a mocked step holds before copying its output. 0 unless set."""
    try:
        return max(0.0, min(30.0, float(os.getenv(ENV_STEP_SECONDS, "0") or 0)))
    except ValueError:
        return 0.0
