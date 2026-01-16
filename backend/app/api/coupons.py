"""Coupon redemption API endpoints."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User
from app.schemas.coupon import CouponRedeemRequest, CouponRedeemResponse, CouponValidateResponse, CouponValidateResponse
from app.services.auth import get_current_user
from app.services.coupons import redeem_coupon, validate_coupon, CouponError

router = APIRouter()


@router.post("/validate", response_model=CouponValidateResponse)
def validate_coupon_endpoint(
    request: CouponRedeemRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Validate a coupon code and return its value without redeeming it.

    Requires authentication. Used to preview coupon value before redemption.
    """
    result = validate_coupon(request.code, user.id, db)
    return CouponValidateResponse(**result)


@router.post("/redeem", response_model=CouponRedeemResponse)
def redeem_coupon_endpoint(
    request: CouponRedeemRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Redeem a coupon code for credits.

    Requires authentication. Each coupon can only be redeemed once per user.
    """
    try:
        result = redeem_coupon(request.code, user.id, db)
        return CouponRedeemResponse(**result)
    except CouponError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
