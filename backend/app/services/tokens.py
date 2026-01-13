"""Token management service for user balances."""
import logging
from sqlalchemy.orm import Session
from app.models import User

logger = logging.getLogger(__name__)


def get_balance(user_id: str, db: Session) -> int:
    """Get current token balance for a user."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise ValueError(f"User {user_id} not found")
    return user.tokens


def add_tokens(user_id: str, amount: int, db: Session, reason: str = None) -> int:
    """Add tokens to user balance.

    Args:
        user_id: The user's ID
        amount: Number of tokens to add (must be positive)
        db: Database session
        reason: Optional reason for the addition (for logging)

    Returns:
        New token balance
    """
    if amount <= 0:
        raise ValueError("Amount must be positive")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise ValueError(f"User {user_id} not found")

    old_balance = user.tokens
    user.tokens += amount
    db.commit()
    db.refresh(user)

    logger.info(f"Added {amount} tokens to user {user_id} ({reason or 'no reason'}): {old_balance} -> {user.tokens}")
    return user.tokens


def deduct_tokens(user_id: str, amount: int, db: Session, reason: str = None) -> int:
    """Deduct tokens from user balance.

    Args:
        user_id: The user's ID
        amount: Number of tokens to deduct (must be positive)
        db: Database session
        reason: Optional reason for the deduction (for logging)

    Returns:
        New token balance

    Raises:
        ValueError: If user not found or insufficient balance
    """
    if amount <= 0:
        raise ValueError("Amount must be positive")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise ValueError(f"User {user_id} not found")

    if user.tokens < amount:
        raise ValueError(f"Insufficient tokens. Have {user.tokens}, need {amount}")

    old_balance = user.tokens
    user.tokens -= amount
    db.commit()
    db.refresh(user)

    logger.info(f"Deducted {amount} tokens from user {user_id} ({reason or 'no reason'}): {old_balance} -> {user.tokens}")
    return user.tokens
