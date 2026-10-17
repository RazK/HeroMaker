"""
Give a new hero a name from its drawing.

WHERE IT RUNS
-------------
`pipeline.step_image_processing` starts `name_creation` in a worker thread and
does NOT wait for it: image_processing is free and runs first, so the name
lands while the paid steps are still painting and modelling the hero. The
backfill script (backend/scripts/backfill_hero_names.py) calls the same
function for heroes made before this existed.

WHAT IT PROMISES
----------------
* It never raises and never blocks a step. Any failure - no key, unreadable
  drawing, OpenAI error, the 10 s timeout - is logged and leaves the name empty;
  the UI then shows "Your hero", as it always has.
* It never overwrites a name. It skips a hero that already has one, and the
  final write is a conditional UPDATE (`... WHERE character_name IS NULL OR
  blank`), so a name the user types while the call is in flight wins.
* It costs the user nothing in credits. The OpenAI call is recorded as a
  usage_event (operation pricing.OP_OPENAI_HERO_NAME), so finance sees it.
* It respects the staging result cache: the same drawing with the same prompt
  and model is named from the cache, at zero cost, with a zero-cost
  "cache_hit" usage_event in place of the paid one.
"""
import logging
from typing import Optional

from sqlalchemy import func, or_

from app.config import pricing
from app.database import SessionLocal
from app.models import Creation
from app.services import openai as openai_service
from app.services import result_cache
from app.services import usage as usage_service
from app.services.usage import UsageContext
from app.utils.storage import get_storage

logger = logging.getLogger(__name__)

# usage_events.step_name for the naming call, and the result-cache "step".
USAGE_STEP = "hero_name"

# The drawing the user uploaded: image_processing's input.
DRAWING_FILE = "original.jpg"


def has_name(value: Optional[str]) -> bool:
    return bool(value and value.strip())


def _unnamed():
    return or_(Creation.character_name.is_(None), func.trim(Creation.character_name) == "")


def name_creation(creation_id: str, user_id: str) -> Optional[str]:
    """
    Name this creation from its drawing if it has no name yet.

    Returns the name it set, or None when it set nothing (already named, no
    key, failure, nothing usable). Never raises. Synchronous: blocking I/O and
    one HTTP call, so run it in a worker thread.
    """
    db = None
    try:
        if not openai_service.OPENAI_API_KEY:
            logger.info("[%s] hero name: OPENAI_API_KEY not set; leaving it unnamed", creation_id)
            return None

        db = SessionLocal()
        creation = db.query(Creation).filter(Creation.id == creation_id).first()
        if creation is None or has_name(creation.character_name):
            return None

        drawing = get_storage().download_file(user_id, creation_id, DRAWING_FILE)
        name = _name_for_drawing(drawing, creation_id, user_id)
        if not name:
            logger.info("[%s] hero name: nothing usable came back; leaving it unnamed", creation_id)
            return None

        # Conditional: if the user named the hero while we were asking, theirs stays.
        updated = (
            db.query(Creation)
            .filter(Creation.id == creation_id, _unnamed())
            .update({Creation.character_name: name}, synchronize_session=False)
        )
        db.commit()
        if not updated:
            logger.info("[%s] hero name: named meanwhile; keeping the user's name", creation_id)
            return None
        logger.info("[%s] hero name: %r", creation_id, name)
        return name
    except Exception as exc:  # a name must never break anything
        if db is not None:
            try:
                db.rollback()
            except Exception:
                pass
        logger.warning("[%s] hero name: failed (%s: %s); leaving it unnamed",
                       creation_id, type(exc).__name__, exc, exc_info=True)
        return None
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                pass


def _name_for_drawing(drawing: bytes, creation_id: str, user_id: str) -> Optional[str]:
    """From the cache if it holds this drawing, else from OpenAI (and cached)."""
    version = openai_service.hero_name_cache_version()
    cached = result_cache.get_value(USAGE_STEP, drawing, version)
    if cached:
        name = openai_service.sanitize_hero_name(cached.get("name"))
        if name:
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
                    "skipped_operation": pricing.OP_OPENAI_HERO_NAME,
                    "avoided_list_price_usd_micros": pricing.OPENAI_HERO_NAME_USD_MICROS,
                },
            )
            logger.info("[%s] hero name: result cache HIT", creation_id)
            return name

    name = openai_service.suggest_hero_name(
        drawing, usage=UsageContext.for_step(creation_id, user_id, USAGE_STEP)
    )
    if name:
        result_cache.put_value(USAGE_STEP, drawing, version, {"name": name},
                               source_creation_id=creation_id)
    return name
