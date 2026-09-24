"""
Credit management service - the stable, public surface for credit balances.

This module used to mutate `user.credits` directly. It no longer does: every
balance change now goes through the append-only ledger in
`app/services/ledger.py`, which is atomic, audit-able and replay-safe.

The function names and signatures here are unchanged so that existing callers
(`app/services/pipeline.py`, `app/services/coupons.py`, the API layer) keep
working, but they are now thin wrappers. New code should prefer the ledger's own
vocabulary - `ledger.spend_credits`, `ledger.record_purchase`,
`ledger.refund_credits` - because those carry the context (creation_id,
external_ref) that makes the ledger worth having.
"""
import logging
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.services import ledger
from app.services.ledger import (  # re-exported for callers
    BalanceCheck,
    InsufficientCreditsError,
    LedgerError,
    UnknownUserError,
    get_ledger_balance,
    list_transactions,
    verify_all_balances,
    verify_user_balance,
)

logger = logging.getLogger(__name__)

__all__ = [
    "get_balance",
    "add_credits",
    "deduct_credits",
    "refund_last_step_charge",
    "get_ledger_balance",
    "verify_user_balance",
    "verify_all_balances",
    "list_transactions",
    "BalanceCheck",
    "InsufficientCreditsError",
    "LedgerError",
    "UnknownUserError",
]


def get_balance(user_id: str, db: Session) -> int:
    """Get current credit balance for a user (from the denormalised cache)."""
    return ledger.get_balance(user_id, db)


def add_credits(
    user_id: str,
    amount: int,
    db: Session,
    reason: str = None,
    external_ref: Optional[str] = None,
    creation_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> int:
    """
    Add credits to a user balance, writing a ledger row.

    `reason` keeps its old free-text shape for backward compatibility (callers
    pass things like "coupon:HERO-ABC123"). It is mapped onto one of the
    ledger's structured reasons and the original string is preserved in the
    transaction metadata, so nothing is lost.

    Returns:
        New credit balance.
    """
    if amount <= 0:
        raise ValueError("Amount must be positive")

    structured_reason, meta = _classify_reason(reason, default="admin_adjust")
    if metadata:
        meta.update(metadata)

    tx = ledger.post(
        db=db,
        user_id=user_id,
        delta=amount,
        reason=structured_reason,
        external_ref=external_ref,
        creation_id=creation_id,
        metadata=meta,
    )
    return tx.balance_after


def deduct_credits(
    user_id: str,
    amount: int,
    db: Session,
    reason: str = None,
    creation_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> int:
    """
    Deduct credits from a user balance, writing a ledger row.

    Atomic and impossible to overdraw - see app/services/ledger.py for how, and
    backend/tests/test_ledger_concurrency.py for the proof.

    Returns:
        New credit balance.

    Raises:
        InsufficientCreditsError (a ValueError): insufficient balance.
        UnknownUserError (a ValueError): no such user.
    """
    if amount <= 0:
        raise ValueError("Amount must be positive")

    meta = dict(metadata or {})
    if reason:
        meta.setdefault("legacy_reason", reason)
        # Pipeline passes "step:<name>"; pull the step out so cost and credit
        # spend can be joined on step_name in the margin report.
        if reason.startswith("step:"):
            meta.setdefault("step_name", reason.split(":", 1)[1])

    tx = ledger.spend_credits(
        user_id=user_id,
        amount=amount,
        db=db,
        creation_id=creation_id,
        metadata=meta,
    )
    return tx.balance_after


def _classify_reason(reason: Optional[str], default: str) -> tuple:
    """
    Map a legacy free-text reason onto a structured ledger reason.

    The original text is always kept in metadata under "legacy_reason" so no
    information is discarded by the mapping.
    """
    meta: Dict[str, Any] = {}
    if not reason:
        return default, meta

    meta["legacy_reason"] = reason
    lowered = reason.lower()
    if lowered.startswith("coupon"):
        return "coupon", meta
    if lowered.startswith("purchase") or lowered.startswith("payment"):
        return "purchase", meta
    if lowered.startswith("signup") or lowered.startswith("registration"):
        return "signup_grant", meta
    if lowered.startswith("refund"):
        return "refund", meta
    return default, meta


def refund_last_step_charge(
    db: Session,
    creation_id: str,
    step_name: str,
    note: str,
) -> Optional["ledger.CreditTransaction"]:
    """
    Give back the credits charged for a pipeline step we failed to deliver.

    `app/services/pipeline.py` charges for a step BEFORE calling the provider, so
    a provider error, or a timeout, leaves the user paying for a hero they never
    received. This is the compensating entry for exactly that case.

    Idempotent, and keyed on the SPEND ROW rather than on (creation, step):
    a spend is deliberately not idempotent (ledger.spend_credits takes no
    external_ref, because a retried step really does cost again, and
    pipeline._reset_step lets a failed step be retried). Keying the refund on
    "refund:{creation_id}:{step_name}" would therefore refund the first failure
    and silently swallow every later one - a user who retries twice would pay
    twice and be refunded once. One refund per spend row is the correct grain,
    and `external_ref` being UNIQUE still makes a redelivery a no-op.

    Returns the refund transaction, or None when there is nothing to refund
    (the step was never charged) or it has already been refunded.

    NEVER RAISES. This runs inside a failure handler; a problem refunding must
    not mask the provider error that caused it, and must not turn a failed step
    into a 500. It logs loudly instead - the same discipline as
    `app/api/payments.py:_record_payment`.
    """
    try:
        # Few rows per creation (one per step, plus retries), so filter the
        # step out in Python rather than reaching into the JSON column, which
        # SQLite and Postgres spell differently.
        spends = (
            db.query(ledger.CreditTransaction)
            .filter(
                ledger.CreditTransaction.creation_id == creation_id,
                ledger.CreditTransaction.reason == "spend",
            )
            .order_by(
                ledger.CreditTransaction.created_at.desc(),
                ledger.CreditTransaction.id.desc(),
            )
            .all()
        )
        spend = next(
            (
                tx for tx in spends
                if (tx.metadata_json or {}).get("step_name") == step_name
            ),
            None,
        )
        if spend is None:
            # Never charged: a step that failed before the deduction (missing
            # input, unmet dependency, insufficient credits) owes nothing back.
            return None

        external_ref = f"refund:tx:{spend.id}"
        existing = ledger.find_by_external_ref(external_ref, db)
        if existing is not None:
            logger.info(
                "[%s] Step %s charge %s was already refunded as %s",
                creation_id, step_name, spend.id, existing.id,
            )
            return existing

        tx = ledger.refund_credits(
            user_id=spend.user_id,
            amount=abs(spend.delta),
            db=db,
            creation_id=creation_id,
            external_ref=external_ref,
            metadata={
                "step_name": step_name,
                "refunded_tx": spend.id,
                "note": note,
            },
        )
        logger.info(
            "[%s] Refunded %s credits for failed step %s (balance now %s)",
            creation_id, abs(spend.delta), step_name, tx.balance_after,
        )
        return tx
    except Exception:  # pragma: no cover - defensive; see docstring
        logger.exception(
            "[%s] Could not refund the charge for failed step %s; the user is "
            "out of pocket until this is reconciled",
            creation_id, step_name,
        )
        try:
            db.rollback()
        except Exception:
            pass
        return None
