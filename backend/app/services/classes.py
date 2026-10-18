"""
Classes: a teacher pays for seats up front; students without accounts make one
hero each in a live session; a parent can claim a child's hero.

Product definition, and the reasoning behind every rule here:
docs/product/class-sessions.md. The short version:

* PAID UP FRONT, THROUGH THE LEDGER. Creating a class moves `seats x hero cost`
  credits from the teacher to the class's own wallet account (a User of kind
  "class_wallet"). Two "class_seats" ledger rows, one each side.
* THE CLASS PAYS THROUGH THE REAL PIPELINE. A student's hero is an ordinary
  Creation owned by the wallet, so `pipeline.execute_step` charges each step
  to the wallet and refunds it on failure, exactly as for any hero. Nothing is
  re-implemented.
* COST IS BOUNDED BY THE SERVER, NOT BY DEVICES. `_take_seat` is one atomic
  conditional UPDATE: a class can never start more heroes than it has seats,
  and only while one of its sessions is open.
* ONE HERO PER PASS. Joining gives the browser a random pass (we keep its
  sha256); the same kind of UPDATE on the guest row lets it start one hero.
* A SECOND STUDENT ON THE SAME BROWSER WAITS FOR THE TEACHER. The browser holds
  a second random marker. No device fingerprinting, no IP limits.
* UNUSED SEATS STAY ON THE CLASS for its next session.
* A PARENT CLAIMS A HERO: `claim` moves it (row and files) into the parent's
  account, first name and age included. Ledger rows stay where they are.
* NOTHING EXPIRES. A class hero is kept like any hero, and goes with the
  teacher's account if the teacher deletes it (account_deletion.py).
"""
import base64
import hashlib
import hmac
import json
import logging
import secrets
import threading
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta
from typing import Callable, Dict, List, Optional, Tuple

from sqlalchemy import and_, update
from sqlalchemy.orm import Session

from app.config.packs import creation_credit_price
from app.config.settings import get_jwt_secret_key
from app.config.steps import get_all_step_names
from app.models import ClassGuest, ClassRoom, ClassSession, Creation, User
from app.services import ledger
from app.utils.storage import OPT_PREFIX, THUMB_PREFIX, get_storage

logger = logging.getLogger(__name__)
funnel_logger = logging.getLogger("class_funnel")

PIN_LENGTH = 6
MIN_SEATS, MAX_SEATS = 1, 60
SESSION_MINUTES = (15, 30, 45, 60, 90)
MAX_EXTEND_MINUTES = 60
NAME_MAX = 20
WALLET_KIND = "class_wallet"

GUEST_COOKIE = "hm_class_pass"
DEVICE_COOKIE = "hm_class_device"
GUEST_HEADER = "X-Class-Pass"
DEVICE_HEADER = "X-Class-Device"


class ClassError(Exception):
    """A refusal the API turns into `status` with `message` as its detail."""

    def __init__(self, status: int, message: str, code: str = ""):
        super().__init__(message)
        self.status = status
        self.message = message
        self.code = code


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def hero_cost() -> int:
    """Credits one seat costs: a full pipeline run."""
    return creation_credit_price()


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(32)


def funnel(event: str, **fields) -> None:
    """One structured line per funnel event (docs/product/class-sessions.md)."""
    funnel_logger.info(json.dumps({"event": event, **fields}, default=str, sort_keys=True))


def session_is_open(session: Optional[ClassSession], now: Optional[datetime] = None) -> bool:
    now = now or datetime.utcnow()
    return session is not None and session.status == "open" and now < session.ends_at


def clean_first_name(raw: Optional[str]) -> str:
    """A first name as a child types it: trimmed, letters only, any script."""
    name = " ".join((raw or "").split())[:NAME_MAX].strip()
    if not name:
        raise ClassError(400, "Type your first name", "name_required")
    if not all(ch.isalpha() or ch in " -'’" for ch in name):
        raise ClassError(400, "Just your first name, with letters", "name_letters")
    return name


def clean_age(raw) -> Optional[int]:
    if raw in (None, ""):
        return None
    try:
        age = int(raw)
    except (TypeError, ValueError):
        raise ClassError(400, "Age is a number", "age_number")
    if not 3 <= age <= 14:
        raise ClassError(400, "Age is from 3 to 14", "age_range")
    return age


def clean_title(raw: Optional[str]) -> str:
    title = " ".join((raw or "").split())[:60].strip()
    if not title:
        raise ClassError(400, "Give the class a name", "title_required")
    return title


# ---------------------------------------------------------------------------
# Throttles: in-process sliding windows (one backend process today).
# ---------------------------------------------------------------------------

class SlidingWindow:
    def __init__(self, limit: int, seconds: float):
        self.limit = limit
        self.seconds = seconds
        self._hits: Dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def _trim(self, q: deque, now: float) -> None:
        while q and now - q[0] > self.seconds:
            q.popleft()

    def blocked(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            self._trim(q, now)
            return len(q) >= self.limit

    def hit(self, key: str) -> bool:
        """Record one hit. False if the key was already at its limit."""
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            self._trim(q, now)
            if len(q) >= self.limit:
                return False
            q.append(now)
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


# Wrong PINs from one browser (keyed by its marker).
pin_failures = SlidingWindow(limit=8, seconds=600)
# Wrong PINs from browsers with no marker yet, all together.
anonymous_pin_failures = SlidingWindow(limit=120, seconds=60)
# Joins into one session: a class of 30 joins in a minute or two.
session_joins = SlidingWindow(limit=60, seconds=60)


def reset_throttles() -> None:
    for w in (pin_failures, anonymous_pin_failures, session_joins):
        w.reset()


# ---------------------------------------------------------------------------
# Teacher: become one, create and pay for a class, add seats
# ---------------------------------------------------------------------------

def _transfer(db: Session, src: str, dst: str, credits: int, class_id: str, note: str) -> None:
    """Move credits teacher -> class wallet through the ledger: two rows.

    The debit goes first: it is the one that can fail (InsufficientCreditsError)
    and then nothing has moved. If the credit then fails, the debit is undone
    with a refund, so the teacher is never out of pocket.
    """
    batch = uuid.uuid4().hex
    meta = {"class_id": class_id, "note": note, "batch": batch}
    ledger.post(db=db, user_id=src, delta=-credits, reason="class_seats",
                external_ref=f"class:{class_id}:{batch}:out", metadata=meta)
    try:
        ledger.post(db=db, user_id=dst, delta=credits, reason="class_seats",
                    external_ref=f"class:{class_id}:{batch}:in", metadata=meta)
    except Exception:
        db.rollback()
        ledger.refund_credits(user_id=src, amount=credits, db=db, external_ref=f"class:{class_id}:{batch}:undo",
                              metadata={**meta, "note": "class wallet credit failed; seats not bought"})
        raise


def _need_credits(db: Session, teacher: User, seats: int) -> int:
    need = hero_cost() * seats
    have = ledger.get_balance(teacher.id, db)
    if have < need:
        raise ClassError(402, f"You need {need} credits for {seats} heroes. You have {have}.", "insufficient_credits")
    return need


def create_class(db: Session, teacher: User, title: str, seats: int) -> ClassRoom:
    """A class with `seats` paid for now, from the teacher's credits."""
    title = clean_title(title)
    seats = int(seats)
    if not MIN_SEATS <= seats <= MAX_SEATS:
        raise ClassError(400, f"A class has {MIN_SEATS} to {MAX_SEATS} students", "seats_range")
    need = _need_credits(db, teacher, seats)

    wallet = User(
        username=f"class-wallet-{uuid.uuid4().hex[:16]}", email=None, name=title,
        credits=0, kind=WALLET_KIND,
    )
    db.add(wallet)
    db.flush()
    classroom = ClassRoom(owner_id=teacher.id, wallet_user_id=wallet.id, title=title, seats=0, seats_used=0)
    db.add(classroom)
    if not teacher.is_teacher:
        teacher.is_teacher = True
    db.commit()
    db.refresh(classroom)
    try:
        _transfer(db, teacher.id, wallet.id, need, classroom.id, f"{seats} seats")
    except ledger.InsufficientCreditsError:
        raise ClassError(402, "You need more credits for this class.", "insufficient_credits")
    classroom.seats = seats
    db.commit()
    db.refresh(classroom)
    funnel("class_created", class_id=classroom.id, teacher=teacher.id, seats=seats, credits=need)
    return classroom


def add_seats(db: Session, classroom: ClassRoom, teacher: User, seats: int) -> ClassRoom:
    seats = int(seats)
    if seats < 1 or classroom.seats + seats > MAX_SEATS:
        raise ClassError(400, f"A class has up to {MAX_SEATS} students", "seats_range")
    need = _need_credits(db, teacher, seats)
    try:
        _transfer(db, teacher.id, classroom.wallet_user_id, need, classroom.id, f"+{seats} seats")
    except ledger.InsufficientCreditsError:
        raise ClassError(402, "You need more credits for these seats.", "insufficient_credits")
    db.execute(update(ClassRoom).where(ClassRoom.id == classroom.id).values(seats=ClassRoom.seats + seats))
    db.commit()
    db.refresh(classroom)
    funnel("class_seats_added", class_id=classroom.id, seats=seats, credits=need)
    return classroom


def owned_class(db: Session, user: User, class_id: str) -> ClassRoom:
    classroom = db.query(ClassRoom).filter(ClassRoom.id == class_id).first()
    if classroom is None or (classroom.owner_id != user.id and not user.is_admin):
        raise ClassError(404, "Class not found", "not_found")
    return classroom


def live_session(db: Session, classroom: ClassRoom, now: Optional[datetime] = None) -> Optional[ClassSession]:
    now = now or datetime.utcnow()
    return (
        db.query(ClassSession)
        .filter(ClassSession.class_id == classroom.id, ClassSession.status == "open", ClassSession.ends_at > now)
        .order_by(ClassSession.created_at.desc())
        .first()
    )


# ---------------------------------------------------------------------------
# Teacher: start, extend and end a session; approve and block students
# ---------------------------------------------------------------------------

def _new_pin(db: Session, now: datetime) -> str:
    """Six digits, not used by any session that is open right now."""
    for _ in range(50):
        pin = "".join(secrets.choice("0123456789") for _ in range(PIN_LENGTH))
        clash = db.query(ClassSession.id).filter(
            ClassSession.pin == pin, ClassSession.status == "open", ClassSession.ends_at > now,
        ).first()
        if clash is None:
            return pin
    raise ClassError(503, "Could not make a class code right now. Try again.", "pin_exhausted")


def start_session(db: Session, classroom: ClassRoom, minutes: int, approve_first: bool = False,
                  now: Optional[datetime] = None) -> ClassSession:
    now = now or datetime.utcnow()
    if int(minutes) not in SESSION_MINUTES:
        raise ClassError(400, "Pick how long the class is", "minutes")
    if live_session(db, classroom, now) is not None:
        raise ClassError(409, "This class is already live", "already_live")
    if classroom.seats_used >= classroom.seats:
        raise ClassError(409, "Every seat has a hero. Add seats to start again.", "no_seats")
    session = ClassSession(
        class_id=classroom.id, pin=_new_pin(db, now), starts_at=now,
        ends_at=now + timedelta(minutes=int(minutes)), approve_first=bool(approve_first), status="open",
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    funnel("session_started", class_id=classroom.id, session=session.id, minutes=int(minutes),
           approve_first=session.approve_first, seats_left=classroom.seats - classroom.seats_used)
    return session


def end_session(db: Session, session: ClassSession, now: Optional[datetime] = None) -> ClassSession:
    now = now or datetime.utcnow()
    if session.status == "open":
        session.status = "ended"
        session.ended_at = now
        if session.ends_at > now:
            session.ends_at = now
        db.commit()
        funnel("session_ended", class_id=session.class_id, session=session.id)
    return session


def extend_session(db: Session, session: ClassSession, minutes: int, now: Optional[datetime] = None) -> ClassSession:
    now = now or datetime.utcnow()
    if not session_is_open(session, now):
        raise ClassError(409, "This class has ended", "ended")
    if not 1 <= int(minutes) <= MAX_EXTEND_MINUTES:
        raise ClassError(400, f"Add 1 to {MAX_EXTEND_MINUTES} minutes", "extend_range")
    session.ends_at = session.ends_at + timedelta(minutes=int(minutes))
    db.commit()
    return session


def set_guest_status(db: Session, classroom: ClassRoom, guest_id: str, status: str) -> ClassGuest:
    if status not in ("approved", "blocked"):
        raise ClassError(400, "Unknown status", "status")
    guest = db.query(ClassGuest).filter(ClassGuest.id == guest_id, ClassGuest.class_id == classroom.id).first()
    if guest is None:
        raise ClassError(404, "Student not found", "not_found")
    guest.status = status
    db.commit()
    funnel("student_" + status, class_id=classroom.id, guest=guest.id)
    return guest


# ---------------------------------------------------------------------------
# Student: find the class, join, make one hero
# ---------------------------------------------------------------------------

def find_open_by_pin(db: Session, pin: str, device_token: Optional[str],
                     now: Optional[datetime] = None) -> ClassSession:
    """The open session with this PIN, behind the wrong-PIN throttles."""
    now = now or datetime.utcnow()
    key = sha256(device_token) if device_token else None
    if (key and pin_failures.blocked(key)) or (not key and anonymous_pin_failures.blocked("all")):
        raise ClassError(429, "Too many tries. Wait a minute and try again.", "throttled")

    digits = "".join(ch for ch in (pin or "") if ch.isdigit())
    session = None
    if len(digits) == PIN_LENGTH:
        session = (
            db.query(ClassSession)
            .filter(ClassSession.pin == digits, ClassSession.status == "open", ClassSession.ends_at > now)
            .order_by(ClassSession.created_at.desc())
            .first()
        )
    if session is None:
        if key:
            pin_failures.hit(key)
        else:
            anonymous_pin_failures.hit("all")
        raise ClassError(404, "No class with that code. Check the numbers.", "no_class")
    return session


def guest_by_token(db: Session, token: Optional[str]) -> Optional[ClassGuest]:
    if not token:
        return None
    return db.query(ClassGuest).filter(ClassGuest.token_hash == sha256(token)).first()


def join(db: Session, session: ClassSession, first_name: str, age, device_token: Optional[str],
         guest_token: Optional[str], now: Optional[datetime] = None) -> Tuple[ClassGuest, Optional[str], str]:
    """Join `session`. Returns (guest, new pass or None, browser marker).

    The browser coming back with its pass gets the same student: no new pass,
    no new seat. A second student on a browser that already joined this class
    waits for the teacher (shared tablets); with approve_first everyone waits.
    """
    now = now or datetime.utcnow()
    existing = guest_by_token(db, guest_token)
    if existing is not None and existing.class_id == session.class_id:
        return existing, None, device_token or new_token()

    name = clean_first_name(first_name)
    age = clean_age(age)
    if not session_is_open(session, now):
        raise ClassError(410, "Class time is over", "ended")
    if not session_joins.hit(session.id):
        raise ClassError(429, "Lots of friends joining! Try again in a moment.", "busy")

    device_token = device_token or new_token()
    device_hash = sha256(device_token)
    shared = db.query(ClassGuest.id).filter(
        ClassGuest.class_id == session.class_id, ClassGuest.device_hash == device_hash,
    ).first() is not None
    status = "waiting" if (session.approve_first or shared) else "approved"

    token = new_token()
    guest = ClassGuest(
        class_id=session.class_id, session_id=session.id, first_name=name, age=age, token_hash=sha256(token),
        device_hash=device_hash, shared_device=shared, status=status, created_at=now,
    )
    db.add(guest)
    db.commit()
    db.refresh(guest)
    funnel("student_joined", class_id=session.class_id, session=session.id, guest=guest.id,
           shared_device=shared, status=status, has_age=age is not None)
    return guest, token, device_token


def current_session_for(db: Session, guest: ClassGuest, now: Optional[datetime] = None) -> Optional[ClassSession]:
    """The class's open session, if any: a pass from last week's session works
    in this week's, as long as it has not made its hero."""
    return live_session(db, guest.classroom, now)


def check_can_make(db: Session, guest: ClassGuest, now: Optional[datetime] = None) -> ClassSession:
    """Every reason this student cannot start a hero now, as a ClassError."""
    now = now or datetime.utcnow()
    if guest.hero_started_at is not None:
        raise ClassError(409, "You already made your hero!", "already_made")
    session = current_session_for(db, guest, now)
    if session is None:
        raise ClassError(410, "Class time is over", "ended")
    if guest.status == "blocked":
        raise ClassError(403, "Ask your teacher", "blocked")
    if guest.status == "waiting":
        raise ClassError(409, "Wait for your teacher to say yes", "waiting")
    classroom = guest.classroom
    if classroom.seats_used >= classroom.seats:
        raise ClassError(409, "All the class heroes are made!", "class_full")
    if ledger.get_balance(classroom.wallet_user_id, db) < hero_cost():
        raise ClassError(402, "Ask your teacher to add seats", "class_credits")
    return session


def _take_seat(db: Session, guest: ClassGuest, now: datetime) -> None:
    """The two atomic guards. Raises ClassError if either is already spent."""
    took_hero = db.execute(
        update(ClassGuest)
        .where(and_(ClassGuest.id == guest.id, ClassGuest.hero_started_at.is_(None)))
        .values(hero_started_at=now)
    ).rowcount
    if took_hero != 1:
        db.rollback()
        raise ClassError(409, "You already made your hero!", "already_made")
    took_seat = db.execute(
        update(ClassRoom)
        .where(and_(ClassRoom.id == guest.class_id, ClassRoom.seats_used < ClassRoom.seats))
        .values(seats_used=ClassRoom.seats_used + 1)
    ).rowcount
    if took_seat != 1:
        db.rollback()
        raise ClassError(409, "All the class heroes are made!", "class_full")
    db.commit()


def _give_back_seat(db: Session, class_id: str, guest_id: str) -> None:
    """Undo _take_seat when the hero could not be created at all."""
    db.rollback()
    db.execute(update(ClassGuest).where(ClassGuest.id == guest_id).values(hero_started_at=None, creation_id=None))
    db.execute(
        update(ClassRoom)
        .where(and_(ClassRoom.id == class_id, ClassRoom.seats_used > 0))
        .values(seats_used=ClassRoom.seats_used - 1)
    )
    db.commit()


def start_guest_hero(db: Session, guest: ClassGuest, create: Callable[[ClassRoom], Creation],
                     now: Optional[datetime] = None) -> Creation:
    """Spend the student's pass and one class seat, then `create(classroom)`.

    `create` makes the Creation (the API passes creations.create_with_drawing,
    owned by the class wallet). If it fails, the seat and the pass are given
    back: nothing was made or charged.
    """
    now = now or datetime.utcnow()
    session = check_can_make(db, guest, now)
    class_id, guest_id, session_id = guest.class_id, guest.id, session.id
    _take_seat(db, guest, now)
    try:
        creation = create(db.query(ClassRoom).filter(ClassRoom.id == class_id).one())
    except Exception:
        _give_back_seat(db, class_id, guest_id)
        raise
    guest = db.query(ClassGuest).filter(ClassGuest.id == guest_id).one()
    guest.creation_id = creation.id
    guest.claim_hash = sha256(claim_token(guest.id))
    db.commit()
    funnel("hero_started", class_id=class_id, session=session_id, guest=guest_id, creation=creation.id)
    return creation


# ---------------------------------------------------------------------------
# Parent: the claim link
# ---------------------------------------------------------------------------

def claim_token(guest_id: str) -> str:
    """The parent link's token: 192 bits, derived so it can be shown again.

    HMAC of the guest id under the app's secret; only its sha256 is stored, to
    look it up. Rotating JWT_SECRET_KEY invalidates links not yet used.
    """
    mac = hmac.new(get_jwt_secret_key().encode(), f"class-claim:{guest_id}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac[:24]).decode().rstrip("=")


def guest_by_claim(db: Session, token: str) -> ClassGuest:
    guest = None
    if token:
        guest = db.query(ClassGuest).filter(ClassGuest.claim_hash == sha256(token)).first()
    if guest is None or guest.creation_id is None:
        raise ClassError(404, "This link does not work any more", "no_claim")
    return guest


def claim(db: Session, guest: ClassGuest, parent: User, now: Optional[datetime] = None) -> Creation:
    """Move the student's hero into `parent`'s account: the row and its files.

    The child's first name and age are the hero's `name` and `age`, so they
    travel with it. Its ledger rows stay with the class that paid.
    """
    now = now or datetime.utcnow()
    creation = db.query(Creation).filter(Creation.id == guest.creation_id, Creation.deleted_at.is_(None)).first()
    if creation is None:
        raise ClassError(404, "This hero was deleted", "deleted")
    if guest.claimed_by is not None:
        if guest.claimed_by == parent.id:
            return creation
        raise ClassError(409, "Someone already kept this hero", "claimed")
    if creation.status != "completed":
        raise ClassError(409, "The hero is still being made. Try again in a few minutes.", "not_ready")

    old_owner = creation.user_id
    storage = get_storage()
    copied = 0
    for name in storage.list_files(old_owner, creation.id):
        # Thumbnails and optimised copies are rebuilt on first request.
        if name.startswith(THUMB_PREFIX) or name.startswith(OPT_PREFIX):
            continue
        storage.upload_file(parent.id, creation.id, name, storage.download_file(old_owner, creation.id, name))
        copied += 1

    creation.user_id = parent.id
    creation.class_id = None
    creation.name = guest.first_name
    creation.age = guest.age
    guest.claimed_by = parent.id
    guest.claimed_at = now
    db.commit()

    for name in storage.list_files(old_owner, creation.id):
        try:
            storage.delete_file(old_owner, creation.id, name)
        except Exception:
            logger.warning("[%s] claim: could not remove %s from the class's files", creation.id, name)
    funnel("hero_claimed", class_id=guest.class_id, guest=guest.id, creation=creation.id, parent=parent.id,
           files=copied)
    return creation


# ---------------------------------------------------------------------------
# Account deletion (app/services/account_deletion.py calls this first)
# ---------------------------------------------------------------------------

def detach_for_account_deletion(db: Session, user: User, creation_ids: List[str]) -> List[User]:
    """Prepare `user`'s class data for deletion. Returns their classes' wallets,
    which the caller deletes like accounts (their unclaimed heroes with them).

    * As a parent: the guest rows pointing at their heroes let go of them.
    * As a teacher: their classes' students (names and passes) and sessions
      are deleted; heroes parents have already claimed are the parents' and
      stay. The classes themselves go once the wallets are deleted.
    """
    if creation_ids:
        db.query(ClassGuest).filter(ClassGuest.creation_id.in_(creation_ids)).update(
            {ClassGuest.creation_id: None}, synchronize_session=False)
    classes = db.query(ClassRoom).filter(ClassRoom.owner_id == user.id).all()
    wallets = []
    for classroom in classes:
        db.query(ClassGuest).filter(ClassGuest.class_id == classroom.id).delete(synchronize_session=False)
        db.query(ClassSession).filter(ClassSession.class_id == classroom.id).delete(synchronize_session=False)
        wallet = db.query(User).filter(User.id == classroom.wallet_user_id).first()
        if wallet is not None:
            wallets.append(wallet)
    db.commit()
    return wallets


def delete_classes_of(db: Session, user: User) -> None:
    db.query(ClassRoom).filter(ClassRoom.owner_id == user.id).delete(synchronize_session=False)
    db.commit()


# ---------------------------------------------------------------------------
# What the screens show
# ---------------------------------------------------------------------------

def hero_view(creation: Optional[Creation]) -> Optional[dict]:
    if creation is None or creation.deleted_at is not None:
        return None
    state = {"completed": "ready", "failed": "failed"}.get(creation.status, "making")
    steps = {s.step_name: s for s in creation.steps}
    order = get_all_step_names()
    current = next((n for n in order if n in steps and steps[n].status == "processing"), None) \
        or next((n for n in order if n in steps and steps[n].status == "failed"), None)
    done = sum(1 for n in order if n in steps and steps[n].status == "completed")
    return {
        "creation_id": creation.id,
        "user_id": creation.user_id,
        "character_name": creation.character_name,
        "state": state,
        "step": current,
        "steps_done": done,
        "steps_total": len(order),
    }


def session_view(session: Optional[ClassSession], now: Optional[datetime] = None) -> Optional[dict]:
    if session is None:
        return None
    now = now or datetime.utcnow()
    open_ = session_is_open(session, now)
    return {
        "id": session.id,
        "pin": session.pin,
        "join_path": f"/join/{session.pin}",
        "starts_at": session.starts_at.isoformat(),
        "ends_at": session.ends_at.isoformat(),
        "seconds_left": max(0, int((session.ends_at - now).total_seconds())) if open_ else 0,
        "open": open_,
        "approve_first": session.approve_first,
    }


def roster(db: Session, classroom: ClassRoom) -> List[dict]:
    """Every student of the class, in the order they joined, with their hero."""
    guests = (db.query(ClassGuest).filter(ClassGuest.class_id == classroom.id)
              .order_by(ClassGuest.created_at.asc()).all())
    ids = [g.creation_id for g in guests if g.creation_id]
    creations = {c.id: c for c in db.query(Creation).filter(Creation.id.in_(ids)).all()} if ids else {}
    seen: Dict[str, int] = defaultdict(int)
    out = []
    for g in guests:
        seen[g.first_name.lower()] += 1
        n = seen[g.first_name.lower()]
        out.append({
            "id": g.id,
            "first_name": g.first_name,
            "label": g.first_name if n == 1 else f"{g.first_name} {n}",
            "age": g.age,
            "status": g.status,
            "shared_device": g.shared_device,
            "session_id": g.session_id,
            "claimed": g.claimed_by is not None,
            "hero": hero_view(creations.get(g.creation_id)) if g.creation_id else None,
            "joined_at": g.created_at.isoformat(),
        })
    return out


def class_view(db: Session, classroom: ClassRoom, now: Optional[datetime] = None,
               with_roster: bool = False) -> dict:
    now = now or datetime.utcnow()
    view = {
        "id": classroom.id,
        "title": classroom.title,
        "seats": classroom.seats,
        "seats_used": classroom.seats_used,
        "seats_left": max(0, classroom.seats - classroom.seats_used),
        "hero_cost": hero_cost(),
        "created_at": classroom.created_at.isoformat(),
        "live": session_view(live_session(db, classroom, now), now),
        "sessions": len(classroom.sessions),
    }
    r = roster(db, classroom)
    view["heroes_ready"] = sum(1 for g in r if g["hero"] and g["hero"]["state"] == "ready")
    # A few finished heroes for the class card on the teacher's home.
    view["preview"] = [
        {"creation_id": g["hero"]["creation_id"], "user_id": g["hero"]["user_id"], "label": g["label"]}
        for g in r if g["hero"] and g["hero"]["state"] == "ready"
    ][:5]
    if with_roster:
        view["roster"] = r
    return view


def stage_manifest(db: Session, classroom: ClassRoom) -> List[dict]:
    """The class stage's input (claude/proto-hero-class): every finished hero.

    Same-origin relative URLs and the optimised VRM, as the hero page loads
    them (frontend/src/config/play.ts).
    """
    out = []
    for item in roster(db, classroom):
        hero = item["hero"]
        if not hero or hero["state"] != "ready":
            continue
        base = f"/api/files/{hero['user_id']}/{hero['creation_id']}"
        out.append({
            "name": item["label"],
            "age": item["age"],
            "heroName": hero["character_name"],
            "creationId": hero["creation_id"],
            "vrmUrl": f"{base}/opt_avatar.vrm",
            "renderUrl": f"{base}/rendered.png",
        })
    return out


def guest_view(db: Session, guest: ClassGuest, now: Optional[datetime] = None) -> dict:
    now = now or datetime.utcnow()
    creation = db.query(Creation).filter(Creation.id == guest.creation_id).first() if guest.creation_id else None
    hero = hero_view(creation)
    session = current_session_for(db, guest, now)
    reason = None
    try:
        check_can_make(db, guest, now)
        can_make = True
    except ClassError as e:
        can_make, reason = False, e.code
    return {
        "guest": {"id": guest.id, "first_name": guest.first_name, "age": guest.age, "status": guest.status},
        "class": {"id": guest.class_id, "title": guest.classroom.title,
                  "open": session is not None,
                  "seconds_left": session_view(session, now)["seconds_left"] if session else 0},
        "hero": hero,
        "can_make": can_make,
        "reason": reason,
        "claim_path": f"/claim/{claim_token(guest.id)}" if hero else None,
        "claimed": guest.claimed_by is not None,
    }
