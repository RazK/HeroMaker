"""
Is this hero's upload a drawing, or a photo of a real person?

WHY
---
A photo of a person is painted as a flattering likeness (the clause
openai.PHOTO_LIKENESS_PROMPT); a drawing exactly as it always was. Product
rule: people look at least as good as in their photo - at least as tall and
slim, never heavier, older or less attractive - and drawings never gain traits
they do not have.

WHERE IT RUNS
-------------
`pipeline.step_openai_render` asks `kind_for_creation` before it looks in the
result cache, because the answer is part of the prompt the cache keys on.

WHAT IT PROMISES
----------------
* It never raises and never fails a step. No key, an unreadable image, an
  OpenAI error, the 10 s timeout, an answer outside openai.INPUT_KINDS: all
  mean "drawing", the behaviour every hero had before this existed.
* One call per hero at most. The answer is stored on the creation
  (metadata["input_kind"]), so "Make it again" and "Try again" reuse it; a
  failure is not stored, so the next run may still ask.
* It costs the user nothing in credits. The call is a usage_event
  (pricing.OP_OPENAI_INPUT_KIND); a staging result-cache hit is a zero-cost
  "cache_hit" event instead, as for the naming call.
"""
import logging
from typing import Optional

from sqlalchemy.orm.attributes import flag_modified

from app.config import pricing
from app.database import SessionLocal
from app.models import Creation
from app.services import openai as openai_service
from app.services import result_cache
from app.services import usage as usage_service
from app.services.usage import UsageContext
from app.utils.storage import get_storage

logger = logging.getLogger(__name__)

# usage_events.step_name for the classification call, and the result-cache "kind".
USAGE_STEP = "input_kind"

# What the painting is made from: openai_render's own input.
INPUT_FILE = "processed.jpg"

# Where the answer lives on the creation: metadata["input_kind"]["kind"].
METADATA_KEY = "input_kind"


def stored_kind(creation: Optional[Creation]) -> Optional[str]:
    """The kind already decided for this creation, or None."""
    if creation is None:
        return None
    entry = (creation.metadata_json or {}).get(METADATA_KEY)
    kind = entry.get("kind") if isinstance(entry, dict) else None
    return kind if kind in openai_service.INPUT_KINDS else None


def kind_for_creation(creation_id: str, user_id: str) -> str:
    """
    One of openai.INPUT_KINDS for this creation's upload; INPUT_KIND_DRAWING
    whenever it cannot tell. Never raises. Synchronous (DB, storage and one
    HTTP call at most): run it in a worker thread.
    """
    db = None
    try:
        db = SessionLocal()
        creation = db.query(Creation).filter(Creation.id == creation_id).first()
        if creation is None:
            return openai_service.INPUT_KIND_DRAWING
        known = stored_kind(creation)
        if known:
            return known

        image = get_storage().download_file(user_id, creation_id, INPUT_FILE)
        kind, source = _classify(image, creation_id, user_id)
        if kind is None:
            return openai_service.INPUT_KIND_DRAWING

        creation.metadata_json = {
            **(creation.metadata_json or {}),
            METADATA_KEY: {"kind": kind, "source": source, "model": openai_service.INPUT_KIND_MODEL},
        }
        flag_modified(creation, "metadata_json")
        db.commit()
        logger.info("[%s] input kind: %s (%s)", creation_id, kind, source)
        return kind
    except Exception as exc:  # a classification must never break a render
        if db is not None:
            try:
                db.rollback()
            except Exception:
                pass
        logger.warning("[%s] input kind: failed (%s: %s); painting it as a drawing",
                       creation_id, type(exc).__name__, exc, exc_info=True)
        return openai_service.INPUT_KIND_DRAWING
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                pass


def _classify(image: bytes, creation_id: str, user_id: str):
    """(kind, "cache" | "openai") or (None, None) on failure."""
    version = openai_service.input_kind_cache_version()
    cached = result_cache.get_value(USAGE_STEP, image, version)
    if cached and cached.get("kind") in openai_service.INPUT_KINDS:
        usage_service.record_usage(
            UsageContext.for_step(creation_id, user_id, USAGE_STEP),
            pricing.PROVIDER_INTERNAL,
            pricing.OP_RESULT_CACHE_HIT,
            quantity=1,
            status="cache_hit",
            cost_usd_micros=0,
            units=0,
            metadata={
                "cache_hit": True,
                "skipped_provider": pricing.PROVIDER_OPENAI,
                "skipped_operation": pricing.OP_OPENAI_INPUT_KIND,
                "avoided_list_price_usd_micros": pricing.OPENAI_HERO_NAME_USD_MICROS,
            },
        )
        return cached["kind"], "cache"

    try:
        kind = openai_service.classify_input(
            image, usage=UsageContext.for_step(creation_id, user_id, USAGE_STEP)
        )
    except Exception as exc:
        logger.warning("[%s] input kind: classification failed (%s: %s); painting it as a drawing",
                       creation_id, type(exc).__name__, exc)
        return None, None
    result_cache.put_value(USAGE_STEP, image, version, {"kind": kind},
                           source_creation_id=creation_id)
    return kind, "openai"
