"""Coupon redemption service."""
import logging
from datetime import datetime
from sqlalchemy.orm import Session
from app.models import Coupon, CouponRedemption
from app.services.credits import add_credits

logger = logging.getLogger(__name__)


class CouponError(Exception):
    """Custom exception for coupon-related errors."""
    pass


def redeem_coupon(code: str, user_id: str, db: Session) -> dict:
    """Redeem a coupon code for credits.

    Args:
        code: The coupon code to redeem
        user_id: The user redeeming the coupon
        db: Database session

    Returns:
        dict with success, message, credits_added, new_balance

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

    # Add credits to user
    new_balance = add_credits(user_id, coupon.credit_amount, db, reason=f"coupon:{code}")

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

    logger.info(f"User {user_id} redeemed coupon {code} for {coupon.credit_amount} credits")

    return {
        "success": True,
        "message": f"Successfully redeemed {coupon.credit_amount} credits!",
        "credits_added": coupon.credit_amount,
        "new_balance": new_balance
    }


def validate_coupon(code: str, user_id: str, db: Session) -> dict:
    """Validate a coupon code and return its value without redeeming it.

    Args:
        code: The coupon code to validate
        user_id: The user who wants to redeem the coupon
        db: Database session

    Returns:
        dict with valid, credits, message

    Raises:
        CouponError: If coupon is invalid, expired, inactive, etc.
    """
    # Normalize code (uppercase, strip whitespace)
    code = code.strip().upper()

    # Find coupon
    coupon = db.query(Coupon).filter(Coupon.code == code).first()
    if not coupon:
        return {
            "valid": False,
            "credits": 0,
            "message": "Invalid coupon code"
        }

    # Check if active
    if not coupon.is_active:
        return {
            "valid": False,
            "credits": 0,
            "message": "This coupon is no longer active"
        }

    # Check if expired
    if coupon.expires_at and coupon.expires_at < datetime.utcnow():
        return {
            "valid": False,
            "credits": 0,
            "message": "This coupon has expired"
        }

    # Check if max uses reached
    if coupon.current_uses >= coupon.max_uses:
        return {
            "valid": False,
            "credits": 0,
            "message": "This coupon has reached its maximum number of uses"
        }

    # Check if already redeemed by this user (unless coupon allows multiple per user)
    if not coupon.allow_multiple_per_user:
        existing_redemption = db.query(CouponRedemption).filter(
            CouponRedemption.coupon_id == coupon.id,
            CouponRedemption.user_id == user_id
        ).first()

        if existing_redemption:
            return {
                "valid": False,
                "credits": 0,
                "message": "You have already redeemed this coupon"
            }

    # Valid coupon
    return {
        "valid": True,
        "credits": coupon.credit_amount,
        "message": f"Valid coupon worth {coupon.credit_amount} credits"
    }


def create_coupon(
    code: str,
    credit_amount: int,
    db: Session,
    max_uses: int = 1,
    expires_at: datetime = None,
    is_active: bool = True
) -> Coupon:
    """Create a new coupon (admin function).

    Args:
        code: Unique coupon code
        credit_amount: Number of credits to award
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
        credit_amount=credit_amount,
        max_uses=max_uses,
        expires_at=expires_at,
        is_active=is_active,
        allow_multiple_per_user=allow_multiple_per_user
    )
    db.add(coupon)
    db.commit()
    db.refresh(coupon)

    logger.info(f"Created coupon {code} for {credit_amount} credits (max {max_uses} uses)")
    return coupon
