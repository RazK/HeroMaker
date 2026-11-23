"""The painting free, once per account: pay after the reveal (E-006).

Off unless FREE_PAINTING is on (Raz decides; it gives a painting away to
everyone who has not bought yet, at about $0.17 each).

When on, an account that has never bought anything may start a hero with no
credits. Its painting step (`openai_render`) is paid for by a one-time grant
of exactly that step's credits, made just before the step charges them. The
grant's ledger row carries `external_ref = free-painting:<user id>`, which the
ledger keeps unique, so the cap holds under any race: a second hero, a second
tab or a retried request gets nothing more.

Nothing else changes. The steps after the painting charge as always, so the
pipeline stops at `meshy_3d` with NOT_ENOUGH_CREDITS: that is the pause where
the parent, having seen the painting, is asked to pay ("Bring it to life"),
and the existing retry picks up from there once they have.
"""
from __future__ import annotations

import logging
import os

from sqlalchemy.orm import Session

from app.models import CreditTransaction

logger = logging.getLogger(__name__)

STEP = "openai_render"
REASON = "coupon"  # a promotional grant, in the margin report's terms


def enabled() -> bool:
    return os.getenv("FREE_PAINTING", "").strip().lower() in ("1", "true", "on", "yes")


def _ref(user_id: str) -> str:
    return f"free-painting:{user_id}"


def _has_bought(db: Session, user_id: str) -> bool:
    return db.query(CreditTransaction.id).filter(
        CreditTransaction.user_id == user_id, CreditTransaction.reason == "purchase",
    ).first() is not None


def _used(db: Session, user_id: str) -> bool:
    return db.query(CreditTransaction.id).filter(
        CreditTransaction.external_ref == _ref(user_id),
    ).first() is not None


def eligible(db: Session, user_id: str) -> bool:
    """This account may still see a painting before paying anything."""
    return enabled() and not _has_bought(db, user_id) and not _used(db, user_id)


def grant_if_due(db: Session, user_id: str, creation_id: str, cost: int) -> bool:
    """Before the painting step charges: give its credits if this is the free one.

    Only when the account cannot pay for the step itself, so an account with
    credits (a class seat, a gift, a coupon) spends its own as always.
    True if credits were granted now.
    """
    from app.services.credits import get_balance
    from app.services.ledger import grant_credits

    if cost <= 0 or not eligible(db, user_id) or get_balance(user_id, db) >= cost:
        return False
    row = grant_credits(
        user_id, cost, db, reason=REASON, external_ref=_ref(user_id), creation_id=creation_id,
        metadata={"offer": "free_painting", "step": STEP},
    )
    granted = row.creation_id == creation_id and row.delta == cost
    if granted:
        logger.info(f"[{creation_id}] Free painting: granted {cost} credits for {STEP}")
    return granted
