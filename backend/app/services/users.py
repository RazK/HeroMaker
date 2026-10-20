"""User management service functions."""
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models import User, Creation
from app.services import ledger
from app.services.account_kinds import is_test_account, sql_is_test_account


def live_users(db: Session):
    """Accounts that still exist. A deleted account is an anonymous row kept
    only for its payments and ledger (see account_deletion), never a user.
    Nor is a class's wallet (kind "class_wallet", app/services/classes.py):
    it holds a class's prepaid seats and can never sign in."""
    return db.query(User).filter(User.deleted_at.is_(None), User.kind == "person")


def count_users(db: Session) -> Dict[str, int]:
    """Live accounts, split into real ones and test ones (see account_kinds)."""
    total = live_users(db).count()
    test = live_users(db).filter(sql_is_test_account()).count()
    return {"users": total - test, "test_accounts": test}


def list_users_with_stats(db: Session, include_test: bool = True) -> List[Dict[str, Any]]:
    """
    List all live users with creation statistics.
    Returns users with counts of completed/failed/in-progress creations.
    With include_test=False, test accounts (robot_*, @example.com) are left out.
    """
    query = live_users(db)
    if not include_test:
        query = query.filter(~sql_is_test_account())
    users = query.order_by(User.created_at.desc()).all()
    
    result = []
    for user in users:
        # Count creations by status. A deleted hero, or one an admin removed
        # (app/services/moderation.py), is not one of their heroes any more;
        # nor is one never started (Creation.never_started), which was
        # counted as "making" while nothing ran.
        creations = [c for c in (user.creations or []) if c.deleted_at is None and not c.never_started]
        stats = {
            "completed": 0,
            "failed": 0,
            "in_progress": 0,
        }
        for creation in creations:
            status = creation.status
            if status == "completed":
                stats["completed"] += 1
            elif status == "failed":
                stats["failed"] += 1
            else:  # pending or processing
                stats["in_progress"] += 1
        
        result.append({
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "name": user.name,
            "date_of_birth": user.date_of_birth,
            "credits": user.credits,
            "is_admin": user.is_admin,
            "created_at": user.created_at,
            "creation_stats": stats,
            "is_test_account": is_test_account(user.username, user.email),
        })
    
    return result


def update_user(
    user_id: str,
    db: Session,
    credits: Optional[int] = None,
    is_admin: Optional[bool] = None,
    name: Optional[str] = None,
    username: Optional[str] = None,
    email: Optional[str] = None,
    date_of_birth: Optional[Any] = None,
    password_hash: Optional[str] = None,
    is_teacher: Optional[bool] = None,
) -> Optional[User]:
    """
    Update a user's fields.
    Only updates fields that are explicitly provided (not None).
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return None
    
    if credits is not None and int(credits) != int(user.credits or 0):
        # An admin setting a balance is a credit movement like any other, so it
        # goes through the ledger rather than overwriting the column. Writing
        # `user.credits = n` directly would silently desynchronise the cache
        # from the ledger and make the balance unauditable again - exactly the
        # bug the ledger exists to remove.
        #
        # `allow_negative=True`: an admin may deliberately set a balance lower
        # than what has already been spent (a clawback). The ledger records it
        # as an explicit admin_adjust with the before/after in metadata, so the
        # anomaly is visible instead of impossible.
        target = int(credits)
        previous = int(user.credits or 0)
        ledger.post(
            db=db,
            user_id=user_id,
            delta=target - previous,
            reason="admin_adjust",
            metadata={
                "source": "admin.update_user",
                "previous_balance": previous,
                "requested_balance": target,
            },
            allow_negative=True,
        )
        db.refresh(user)
    if is_admin is not None:
        user.is_admin = is_admin
    if name is not None:
        user.name = name
    if username is not None:
        user.username = username
    if email is not None:
        user.email = email
    if date_of_birth is not None:
        user.date_of_birth = date_of_birth
    if password_hash is not None:
        user.password_hash = password_hash
    if is_teacher is not None:
        user.is_teacher = is_teacher
    
    db.commit()
    db.refresh(user)
    return user


# Deleting an account: app/services/account_deletion.py, used by both the
# person themselves and the admin console. A plain db.delete(user) cannot work:
# payments and the credit ledger hold NOT NULL references to the row.
