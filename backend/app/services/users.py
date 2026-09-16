"""User management service functions."""
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models import User, Creation
from app.services import ledger


def list_users_with_stats(db: Session) -> List[Dict[str, Any]]:
    """
    List all users with creation statistics.
    Returns users with counts of completed/failed/in-progress creations.
    """
    users = db.query(User).order_by(User.created_at.desc()).all()
    
    result = []
    for user in users:
        # Count creations by status
        creations = user.creations or []
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
    
    db.commit()
    db.refresh(user)
    return user


def delete_user(user_id: str, db: Session) -> bool:
    """
    Delete a user and all their creations.
    Returns True if deleted, False if user not found.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return False
    
    db.delete(user)
    db.commit()
    return True
