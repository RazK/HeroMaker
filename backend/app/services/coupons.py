"""Coupon redemption service."""
import logging
from datetime import datetime
from sqlalchemy.orm import Session
from app.models import Coupon, CouponRedemption
from app.services.tokens import add_tokens

logger = logging.getLogger(__name__)


class CouponError(Exception):
    """Custom exception for coupon-related errors."""
    pass


def redeem_coupon(code: str, user_id: str, db: Session) -> dict:
    """Redeem a coupon code for tokens.

    Args:
        code: The coupon code to redeem
        user_id: The user redeeming the coupon
        db: Database session

    Returns:
        dict with success, message, tokens_added, new_balance

    Raises:
        CouponError: If coupon is invalid, expired, inactive, or already redeemed
    """
    # Normalize code (uppercase, strip whitespace)
    code = code.strip().upper()

    # Find coupon
    coupon = db.query(Coupon).filter(Coupon.code == code).first()
    if not coupon:
        raise CouponError("Invalid coupon code")

    # Check if active
    if not coupon.is_active:
        raise CouponError("This coupon is no longer active")

    # Check if expired
    if coupon.expires_at and coupon.expires_at < datetime.utcnow():
        raise CouponError("This coupon has expired")

    # Check if max uses reached
    if coupon.current_uses >= coupon.max_uses:
        raise CouponError("This coupon has reached its maximum number of uses")

    # Check if already redeemed by this user
    existing_redemption = db.query(CouponRedemption).filter(
        CouponRedemption.coupon_id == coupon.id,
        CouponRedemption.user_id == user_id
    ).first()

    if existing_redemption:
        raise CouponError("You have already redeemed this coupon")

    # Add tokens to user
    new_balance = add_tokens(user_id, coupon.token_amount, db, reason=f"coupon:{code}")

    # Record redemption
    redemption = CouponRedemption(
        coupon_id=coupon.id,
        user_id=user_id,
        redeemed_at=datetime.utcnow()
    )
    db.add(redemption)

    # Increment usage count
    coupon.current_uses += 1

    db.commit()

    logger.info(f"User {user_id} redeemed coupon {code} for {coupon.token_amount} tokens")

    return {
        "success": True,
        "message": f"Successfully redeemed {coupon.token_amount} tokens!",
        "tokens_added": coupon.token_amount,
        "new_balance": new_balance
    }


def create_coupon(
    code: str,
    token_amount: int,
    db: Session,
    max_uses: int = 1,
    expires_at: datetime = None,
    is_active: bool = True
) -> Coupon:
    """Create a new coupon (admin function).

    Args:
        code: Unique coupon code
        token_amount: Number of tokens to award
        db: Database session
        max_uses: Maximum number of times this coupon can be redeemed (default: 1)
        expires_at: Optional expiration date
        is_active: Whether coupon is active (default True)

    Returns:
        Created Coupon object
    """
    # Normalize code
    code = code.strip().upper()

    # Check if code already exists
    existing = db.query(Coupon).filter(Coupon.code == code).first()
    if existing:
        raise CouponError(f"Coupon code '{code}' already exists")

    coupon = Coupon(
        code=code,
        token_amount=token_amount,
        max_uses=max_uses,
        expires_at=expires_at,
        is_active=is_active
    )
    db.add(coupon)
    db.commit()
    db.refresh(coupon)

    logger.info(f"Created coupon {code} for {token_amount} tokens (max {max_uses} uses)")
    return coupon
