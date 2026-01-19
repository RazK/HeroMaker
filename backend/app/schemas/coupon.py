"""Pydantic schemas for coupon-related API endpoints."""
from pydantic import BaseModel, field_validator


class CouponRedeemRequest(BaseModel):
    """Request to redeem a coupon code."""
    code: str

    @field_validator('code')
    @classmethod
    def validate_code(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError('Coupon code cannot be empty')
        if len(v) > 50:
            raise ValueError('Coupon code is too long')
        return v


class CouponRedeemResponse(BaseModel):
    """Response from coupon redemption."""
    success: bool
    message: str
    credits_added: int
    new_balance: int
