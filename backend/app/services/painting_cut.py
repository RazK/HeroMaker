"""
The painting, cut out of an opaque studio backdrop, without touching it.

WHY
---
Heroes painted by an older pipeline have a light studio backdrop baked into
``rendered.png``. On a gallery plate that shows as a beige rectangle, while
newer heroes (painted with ``background="transparent"``) stand free.
app/utils/cutout.py decides, per painting, one of:

* ``cut``          the backdrop was removed: ``cut_rendered.png`` holds the cut-out
* ``transparent``  the painting already has its own alpha: shown as it is
* ``framed``       no confident cut: the client shows it in a polaroid frame

WHERE IT RUNS
-------------
Lazily, by /api/files, the first time anyone asks for ``thumb_rendered.png``
or ``cut_rendered.png`` of a hero (``prepare``), exactly as thumbnails and
``opt_`` copies are made. ``rendered.png`` itself is never modified.

WHAT IT STORES
--------------
* ``cut_rendered.png`` next to the original (a WebP with alpha, named like its
  source as thumbnails are), only for a ``cut``.
* ``thumb_rendered.png`` is remade from the cut (or from the original), and
  overwrites whatever an older version made.
* The decision, on the creation: ``metadata["painting_cut"] = {kind, algo,
  of, reason}``. ``of`` is the painting's version (its step's completed_at),
  ``algo`` the CUTOUT_VERSION. Either changing makes it stale, and it is made
  again. The API reads it to tell the client which case applies
  (CreationResponse.painting), and the painting's file version carries
  CUTOUT_VERSION (schemas.creation.file_versions), so a new algorithm gives
  every derived file a new URL and browsers fetch the new cut.

WHAT IT PROMISES
----------------
Never raises into a request: any failure is logged and the caller serves what
it served before this existed. At most CONCURRENT cut-outs run at once (each
~1-2 s of one CPU core), one per hero at a time. A request never waits more
than WAIT_S for its turn: it gets BUSY, and the caller serves the painting as
it is, uncached, so a gallery full of old heroes on its first visit after a
release never ties up the worker threads every other endpoint shares.
"""
import io
import logging
import threading
from typing import Optional

from sqlalchemy.orm import selectinload

from app.utils import cutout
from app.utils.storage import THUMB_PREFIX, cut_name

logger = logging.getLogger(__name__)

SOURCE = "rendered.png"
CUT_FILE = cut_name(SOURCE)          # cut_rendered.png
THUMB_FILE = THUMB_PREFIX + SOURCE   # thumb_rendered.png
STEP = "openai_render"               # the step whose output SOURCE is
METADATA_KEY = "painting_cut"

CUT_WEBP_QUALITY = 90
CONCURRENT = 2
WAIT_S = 3.0
BUSY = "busy"  # prepare() could not get a turn in time: serve the painting as it is, uncached

_slots = threading.BoundedSemaphore(CONCURRENT)
_locks_guard = threading.Lock()
_locks: dict[str, threading.Lock] = {}


def _lock_for(creation_id: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(creation_id, threading.Lock())


def render_version(creation) -> Optional[str]:
    """The painting's version (see schemas.creation._version), or None until it is painted."""
    from app.schemas.creation import _version
    for step in creation.steps or []:
        if step.step_name == STEP and step.status == "completed":
            return _version(step.completed_at)
    return None


def stored_kind(creation) -> Optional[str]:
    """The decision made for the hero's current painting by the current algorithm, or None."""
    if creation is None:
        return None
    entry = (creation.metadata_json or {}).get(METADATA_KEY)
    if not isinstance(entry, dict) or entry.get("kind") not in cutout.KINDS:
        return None
    if entry.get("algo") != cutout.CUTOUT_VERSION or entry.get("of") != render_version(creation):
        return None
    return entry["kind"]


def encode_cut(image) -> bytes:
    out = io.BytesIO()
    image.save(out, "WEBP", quality=CUT_WEBP_QUALITY, alpha_quality=100, method=4)
    return out.getvalue()


def prepare(storage, user_id: str, creation_id: str) -> Optional[str]:
    """
    Make sure the hero's derived painting files are current; return the kind
    (cutout.CUT / TRANSPARENT / FRAMED), BUSY when every slot stayed taken
    for WAIT_S, or None when there is nothing to do (no such hero, not
    painted yet, the file is missing) or it failed.
    Synchronous (DB, storage, CPU): run it in a worker thread.
    """
    from app.database import SessionLocal
    from app.models import Creation

    db = None
    try:
        db = SessionLocal()
        creation = (db.query(Creation).options(selectinload(Creation.steps))
                    .filter(Creation.id == creation_id).first())
        if creation is None or creation.user_id != user_id:
            return None
        version = render_version(creation)
        if version is None:
            return None
        kind = stored_kind(creation)
        if kind is not None and (kind != cutout.CUT or storage.file_exists(user_id, creation_id, CUT_FILE)):
            return kind

        lock = _lock_for(creation_id)
        if not lock.acquire(timeout=WAIT_S):
            return BUSY
        try:
            # Another request may have made it while this one waited.
            db.refresh(creation)
            kind = stored_kind(creation)
            if kind is not None and (kind != cutout.CUT or storage.file_exists(user_id, creation_id, CUT_FILE)):
                return kind
            if not _slots.acquire(timeout=WAIT_S):
                return BUSY
            try:
                kind, reason = _derive(storage, user_id, creation_id)
            finally:
                _slots.release()
            metadata = {
                **(creation.metadata_json or {}),
                METADATA_KEY: {"kind": kind, "algo": cutout.CUTOUT_VERSION, "of": version, "reason": reason},
            }
            # Write updated_at back as it was: the gallery orders by it, and
            # deriving a file must not move a hero to the top of every view.
            db.query(Creation).filter(Creation.id == creation_id).update(
                {Creation.metadata_json: metadata, Creation.updated_at: Creation.updated_at},
                synchronize_session=False,
            )
            db.commit()
            return kind
        finally:
            lock.release()
    except FileNotFoundError:
        return None
    except Exception as exc:
        if db is not None:
            try:
                db.rollback()
            except Exception:
                pass
        logger.warning("[%s] painting cut-out failed (%s: %s); serving the painting as it is",
                       creation_id, type(exc).__name__, exc, exc_info=True)
        return None
    finally:
        if db is not None:
            db.close()


def _derive(storage, user_id: str, creation_id: str) -> tuple[str, str]:
    """Cut the painting and (re)write cut_rendered.png and thumb_rendered.png."""
    from app.api.files import _make_thumbnail

    original = storage.download_file(user_id, creation_id, SOURCE)
    result = cutout.cut_out(original)
    logger.info("[%s] painting: %s (%s) %s", creation_id, result.kind, result.reason, result.stats)
    if result.kind == cutout.CUT:
        cut = encode_cut(result.image)
        storage.upload_file(user_id, creation_id, CUT_FILE, cut, content_type="image/webp")
        thumb_source = cut
    else:
        if storage.file_exists(user_id, creation_id, CUT_FILE):
            storage.delete_file(user_id, creation_id, CUT_FILE)
        thumb_source = original
    # Overwrite whatever thumbnail an older version made from the opaque original.
    thumb, mime = _make_thumbnail(thumb_source)
    storage.upload_file(user_id, creation_id, THUMB_FILE, thumb, content_type=mime)
    return result.kind, result.reason


def painting_look(creation) -> Optional[str]:
    """What the client should do with the painting: cut / transparent / framed, or None (not decided yet)."""
    return stored_kind(creation)
