"""
Deleting a whole account, as the privacy policy promises:

    "You can delete any hero, or your whole account, from the app at any time.
    It's removed immediately [...] except purchase records, which we keep as
    required by law."

What happens, table by table:

    creations, creation_steps   DELETED, every one, including heroes the person
                                had already deleted (those rows were only marked).
    stored files                DELETED: everything under the user's prefix, so
                                every creation's files and their thumb_/opt_ copies.
    password_reset_tokens       DELETED.
    users                       KEPT AS AN ANONYMOUS ROW. payments.user_id and
                                credit_transactions.user_id are NOT NULL foreign
                                keys to it and those records are kept for tax.
                                Email, Google id, name, date of birth, password
                                and admin flag are cleared; the username becomes
                                a random "deleted-..." placeholder; deleted_at is
                                set, and get_current_user refuses its tokens. The
                                email and Google account are free to sign up again.
    payments                    KEPT, unchanged: date, provider, provider order id,
                                gross/fee/net, status, pack, credits, order number,
                                currency. It holds no email or name; its user_id
                                now names only the anonymous row.
    credit_transactions         KEPT (the ledger is append-only and is the receipt
                                history). creation_id is cleared, because the
                                creation no longer exists. The remaining balance
                                is forfeited with one "account_deleted" row, so
                                sum(delta) == users.credits still holds.
    usage_events                KEPT for provider cost, with user_id and
                                creation_id cleared.
    coupon_redemptions          KEPT, pointing at the anonymous row, so a coupon's
                                use count still adds up.
"""
import logging
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import (
    Creation,
    CreationStep,
    CreditTransaction,
    PasswordResetToken,
    UsageEvent,
    User,
)
from app.services import ledger
from app.utils.storage import get_storage

logger = logging.getLogger(__name__)


def delete_account(db: Session, user: User, task_manager: Optional[object] = None) -> None:
    """Delete ``user``'s account now. Raises if their files could not be removed,
    before anything in the database has changed, so the request can be retried."""
    user_id = user.id
    creation_ids = [row[0] for row in db.query(Creation.id).filter(Creation.user_id == user_id).all()]

    # 1. Stop anything still making a hero, so nothing writes after we delete.
    if task_manager is not None:
        for creation_id in creation_ids:
            try:
                task_manager.cancel_all_tasks_for_creation(creation_id)
            except Exception as e:  # never let a stuck task keep an account alive
                logger.warning("[%s] Could not cancel tasks before account deletion: %s", creation_id, e)

    # 2. Files first: if storage fails, nothing else has happened yet.
    removed = get_storage().delete_user_files(user_id)

    # 3. The database, in one transaction.
    if creation_ids:
        db.query(CreditTransaction).filter(CreditTransaction.creation_id.in_(creation_ids)).update(
            {CreditTransaction.creation_id: None}, synchronize_session=False
        )
    usage_filter = UsageEvent.user_id == user_id
    if creation_ids:
        usage_filter = or_(usage_filter, UsageEvent.creation_id.in_(creation_ids))
    db.query(UsageEvent).filter(usage_filter).update(
        {UsageEvent.user_id: None, UsageEvent.creation_id: None}, synchronize_session=False
    )
    if creation_ids:
        db.query(CreationStep).filter(CreationStep.creation_id.in_(creation_ids)).delete(synchronize_session=False)
        db.query(Creation).filter(Creation.id.in_(creation_ids)).delete(synchronize_session=False)
    db.query(PasswordResetToken).filter(PasswordResetToken.user_id == user_id).delete(synchronize_session=False)

    user.username = f"deleted-{uuid.uuid4().hex[:12]}"
    user.email = None
    user.google_id = None
    user.name = None
    user.date_of_birth = None
    user.password_hash = None
    user.is_admin = False
    user.deleted_at = datetime.utcnow()
    db.commit()

    # 4. Forfeit the balance through the ledger, the only writer of balances.
    # After the commit above the account is already gone; a failure here only
    # leaves a stale number on a row nobody can sign in to.
    db.refresh(user)
    balance = int(user.credits or 0)
    if balance > 0:
        try:
            ledger.post(
                db=db, user_id=user_id, delta=-balance, reason="account_deleted",
                metadata={"source": "auth.delete_me"},
            )
        except Exception:
            db.rollback()
            logger.exception("Account %s deleted but its %s credits were not forfeited", user_id, balance)

    logger.info("Deleted account %s: %d creations, %d files", user_id, len(creation_ids), removed)
