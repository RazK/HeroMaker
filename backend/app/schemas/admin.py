"""Admin API schemas."""
from datetime import datetime, date
from typing import Optional, List
from pydantic import BaseModel, ConfigDict


# ============ User Schemas ============

class CreationStats(BaseModel):
    """Creation statistics for a user."""
    completed: int
    failed: int
    in_progress: int


class AdminUserResponse(BaseModel):
    """User response for admin panel."""
    model_config = ConfigDict(from_attributes=True)
    
    id: str
    username: str
    email: str
    name: Optional[str] = None
    date_of_birth: Optional[date] = None
    credits: int
    is_admin: bool
    created_at: datetime
    creation_stats: CreationStats


class AdminUserUpdate(BaseModel):
    """Request to update a user (admin)."""
    credits: Optional[int] = None
    is_admin: Optional[bool] = None


# ============ Coupon Schemas ============

class AdminCouponResponse(BaseModel):
    """Coupon response for admin panel."""
    model_config = ConfigDict(from_attributes=True)
    
    id: str
    code: str
    credit_amount: int
    max_uses: int
    current_uses: int
    allow_multiple_per_user: bool
    expires_at: Optional[datetime] = None
    is_active: bool
    created_at: datetime


class AdminCouponCreate(BaseModel):
    """Request to create a coupon."""
    code: str
    credit_amount: int
    max_uses: int = 1
    allow_multiple_per_user: bool = False
    expires_at: Optional[datetime] = None


class AdminCouponUpdate(BaseModel):
    """Request to update a coupon (admin)."""
    is_active: Optional[bool] = None
