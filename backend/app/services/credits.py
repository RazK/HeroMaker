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
