"""
Analytics: who came, through which door, and how far they got
(docs/analytics/REQUIREMENTS.md).

First-party and small. Events go to our own table (models.AnalyticsEvent);
there is no third-party tracker anywhere.

Kids use this, so the schema is an ALLOW-LIST, and it is closed:

- an event's name is one of EVENTS;
- its properties are the ones EVENTS lists for it, and nothing else;
- every property value is one of four kinds, none of which can carry a name,
  an email or a sentence: an ``enum`` (one of a fixed list), an ``int`` inside
  fixed bounds, a ``bool``, or a ``slug`` (a short machine id: lowercase
  letters, digits, ``-`` and ``_``, 40 at most, so no ``@``, no ``.``, no
  spaces, no capitals).

Anything else is dropped, never stored. There is no kind for free text, and
tests/test_analytics.py fails if one is ever added. No IP address and no user
agent are read.

Two kinds of event:

- BROWSER events arrive in batches at POST /api/v1/events with the browser's
  own random visitor id. The signed-in account is taken from the session, never
  from the body.
- SERVER events are written by the backend at the moment the thing happens:
  ``purchase_done`` when Lemon Squeezy's webhook has been recorded,
  ``hero_ready`` / ``hero_failed`` from the pipeline, ``class_created`` /
  ``class_joined`` from the class service. A browser cannot send one: the
  browser must never be the one to say a payment happened.

Robots (the staging robot, any automated browser, test accounts) are stored
with ``is_robot`` and left out of every graph (analytics_report.py).

Recording never breaks the product: ``record_server`` and the helpers built on
it catch everything and log.
"""
import logging
import os
import re
import threading
import time
from collections import deque
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.config import packs as packs_config
from app.config import pricing
from app.config.steps import get_all_step_names, get_last_step
from app.models import AnalyticsEvent, ClassGuest, Creation, CreationStep, User
from app.services import step_errors
from app.services.account_kinds import is_test_account

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# On or off
# ---------------------------------------------------------------------------

ENV_FLAG = "ANALYTICS_ENABLED"


def enabled() -> bool:
    """Whether anything is recorded at all. OFF unless ANALYTICS_ENABLED is set.

    Off by default on purpose. The privacy policy Raz approved
    (frontend/src/components/tb/Privacy.tsx) says "No analytics, ads or
    tracking", and only he changes its words. Staging turns this on
    (devops/railway/env/backend.staging.env); production stays off, whatever
    is promoted, until the policy says what is collected and the variable is
    set there. Off, the endpoint answers and stores nothing, and the backend's
    own events are not written.
    """
    return os.getenv(ENV_FLAG, "").strip().lower() in ("1", "true", "yes", "on")


# ---------------------------------------------------------------------------
# The allow-list
# ---------------------------------------------------------------------------

ENUM, INT, BOOL, SLUG = "enum", "int", "bool", "slug"
# The only kinds a property may be. Not one of them is free text.
KINDS = (ENUM, INT, BOOL, SLUG)

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
VISITOR_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
DEVICES = ("phone", "desktop")


def enum(*values: str) -> tuple:
    return (ENUM, tuple(values))


def integer(low: int, high: int) -> tuple:
    return (INT, low, high)


BOOLEAN = (BOOL,)
SLUG_VALUE = (SLUG,)

MOCK_PROVIDER = "mock"
PROVIDERS = pricing.PROVIDERS + (MOCK_PROVIDER,)


def _pack_slugs() -> tuple:
    return tuple(p["slug"] for p in packs_config.get_packs()) + (packs_config.CLASS_SEATS_SLUG,)


# What the browser may send.
BROWSER_EVENTS: Dict[str, Dict[str, tuple]] = {
    "visit": {"returning": BOOLEAN},
    "hero_opened": {"from": enum("gallery", "mine", "class", "link")},
    "make_started": {},
    "photo_taken": {},
    "photo_chosen": {},
    "make_choice": {"choice": enum("moving", "toy", "both")},
    "survey_answered": {
        "purpose": enum("fun", "gift", "class", "event", "skipped"),
        "who": enum("kid", "grownup", "skipped"),
    },
    "signin_shown": {},
    "signin_done": {"method": enum("google", "password", "signup")},
    "credits_shown": {},
    "checkout_started": {"pack": enum(*_pack_slugs())},
    "wait_left": {"minutes": integer(0, 600)},
    "move_tapped": {"move": SLUG_VALUE},
    "game_started": {"game": SLUG_VALUE},
    "game_ended": {"game": SLUG_VALUE, "seconds": integer(0, 86_400), "score": integer(0, 10_000_000)},
    "share_tapped": {},
}

# What only the backend writes.
SERVER_EVENTS: Dict[str, Dict[str, tuple]] = {
    "purchase_done": {
        "pack": enum(*_pack_slugs()),
        "amount_cents": integer(0, 10_000_000),
        "test": BOOLEAN,
    },
    "hero_ready": {"provider": enum(*PROVIDERS), "minutes": integer(0, 100_000)},
    "hero_failed": {
        "step": enum(*get_all_step_names()),
        "provider": enum(*PROVIDERS),
        "code": enum(*step_errors.CODES),
    },
    "class_created": {},
    "class_joined": {},
}

EVENTS: Dict[str, Dict[str, tuple]] = {**BROWSER_EVENTS, **SERVER_EVENTS}

# Which provider a pipeline step calls, as packs_config prices it.
STEP_PROVIDER = {name: provider for name, (provider, _op) in packs_config.STEP_PROVIDER_COST.items()}
# The provider that makes the 3D hero: what "which provider" means for a hero.
HERO_PROVIDER = STEP_PROVIDER.get("meshy_3d", pricing.PROVIDER_MESHY)

MAX_BATCH = 50
MAX_BODY_BYTES = 32_000
# How far back a browser may date an event it queued (seconds).
MAX_AGO = 3600


class Rejected(ValueError):
    """The batch itself is unusable (who sent it, not what is in it)."""


def clean_value(spec: tuple, value: Any) -> Any:
    """`value` if it fits `spec`; raises ValueError otherwise."""
    kind = spec[0]
    if kind == ENUM:
        if isinstance(value, str) and value in spec[1]:
            return value
    elif kind == INT:
        # bool is an int in Python; it is not one here.
        if isinstance(value, int) and not isinstance(value, bool) and spec[1] <= value <= spec[2]:
            return value
    elif kind == BOOL:
        if isinstance(value, bool):
            return value
    elif kind == SLUG:
        if isinstance(value, str) and SLUG_RE.match(value):
            return value
    raise ValueError("not allowed")


def clean_props(schema: Dict[str, Dict[str, tuple]], name: str, props: Any) -> Dict[str, Any]:
    """The event's properties, checked against the allow-list.

    Raises ValueError for an unknown event, an unknown property, or a value of
    the wrong kind. Nothing is trimmed into shape: a property that does not fit
    means the event is not stored at all.
    """
    if name not in schema:
        raise ValueError(f"unknown event {name!r}")
    if props is None:
        props = {}
    if not isinstance(props, dict):
        raise ValueError("props must be an object")
    allowed = schema[name]
    out = {}
    for key, value in props.items():
        if key not in allowed:
            raise ValueError(f"{name}: property {key!r} is not allowed")
        out[key] = clean_value(allowed[key], value)
    return out


def clean_door(raw: Any) -> Optional[str]:
    """A door tag, or None for "direct". Raises ValueError if it is not a slug."""
    if raw is None or raw == "" or raw == "direct":
        return None
    if isinstance(raw, str) and SLUG_RE.match(raw):
        return raw
    raise ValueError("door must be a short tag: a-z, 0-9, - and _")


def class_door(class_id: str) -> str:
    """The door of everyone who comes in through one class's link or code."""
    return "class-" + re.sub(r"[^a-z0-9]", "", str(class_id).lower())[:8]


# ---------------------------------------------------------------------------
# Throttle: in-process, like the class throttles (one backend process today).
# ---------------------------------------------------------------------------

class _Budget:
    """At most `limit` events in any `seconds`, all visitors together."""

    def __init__(self, limit: int, seconds: float):
        self.limit, self.seconds = limit, seconds
        self._hits: deque = deque()
        self._lock = threading.Lock()

    def take(self, n: int) -> int:
        """How many of `n` events may be stored now."""
        now = time.monotonic()
        with self._lock:
            while self._hits and now - self._hits[0][0] > self.seconds:
                self._hits.popleft()
            used = sum(count for _t, count in self._hits)
            granted = max(0, min(n, self.limit - used))
            if granted:
                self._hits.append((now, granted))
            return granted

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


# A flood from one page must not fill the database: 6000 events a minute is
# far above anything a campaign's real visitors produce.
budget = _Budget(limit=6000, seconds=60)


# ---------------------------------------------------------------------------
# Browser events
# ---------------------------------------------------------------------------

def record_browser(db: Session, payload: Any, user: Optional[User] = None) -> Dict[str, int]:
    """Store one batch from a browser. Returns {"accepted": n, "rejected": m}.

    The batch is refused whole (Rejected) when it does not say who it is from
    in the allowed shape. Inside a usable batch, each event stands alone: one
    that is not on the allow-list is dropped and counted, the rest are stored.
    """
    if not enabled():
        # The client stops sending for this page when it reads "off".
        return {"accepted": 0, "rejected": 0, "off": True}
    if not isinstance(payload, dict):
        raise Rejected("body must be an object")
    unknown = set(payload) - {"visitor", "door", "device", "robot", "events"}
    if unknown:
        raise Rejected(f"unknown field {sorted(unknown)[0]!r}")
    visitor = payload.get("visitor")
    if not isinstance(visitor, str) or not VISITOR_RE.match(visitor):
        raise Rejected("visitor must be a random id")
    try:
        door = clean_door(payload.get("door"))
    except ValueError as exc:
        raise Rejected(str(exc))
    device = payload.get("device")
    if device is not None and device not in DEVICES:
        raise Rejected("device must be phone or desktop")
    robot = payload.get("robot", False)
    if not isinstance(robot, bool):
        raise Rejected("robot must be true or false")
    events = payload.get("events")
    if not isinstance(events, list) or len(events) > MAX_BATCH:
        raise Rejected(f"events must be a list of at most {MAX_BATCH}")

    is_robot = robot or bool(user and is_test_account(user.username, user.email))
    now = datetime.utcnow()
    rows = []
    rejected = 0
    for item in events:
        try:
            if not isinstance(item, dict) or set(item) - {"name", "props", "ago"}:
                raise ValueError("unknown event field")
            name = item.get("name")
            props = clean_props(BROWSER_EVENTS, name, item.get("props"))
            ago = item.get("ago", 0)
            if not isinstance(ago, int) or isinstance(ago, bool) or ago < 0:
                raise ValueError("ago must be seconds")
        except ValueError:
            rejected += 1
            continue
        rows.append(AnalyticsEvent(
            created_at=now - timedelta(seconds=min(ago, MAX_AGO)),
            name=name, visitor_id=visitor, user_id=user.id if user else None,
            door=door, device=device, is_robot=is_robot, source="browser", props=props,
        ))

    granted = budget.take(len(rows))
    if granted < len(rows):
        logger.warning("analytics: over budget, dropped %s events", len(rows) - granted)
        rejected += len(rows) - granted
        rows = rows[:granted]
    if rows:
        db.add_all(rows)
        db.commit()
    return {"accepted": len(rows), "rejected": rejected}


def visitor_events(db: Session, visitor: str, limit: int = 200) -> List[dict]:
    """What is stored for one visitor id, oldest first: for a browser (or the
    staging robot) to check its own events arrived. Names only, no ids."""
    if not isinstance(visitor, str) or not VISITOR_RE.match(visitor):
        raise Rejected("visitor must be a random id")
    rows = (
        db.query(AnalyticsEvent)
        .filter(AnalyticsEvent.visitor_id == visitor)
        .order_by(AnalyticsEvent.created_at.desc(), AnalyticsEvent.id.desc())
        .limit(limit).all()
    )
    return [
        {"name": r.name, "props": r.props or {}, "door": r.door, "device": r.device,
         "robot": bool(r.is_robot), "source": r.source, "signed_in": r.user_id is not None}
        for r in reversed(rows)
    ]


# ---------------------------------------------------------------------------
# Server events
# ---------------------------------------------------------------------------

def _seen_as(db: Session, *, user_id: Optional[str] = None, visitor_id: Optional[str] = None) -> Optional[AnalyticsEvent]:
    """The latest browser event of this account, or of this visitor."""
    query = db.query(AnalyticsEvent).filter(AnalyticsEvent.source == "browser")
    if visitor_id:
        query = query.filter(AnalyticsEvent.visitor_id == visitor_id)
    elif user_id:
        query = query.filter(AnalyticsEvent.user_id == user_id, AnalyticsEvent.visitor_id.isnot(None))
    else:
        return None
    return query.order_by(AnalyticsEvent.created_at.desc(), AnalyticsEvent.id.desc()).first()


def _first_door(db: Session, visitor_id: str) -> Optional[str]:
    row = (
        db.query(AnalyticsEvent.door)
        .filter(AnalyticsEvent.visitor_id == visitor_id, AnalyticsEvent.door.isnot(None))
        .order_by(AnalyticsEvent.created_at.asc(), AnalyticsEvent.id.asc()).first()
    )
    return row[0] if row else None


def record_server(
    db: Session,
    name: str,
    props: Optional[dict] = None,
    *,
    user_id: Optional[str] = None,
    visitor_id: Optional[str] = None,
    ref: Optional[str] = None,
    door: Optional[str] = None,
    once: bool = False,
) -> Optional[AnalyticsEvent]:
    """Write one event the backend itself witnessed. Never raises.

    The event joins the visitor this account was last seen on (or the given
    `visitor_id`), and takes that visitor's door and device, so a purchase
    lands in the same funnel as the visit that led to it. `door` is used only
    when that visitor has none of their own.

    `once` with a `ref`: the same thing reported twice (a redelivered webhook,
    a hero finished again after a retry) is one event.

    Call it after the caller's own commit: it commits (or rolls back) `db`.
    """
    if not enabled():
        return None
    try:
        props = clean_props(SERVER_EVENTS, name, props)
        if once and ref and db.query(AnalyticsEvent.id).filter(
            AnalyticsEvent.name == name, AnalyticsEvent.ref == ref
        ).first():
            return None
        if visitor_id is not None and not (isinstance(visitor_id, str) and VISITOR_RE.match(visitor_id)):
            visitor_id = None

        seen = _seen_as(db, user_id=user_id, visitor_id=visitor_id)
        is_robot = bool(seen and seen.is_robot)
        if user_id:
            user = db.query(User).filter(User.id == user_id).first()
            is_robot = is_robot or bool(user and is_test_account(user.username, user.email))
        if seen is not None:
            visitor_id = seen.visitor_id
        own_door = _first_door(db, visitor_id) if visitor_id else None

        event = AnalyticsEvent(
            created_at=datetime.utcnow(), name=name, visitor_id=visitor_id, user_id=user_id,
            door=own_door or clean_door(door), device=seen.device if seen else None,
            is_robot=is_robot, source="server", props=props, ref=ref,
        )
        db.add(event)
        db.commit()
        return event
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        logger.exception("analytics: could not record %s", name)
        return None


def _hero_subject(db: Session, creation_id: str) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """(user_id, visitor_id, door) of the person a hero is being made for.

    A class student has no account: their hero belongs to the class's wallet,
    and the browser that joined the class is found through `class_joined`.
    """
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if creation is None:
        return None, None, None
    guest = db.query(ClassGuest).filter(ClassGuest.creation_id == creation_id).first()
    if guest is not None:
        joined = (
            db.query(AnalyticsEvent)
            .filter(AnalyticsEvent.name == "class_joined", AnalyticsEvent.ref == guest.id)
            .order_by(AnalyticsEvent.id.desc()).first()
        )
        return None, (joined.visitor_id if joined else None), class_door(guest.class_id)
    return creation.user_id, None, None


def hero_ready(db: Session, creation_id: str, mock: bool = False) -> None:
    """The last pipeline step of a hero has completed. Once per hero. Never raises."""
    if not enabled():
        return
    try:
        first = (
            db.query(CreationStep.started_at)
            .filter(CreationStep.creation_id == creation_id, CreationStep.started_at.isnot(None))
            .order_by(CreationStep.started_at.asc()).first()
        )
        minutes = 0
        if first and first[0]:
            minutes = max(0, round((datetime.utcnow() - first[0]).total_seconds() / 60))
        user_id, visitor_id, door = _hero_subject(db, creation_id)
    except Exception:
        logger.exception("analytics: could not read hero %s", creation_id)
        try:
            db.rollback()
        except Exception:
            pass
        return
    record_server(
        db, "hero_ready",
        {"provider": MOCK_PROVIDER if mock else HERO_PROVIDER, "minutes": min(minutes, 100_000)},
        user_id=user_id, visitor_id=visitor_id, door=door, ref=f"hero:{creation_id}", once=True,
    )


def hero_failed(db: Session, creation_id: str, step_name: str, code: Optional[str], mock: bool = False) -> None:
    """A step of a hero failed and it was not the user cancelling. Never raises."""
    if not enabled():
        return
    try:
        user_id, visitor_id, door = _hero_subject(db, creation_id)
    except Exception:
        logger.exception("analytics: could not read hero %s", creation_id)
        try:
            db.rollback()
        except Exception:
            pass
        return
    record_server(
        db, "hero_failed",
        {
            "step": step_name,
            "provider": MOCK_PROVIDER if mock else STEP_PROVIDER.get(step_name, pricing.PROVIDER_INTERNAL),
            "code": code if code in step_errors.CODES else step_errors.UNKNOWN,
        },
        user_id=user_id, visitor_id=visitor_id, door=door, ref=f"hero:{creation_id}",
    )


def is_last_step(step_name: str) -> bool:
    last = get_last_step()
    return bool(last and last["name"] == step_name)
