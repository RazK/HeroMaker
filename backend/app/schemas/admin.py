"""Admin API schemas."""
from datetime import datetime, date
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field


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
    is_test_account: bool = False


class AdminUserCounts(BaseModel):
    """Live accounts: real ones, and the test accounts the list hides by default."""
    users: int
    test_accounts: int


class AdminUserUpdate(BaseModel):
    """Request to update a user (admin)."""
    credits: Optional[int] = None
    is_admin: Optional[bool] = None


class AdminHeroRemove(BaseModel):
    """Remove a hero: why (one of app.models.REMOVAL_REASONS), and a note
    ("other" needs one). Checked in app/services/moderation.py."""
    reason: str
    note: Optional[str] = None


class AdminHeroRestore(BaseModel):
    note: Optional[str] = None


class AdminCreditChange(BaseModel):
    """Give (amount > 0) or take back (amount < 0) credits. The note is required."""
    amount: int
    note: str = ""


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
    """Request to create a coupon. Omit `code` to have one generated."""
    code: Optional[str] = Field(None, max_length=64)
    credit_amount: int = Field(..., gt=0, le=100_000)
    max_uses: int = Field(1, ge=1, le=1_000_000)
    allow_multiple_per_user: bool = False
    expires_at: Optional[datetime] = None


class AdminCouponUpdate(BaseModel):
    """Request to update a coupon (admin)."""
    is_active: Optional[bool] = None
