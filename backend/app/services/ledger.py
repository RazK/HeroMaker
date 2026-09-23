"""
Append-only credit ledger.

WHY THIS EXISTS
---------------
`users.credits` used to be a mutable integer. A mutable integer is a balance
with no history:

* you cannot audit it - "why do I have 7 credits" has no answer;
* a double-fired payment webhook silently doubles it;
* two concurrent spends read the same balance and both succeed, so a user with
  10 credits can spend 15.

This module replaces the mutation with an append-only ledger. `users.credits`
stays as a denormalised cache updated inside the same database transaction, so
every existing read path (`GET /api/auth/me`, the admin user list, the pipeline's
pre-flight check) keeps working untouched.

THE TWO GUARANTEES, AND HOW THEY ARE ENFORCED
---------------------------------------------
1. A balance can never go negative, however many spends race each other.

   Enforced by doing the debit as ONE conditional statement:

       UPDATE users SET credits = credits + :delta
        WHERE id = :uid AND credits + :delta >= 0

   The database evaluates the predicate and applies the change under the same
   row lock, so there is no window between "check" and "apply" for another
   transaction to slip into. rowcount == 0 means the predicate failed, i.e.
   insufficient funds - never a partial write.

   On Postgres we additionally take an explicit `SELECT ... FOR UPDATE` on the
   user row first, which serialises concurrent spenders on the row rather than
   letting them collide and retry. `FOR UPDATE` is silently a no-op on SQLite,
   which is exactly why the conditional UPDATE - and not the lock - is what
   carries the guarantee. Both databases are safe; only one of them is safe
   *because of the lock*.

   tests/test_ledger_concurrency.py fires N concurrent spends at one balance and
   asserts it cannot be overdrawn. The same test run against the old
   read-modify-write code overdraws, and that failure is asserted too, so the
   guard is measured rather than claimed.

2. The same external event can never be credited twice.

   `credit_transactions.external_ref` is UNIQUE. A replayed payment webhook
   carrying the same provider order id hits the constraint; the whole
   transaction - the ledger row AND the balance update, which share one database
   transaction - rolls back, and the original row is returned instead. The
   caller sees the same result it saw the first time.
"""
import logging
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import func, text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.models import CREDIT_REASONS, CreditTransaction, User

logger = logging.getLogger(__name__)


class LedgerError(Exception):
    """Base class for ledger failures."""


# Subclasses ValueError on purpose: the pre-ledger credits service raised
# ValueError for "insufficient credits" and app/services/pipeline.py catches it
# that way. Narrowing the type without breaking those callers.
class InsufficientCreditsError(ValueError, LedgerError):
    """Raised when a spend would take a balance below zero."""

    def __init__(self, user_id: str, requested: int, available: int):
        self.user_id = user_id
        self.requested = requested
        self.available = available
        super().__init__(
            f"Insufficient credits. Have {available}, need {requested}"
        )


class UnknownUserError(ValueError, LedgerError):
    """Raised when the user does not exist."""


# SQLite serialises writers at the file level. Under genuine concurrency a
# writer can still lose the race to upgrade its lock and get SQLITE_BUSY, which
# is a transient condition, not a failure. Retry it. Postgres does not need
# this, but the code is identical either way.
_LOCK_RETRY_ATTEMPTS = 8
_LOCK_RETRY_BASE_SLEEP = 0.01  # seconds; doubles each attempt


def _is_transient_lock_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return (
        "database is locked" in msg
        or "database table is locked" in msg
        or "deadlock detected" in msg
        or "could not serialize" in msg
    )


def _is_postgres(db: Session) -> bool:
    try:
        return db.bind.dialect.name == "postgresql"
    except Exception:  # pragma: no cover - defensive
        return False


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------

def get_balance(user_id: str, db: Session) -> int:
    """
    Current balance from the denormalised cache on `users.credits`.

    This is the fast path every existing caller already uses. It is authoritative
    only insofar as the cache is consistent with the ledger - see
    verify_user_balance() for the check, which is cheap enough to run in a
    health endpoint.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise UnknownUserError(f"User {user_id} not found")
    return user.credits or 0


def get_ledger_balance(user_id: str, db: Session) -> int:
    """Balance computed from the ledger itself: SUM(delta). The truth."""
    total = db.query(func.coalesce(func.sum(CreditTransaction.delta), 0)).filter(
        CreditTransaction.user_id == user_id
    ).scalar()
    return int(total or 0)


@dataclass
class BalanceCheck:
    """Result of comparing the cached balance against the ledger."""
    user_id: str
    cached: int
    ledger: int

    @property
    def consistent(self) -> bool:
        return self.cached == self.ledger

    @property
    def drift(self) -> int:
        """cached - ledger. Non-zero means something wrote credits directly."""
        return self.cached - self.ledger

    def as_dict(self) -> Dict[str, Any]:
        return {
            "user_id": self.user_id,
            "cached": self.cached,
            "ledger": self.ledger,
            "drift": self.drift,
            "consistent": self.consistent,
        }


def verify_user_balance(user_id: str, db: Session) -> BalanceCheck:
    """Check that the cache on users.credits equals SUM(ledger.delta)."""
    return BalanceCheck(
        user_id=user_id,
        cached=get_balance(user_id, db),
        ledger=get_ledger_balance(user_id, db),
    )


def verify_all_balances(db: Session) -> List[BalanceCheck]:
    """
    Check every user's cache against the ledger. Returns ALL users, consistent
    or not, so the caller can report "N checked, M drifted" rather than only
    seeing the failures.
    """
    ledger_by_user = dict(
        db.query(
            CreditTransaction.user_id,
            func.coalesce(func.sum(CreditTransaction.delta), 0),
        ).group_by(CreditTransaction.user_id).all()
    )
    checks = []
    for user_id, cached in db.query(User.id, User.credits).all():
        checks.append(
            BalanceCheck(
                user_id=user_id,
                cached=int(cached or 0),
                ledger=int(ledger_by_user.get(user_id, 0) or 0),
            )
        )
    return checks


def list_transactions(
    user_id: str,
    db: Session,
    limit: int = 100,
    offset: int = 0,
) -> List[CreditTransaction]:
    """Ledger history for one user, newest first. This is the audit trail."""
    return (
        db.query(CreditTransaction)
        .filter(CreditTransaction.user_id == user_id)
        .order_by(CreditTransaction.created_at.desc(), CreditTransaction.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


def find_by_external_ref(external_ref: str, db: Session) -> Optional[CreditTransaction]:
    """The replay lookup: has this external event already been credited?"""
    if not external_ref:
        return None
    return (
        db.query(CreditTransaction)
        .filter(CreditTransaction.external_ref == external_ref)
        .first()
    )


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------

def post(
    db: Session,
    user_id: str,
    delta: int,
    reason: str,
    external_ref: Optional[str] = None,
    creation_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    allow_negative: bool = False,
) -> CreditTransaction:
    """
    Append one movement to the ledger and update the cached balance atomically.

    This is the ONLY function in the codebase that may change a credit balance.

    Args:
        delta: signed. Positive credits, negative debits. Zero is rejected -
            a ledger row that moves nothing is noise.
        reason: one of app.models.CREDIT_REASONS.
        external_ref: idempotency key from the causing system. If a row with
            this ref already exists, that row is returned and NOTHING is
            written. This is what makes payment webhooks replay-safe.
        allow_negative: escape hatch for admin corrections that legitimately
            need to push a balance below zero (e.g. clawing back credits already
            spent). Off by default; a spend must never set it.

    Returns:
        The CreditTransaction row - either the new one, or the pre-existing one
        if `external_ref` had already been used.

    Raises:
        InsufficientCreditsError: the debit would take the balance below zero.
        UnknownUserError: no such user.
        ValueError: bad delta or unknown reason.
    """
    delta = int(delta)
    if delta == 0:
        raise ValueError("delta must be non-zero")
    if reason not in CREDIT_REASONS:
        raise ValueError(f"Unknown credit reason {reason!r}; expected one of {CREDIT_REASONS}")

    last_error: Optional[BaseException] = None

    for attempt in range(_LOCK_RETRY_ATTEMPTS):
        try:
            return _post_once(
                db=db,
                user_id=user_id,
                delta=delta,
                reason=reason,
                external_ref=external_ref,
                creation_id=creation_id,
                metadata=metadata,
                allow_negative=allow_negative,
            )
        except OperationalError as exc:
            db.rollback()
            if not _is_transient_lock_error(exc) or attempt == _LOCK_RETRY_ATTEMPTS - 1:
                raise
            last_error = exc
            time.sleep(_LOCK_RETRY_BASE_SLEEP * (2 ** attempt))

    raise LedgerError(f"Ledger write gave up after lock contention: {last_error}")


def _post_once(
    db: Session,
    user_id: str,
    delta: int,
    reason: str,
    external_ref: Optional[str],
    creation_id: Optional[str],
    metadata: Optional[Dict[str, Any]],
    allow_negative: bool,
) -> CreditTransaction:
    """One attempt at posting. Everything here is a single DB transaction."""

    # ---- 1. Replay check, cheap path -------------------------------------
    # The UNIQUE constraint is the real defence; this lookup just avoids paying
    # for a rolled-back transaction in the common case.
    if external_ref:
        existing = find_by_external_ref(external_ref, db)
        if existing is not None:
            logger.info(
                "Ledger: external_ref %s already applied as tx %s (delta=%s); "
                "ignoring replay",
                external_ref, existing.id, existing.delta,
            )
            return existing

    # ---- 2. Lock the user row (Postgres) ---------------------------------
    # On Postgres this serialises concurrent writers on this user. On SQLite it
    # is skipped entirely: SQLite has no row locks, and the conditional UPDATE
    # below is what actually enforces the invariant on both databases.
    if _is_postgres(db):
        locked = db.execute(
            text("SELECT credits FROM users WHERE id = :uid FOR UPDATE"),
            {"uid": user_id},
        ).first()
        if locked is None:
            raise UnknownUserError(f"User {user_id} not found")

    # ---- 3. Conditional, atomic balance update ---------------------------
    # Predicate and mutation in one statement: no read-modify-write window.
    if allow_negative:
        stmt = text(
            "UPDATE users SET credits = COALESCE(credits, 0) + :delta "
            "WHERE id = :uid"
        )
    else:
        stmt = text(
            "UPDATE users SET credits = COALESCE(credits, 0) + :delta "
            "WHERE id = :uid AND COALESCE(credits, 0) + :delta >= 0"
        )
    result = db.execute(stmt, {"delta": delta, "uid": user_id})

    if result.rowcount == 0:
        # Either the user does not exist, or the predicate failed. Distinguish,
        # because "insufficient credits" and "no such user" are very different
        # bugs and a caller must be able to tell them apart.
        current = db.execute(
            text("SELECT credits FROM users WHERE id = :uid"), {"uid": user_id}
        ).first()
        db.rollback()
        if current is None:
            raise UnknownUserError(f"User {user_id} not found")
        available = int(current[0] or 0)
        raise InsufficientCreditsError(
            user_id=user_id, requested=abs(delta), available=available
        )

    # ---- 4. Read the post-update balance INSIDE the same transaction -----
    # Safe because step 3 took (Postgres) or holds (SQLite write lock) the lock
    # until commit, so nobody else can move this balance underneath us.
    balance_after = int(
        db.execute(
            text("SELECT credits FROM users WHERE id = :uid"), {"uid": user_id}
        ).scalar()
        or 0
    )

    # ---- 5. Append the ledger row ----------------------------------------
    tx = CreditTransaction(
        user_id=user_id,
        delta=delta,
        reason=reason,
        external_ref=external_ref or None,
        creation_id=creation_id,
        balance_after=balance_after,
        metadata_json=dict(metadata or {}),
        created_at=datetime.utcnow(),
    )
    db.add(tx)

    try:
        # Flush before commit so a UNIQUE violation on external_ref surfaces
        # here, deterministically, rather than somewhere inside commit().
        db.flush()
        db.commit()
    except IntegrityError:
        # Two concurrent deliveries of the same webhook. The loser rolls back
        # BOTH the ledger row and the balance update - they are one transaction -
        # and returns the winner's row. The user is credited exactly once.
        db.rollback()
        existing = find_by_external_ref(external_ref, db) if external_ref else None
        if existing is not None:
            logger.warning(
                "Ledger: concurrent replay of external_ref %s; kept tx %s",
                external_ref, existing.id,
            )
            return existing
        raise

    # The ORM identity map may still hold a User loaded before the raw UPDATE.
    # Expire it so `user.credits` reads the value we just wrote.
    _expire_cached_user(db, user_id)

    logger.info(
        "Ledger: user=%s delta=%+d reason=%s balance_after=%d external_ref=%s creation=%s",
        user_id, delta, reason, balance_after, external_ref, creation_id,
    )
    return tx


def _expire_cached_user(db: Session, user_id: str) -> None:
    try:
        cached = db.get(User, user_id)
        if cached is not None:
            db.expire(cached)
    except Exception:  # pragma: no cover - never let cache hygiene break a write
        logger.debug("Could not expire cached User %s", user_id, exc_info=True)


# ---------------------------------------------------------------------------
# Convenience wrappers - the vocabulary callers should actually use
# ---------------------------------------------------------------------------

def grant_credits(
    user_id: str,
    amount: int,
    db: Session,
    reason: str = "admin_adjust",
    external_ref: Optional[str] = None,
    creation_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> CreditTransaction:
    """Add `amount` (positive) credits."""
    if amount <= 0:
        raise ValueError("Amount must be positive")
    return post(
        db=db, user_id=user_id, delta=amount, reason=reason,
        external_ref=external_ref, creation_id=creation_id, metadata=metadata,
    )


def spend_credits(
    user_id: str,
    amount: int,
    db: Session,
    creation_id: Optional[str] = None,
    step_name: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> CreditTransaction:
    """
    Debit `amount` (positive) credits. Cannot overdraw, ever.

    Deliberately takes no `external_ref`: a spend is not idempotent. Running a
    step twice really does cost twice, and pretending otherwise would hide the
    retry cost this whole system exists to measure.
    """
    if amount <= 0:
        raise ValueError("Amount must be positive")
    meta = dict(metadata or {})
    if step_name:
        meta.setdefault("step_name", step_name)
    return post(
        db=db, user_id=user_id, delta=-amount, reason="spend",
        creation_id=creation_id, metadata=meta,
    )


def refund_credits(
    user_id: str,
    amount: int,
    db: Session,
    creation_id: Optional[str] = None,
    external_ref: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> CreditTransaction:
    """Return `amount` (positive) credits, e.g. for a step we failed to deliver."""
    if amount <= 0:
        raise ValueError("Amount must be positive")
    return post(
        db=db, user_id=user_id, delta=amount, reason="refund",
        creation_id=creation_id, external_ref=external_ref, metadata=metadata,
    )


def record_purchase(
    user_id: str,
    amount: int,
    db: Session,
    external_ref: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> CreditTransaction:
    """
    Credit a paid purchase. `external_ref` is REQUIRED and is the payment
    provider's order id - that is what makes a replayed webhook a no-op.
    """
    if amount <= 0:
        raise ValueError("Amount must be positive")
    if not external_ref:
        raise ValueError(
            "record_purchase requires external_ref (the payment provider's order "
            "id); without it a replayed webhook would double-credit the user"
        )
    return post(
        db=db, user_id=user_id, delta=amount, reason="purchase",
        external_ref=external_ref, metadata=metadata,
    )
