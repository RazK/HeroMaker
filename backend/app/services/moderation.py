"""
Admin moderation: a user's page in the admin console, and what an admin can
do from it. Every action writes one row to the audit log (AdminAction).

REMOVING A HERO
---------------
A removal is a take-down, not a deletion. It sets `creations.deleted_at` (the
m009 soft delete), so the hero leaves every place that already skips deleted
heroes: the gallery, Editors' choice, the class pages and stage, Robot
Rumble's crowd (which reads Editors' choice) and its owner's own "My heroes".
Unlike a deletion its files are kept and the row is marked by a remove_hero
audit row, so it can be restored exactly as it was (Editors' choice included).

Its files stop being public too: /api/files answers 404 for a removed hero
(see `file_hidden`), except to an admin carrying the file pass cookie, which
the admin's user page hands out. That is what lets the admin still see the
greyed tile, and open the hero's page, while nobody else can.

What a removal cannot reach: a copy a browser already cached. Versioned
thumbnails are served `immutable` for a year, so a visitor who saw the hero
before keeps that copy until their cache drops it.

A hero its owner deleted (deleted_at set, no remove_hero row) is not
"removed": its files are gone and it cannot be restored.

CREDITS
-------
Given or taken back through the ledger (reason "admin_adjust", the one the
older "set credits" form already used), so sum(delta) == users.credits holds.
No Payment row is written, so it is never revenue: on the Money page granted
credits are part of "credits held", what serving them will cost. Taking back
never goes below zero. The ledger row and the audit row land in one
transaction (ledger.post's in_transaction), keyed by external_ref
"admin_action:<audit id>".
"""
import hashlib
import hmac
import logging
import time
import uuid
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session, selectinload

from app.models import (
    ADMIN_ACTIONS, REMOVAL_REASONS, AdminAction, ClassRoom, Creation, CreditTransaction, User,
)
from app.services import ledger

logger = logging.getLogger(__name__)

NOTE_MAX = 500
# One grant or take-back at most. A typo of an extra zero should not mint a
# thousand heroes' worth of credits.
CREDITS_MAX = 1000

HERO_ACTIONS = ("remove_hero", "restore_hero")


class ModerationError(Exception):
    """A refused action. `status` is the HTTP status the API answers with."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


# ---------------------------------------------------------------------------
# The audit log
# ---------------------------------------------------------------------------

def record(
    db: Session,
    *,
    admin_id: str,
    action: str,
    target_user_id: Optional[str] = None,
    creation_id: Optional[str] = None,
    reason: Optional[str] = None,
    note: Optional[str] = None,
    amount: Optional[int] = None,
    details: Optional[dict] = None,
    action_id: Optional[str] = None,
) -> AdminAction:
    """Add one audit row to the session. The caller commits, with its change."""
    if action not in ADMIN_ACTIONS:
        raise ValueError(f"Unknown admin action {action!r}")
    row = AdminAction(
        id=action_id or str(uuid.uuid4()),
        admin_id=admin_id,
        target_user_id=target_user_id,
        creation_id=creation_id,
        action=action,
        reason=reason,
        note=note or None,
        amount=amount,
        details=dict(details or {}),
        created_at=datetime.utcnow(),
    )
    db.add(row)
    return row


def audit_for_user(db: Session, user_id: str, limit: int = 100) -> List[AdminAction]:
    """What admins did to this account and its heroes, newest first."""
    return (
        db.query(AdminAction)
        .options(selectinload(AdminAction.admin))
        .filter(AdminAction.target_user_id == user_id)
        .order_by(AdminAction.created_at.desc(), AdminAction.id.desc())
        .limit(limit)
        .all()
    )


def action_view(a: AdminAction) -> dict:
    admin = a.admin
    return {
        "id": a.id,
        "action": a.action,
        "reason": a.reason,
        "note": a.note,
        "amount": a.amount,
        "creation_id": a.creation_id,
        "details": a.details or {},
        "created_at": a.created_at,
        "admin": {
            "id": a.admin_id,
            "username": admin.username if admin else None,
            "name": admin.name if admin else None,
        },
    }


def _clean_note(note: Optional[str]) -> str:
    note = (note or "").strip()
    if len(note) > NOTE_MAX:
        raise ModerationError(422, f"Keep the note under {NOTE_MAX} characters")
    return note


# ---------------------------------------------------------------------------
# Removing and restoring heroes
# ---------------------------------------------------------------------------

def last_hero_actions(db: Session, creation_ids: List[str]) -> Dict[str, AdminAction]:
    """The latest remove/restore row of each of these heroes that has one."""
    if not creation_ids:
        return {}
    rows = (
        db.query(AdminAction)
        .options(selectinload(AdminAction.admin))
        .filter(AdminAction.creation_id.in_(creation_ids), AdminAction.action.in_(HERO_ACTIONS))
        .order_by(AdminAction.created_at.asc(), AdminAction.id.asc())
        .all()
    )
    latest: Dict[str, AdminAction] = {}
    for r in rows:
        latest[r.creation_id] = r
    return latest


def removal_of(db: Session, creation: Creation) -> Optional[AdminAction]:
    """The remove_hero row that took this hero down, if an admin did."""
    if creation.deleted_at is None:
        return None
    last = last_hero_actions(db, [creation.id]).get(creation.id)
    return last if last is not None and last.action == "remove_hero" else None


def _hero_name(creation: Creation) -> Optional[str]:
    return creation.character_name or None


def _account_of(db: Session, creation: Creation) -> str:
    """Whose page the action shows on: the owner, or for a class hero (owned
    by the class's wallet, which nobody signs in to) the class's teacher."""
    if creation.class_id:
        owner = db.query(ClassRoom.owner_id).filter(ClassRoom.id == creation.class_id).scalar()
        if owner:
            return owner
    return creation.user_id


def remove_hero(
    db: Session,
    admin: User,
    creation_id: str,
    reason: str,
    note: Optional[str] = None,
    task_manager=None,
) -> AdminAction:
    if reason not in REMOVAL_REASONS:
        raise ModerationError(422, "Pick a reason")
    note = _clean_note(note)
    if reason == "other" and not note:
        raise ModerationError(422, "Say why in a note")

    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if creation is None:
        raise ModerationError(404, "Hero not found")
    if creation.deleted_at is not None:
        raise ModerationError(409, "This hero is already removed")

    # Anything still making it would only write files for a hero nobody sees.
    if task_manager is not None:
        try:
            task_manager.cancel_all_tasks_for_creation(creation_id)
        except Exception as e:  # never let a stuck task keep a hero up
            logger.warning("[%s] Could not cancel tasks before removal: %s", creation_id, e)

    # updated_at written back as it was: the gallery orders by it, and a
    # restored hero should come back where it was.
    db.query(Creation).filter(Creation.id == creation_id).update(
        {Creation.deleted_at: datetime.utcnow(), Creation.updated_at: Creation.updated_at},
        synchronize_session=False,
    )
    row = record(
        db, admin_id=admin.id, action="remove_hero", target_user_id=_account_of(db, creation),
        creation_id=creation_id, reason=reason, note=note,
        details={"hero_name": _hero_name(creation), "featured": bool(creation.featured)},
    )
    db.commit()
    db.refresh(row)
    logger.info("Admin %s removed hero %s (%s)", admin.id, creation_id, reason)
    return row


def restore_hero(db: Session, admin: User, creation_id: str, note: Optional[str] = None) -> AdminAction:
    note = _clean_note(note)
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if creation is None:
        raise ModerationError(404, "Hero not found")
    if creation.deleted_at is None:
        raise ModerationError(409, "This hero is not removed")
    if removal_of(db, creation) is None:
        # Deleted by its owner: the files are gone, there is nothing to bring back.
        raise ModerationError(409, "Its owner deleted this hero. It can’t be restored.")

    db.query(Creation).filter(Creation.id == creation_id).update(
        {Creation.deleted_at: None, Creation.updated_at: Creation.updated_at},
        synchronize_session=False,
    )
    row = record(
        db, admin_id=admin.id, action="restore_hero", target_user_id=_account_of(db, creation),
        creation_id=creation_id, note=note, details={"hero_name": _hero_name(creation)},
    )
    db.commit()
    db.refresh(row)
    logger.info("Admin %s restored hero %s", admin.id, creation_id)
    return row


# ---------------------------------------------------------------------------
# Credits
# ---------------------------------------------------------------------------

def change_credits(db: Session, admin: User, user_id: str, amount: int, note: Optional[str]) -> Tuple[CreditTransaction, AdminAction]:
    """Give (amount > 0) or take back (amount < 0) credits, with a note.

    One ledger row (admin_adjust) and one audit row, in one transaction.
    Taking back cannot go below zero: the ledger's own guard refuses it.
    """
    try:
        amount = int(amount)
    except (TypeError, ValueError):
        raise ModerationError(422, "Enter a whole number of credits")
    if amount == 0:
        raise ModerationError(422, "Enter a number of credits")
    if abs(amount) > CREDITS_MAX:
        raise ModerationError(422, f"At most {CREDITS_MAX} credits at a time")
    note = _clean_note(note)
    if not note:
        raise ModerationError(422, "Add a note: why")

    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None), User.kind == "person").first()
    if user is None:
        raise ModerationError(404, "User not found")

    action = "grant_credits" if amount > 0 else "take_credits"
    action_id = str(uuid.uuid4())

    def write_audit(s: Session) -> None:
        # Runs inside the ledger's transaction, after the balance moved and
        # under its lock, so the balance read here is the one it now holds.
        balance = int(s.execute(text("SELECT credits FROM users WHERE id = :uid"), {"uid": user_id}).scalar() or 0)
        record(
            s, admin_id=admin.id, action=action, target_user_id=user_id, note=note,
            amount=amount, details={"balance_after": balance}, action_id=action_id,
        )

    try:
        tx = ledger.post(
            db=db,
            user_id=user_id,
            delta=amount,
            reason="admin_adjust",
            external_ref=f"admin_action:{action_id}",
            metadata={
                "source": "admin.change_credits",
                "kind": "grant" if amount > 0 else "take_back",
                "admin_id": admin.id,
                "admin_action_id": action_id,
                "note": note,
            },
            in_transaction=write_audit,
        )
    except ledger.InsufficientCreditsError as e:
        raise ModerationError(409, f"They have {e.available} credits. You can take back up to that.")

    row = db.query(AdminAction).filter(AdminAction.id == action_id).one()
    logger.info("Admin %s %s %+d credits for %s", admin.id, action, amount, user_id)
    return tx, row


# ---------------------------------------------------------------------------
# A user's page
# ---------------------------------------------------------------------------

def user_heroes(db: Session, user: User) -> List[Tuple[Creation, Optional[AdminAction], Optional[str]]]:
    """Every hero of this account an admin may look at, newest first:
    live ones (in progress and failed too), and ones an admin removed. A
    teacher's class heroes (owned by each class's wallet) are included, with
    the class's title. Heroes their owner deleted are not.

    Returns (creation, removal row or None, class title or None).
    """
    classes = db.query(ClassRoom).filter(ClassRoom.owner_id == user.id).all()
    class_of_wallet = {c.wallet_user_id: c.title for c in classes}
    owners = [user.id, *class_of_wallet.keys()]
    creations = (
        db.query(Creation)
        .options(selectinload(Creation.steps), selectinload(Creation.user))
        .filter(Creation.user_id.in_(owners))
        .order_by(Creation.created_at.desc())
        .all()
    )
    deleted_ids = [c.id for c in creations if c.deleted_at is not None]
    last = last_hero_actions(db, deleted_ids)
    out = []
    for c in creations:
        removal = None
        if c.deleted_at is not None:
            removal = last.get(c.id)
            if removal is None or removal.action != "remove_hero":
                continue  # its owner deleted it
        out.append((c, removal, class_of_wallet.get(c.user_id)))
    return out


# ---------------------------------------------------------------------------
# The file pass: an admin may still see a removed hero's files
# ---------------------------------------------------------------------------

FILE_PASS_COOKIE = "hm_admin_files"
FILE_PASS_SECONDS = 12 * 3600


def _pass_key() -> bytes:
    # Derived from the JWT secret but never a JWT itself: the pass must not
    # work as a Bearer token, and verify_access_token does not check scopes.
    from app.config.settings import get_jwt_secret_key
    return hashlib.sha256(b"heromaker-admin-file-pass:" + get_jwt_secret_key().encode()).digest()


def _sign(admin_id: str, expires: int) -> str:
    return hmac.new(_pass_key(), f"{admin_id}.{expires}".encode(), hashlib.sha256).hexdigest()


def issue_file_pass(admin_id: str, now: Optional[float] = None) -> str:
    expires = int((now or time.time()) + FILE_PASS_SECONDS)
    return f"{admin_id}.{expires}.{_sign(admin_id, expires)}"


def file_pass_admin_id(value: Optional[str], now: Optional[float] = None) -> Optional[str]:
    """The admin a valid, unexpired pass names; None for anything else."""
    if not value or not isinstance(value, str):
        return None
    parts = value.rsplit(".", 2)
    if len(parts) != 3:
        return None
    admin_id, expires, sig = parts
    try:
        expires_at = int(expires)
    except ValueError:
        return None
    if expires_at < (now or time.time()):
        return None
    if not hmac.compare_digest(sig, _sign(admin_id, expires_at)):
        return None
    return admin_id


def file_hidden(creation_id: str, pass_value: Optional[str]) -> bool:
    """Should /api/files refuse this hero's files? Yes when the hero is
    removed (or deleted), unless the request carries a valid pass of an
    account that is still an admin. A path that names no hero in the database
    is left alone, as before. Opens its own session: the file endpoint has
    none."""
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        deleted_at = db.query(Creation.deleted_at).filter(Creation.id == creation_id).scalar()
        if deleted_at is None:
            return False
        admin_id = file_pass_admin_id(pass_value)
        if admin_id is None:
            return True
        is_admin = db.query(User.id).filter(
            User.id == admin_id, User.is_admin.is_(True), User.deleted_at.is_(None)
        ).first()
        return is_admin is None
    finally:
        db.close()
