"""Credit management service for user balances."""
import logging
from sqlalchemy.orm import Session
from app.models import User

logger = logging.getLogger(__name__)


def get_balance(user_id: str, db: Session) -> int:
    """Get current credit balance for a user."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise ValueError(f"User {user_id} not found")
    return user.credits


def add_credits(user_id: str, amount: int, db: Session, reason: str = None) -> int:
    """Add credits to user balance.

    Args:
        user_id: The user's ID
        amount: Number of credits to add (must be positive)
        db: Database session
        reason: Optional reason for the addition (for logging)

    Returns:
        New credit balance
    """
    if amount <= 0:
        raise ValueError("Amount must be positive")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise ValueError(f"User {user_id} not found")

    old_balance = user.credits
    user.credits += amount
    db.commit()
    db.refresh(user)

    logger.info(f"Added {amount} credits to user {user_id} ({reason or 'no reason'}): {old_balance} -> {user.credits}")
    return user.credits


def deduct_credits(user_id: str, amount: int, db: Session, reason: str = None) -> int:
    """Deduct credits from user balance.

    Args:
        user_id: The user's ID
        amount: Number of credits to deduct (must be positive)
        db: Database session
        reason: Optional reason for the deduction (for logging)

    Returns:
        New credit balance

    Raises:
        ValueError: If user not found or insufficient balance
    """
    if amount <= 0:
        raise ValueError("Amount must be positive")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise ValueError(f"User {user_id} not found")

    if user.credits < amount:
        raise ValueError(f"Insufficient credits. Have {user.credits}, need {amount}")

    old_balance = user.credits
    user.credits -= amount
    db.commit()
    db.refresh(user)

    logger.info(f"Deducted {amount} credits from user {user_id} ({reason or 'no reason'}): {old_balance} -> {user.credits}")
    return user.credits
