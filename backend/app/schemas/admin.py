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


# ============ Data Import Schemas ============
# Staging-only plumbing for copying creations between deployments over HTTPS.
# See app/services/data_import.py for why it exists and how it is gated.

class ImportStep(BaseModel):
    """One pipeline step of an imported creation, copied verbatim from source."""
    step_name: str
    status: str = "pending"  # pending, processing, completed, failed
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    estimated_completion_time: Optional[datetime] = None
    error_message: Optional[str] = None
    metadata_json: Optional[dict] = None


class ImportCreationRequest(BaseModel):
    """Copy one creation - its rows and its files - from another deployment."""
    source_base_url: str
    source_user_id: str
    source_creation_id: str
    files: List[str] = []

    # Metadata for the row written here. Production's is mostly NULL, so the
    # caller usually supplies something more presentable.
    character_name: Optional[str] = None
    name: Optional[str] = None          # creator's display name
    age: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    steps: List[ImportStep] = []

    # Which account owns the copy here. Created if missing (no password).
    owner_username: Optional[str] = None
    owner_name: Optional[str] = None

    # Reuse the source id so a re-run replaces rather than duplicates.
    creation_id: Optional[str] = None
    replace: bool = False


class ImportedFile(BaseModel):
    """Result for one file the importer was asked to copy."""
    filename: str
    bytes: int = 0
    error: Optional[str] = None


class ImportCreationResponse(BaseModel):
    """What the importer actually wrote."""
    creation_id: str
    user_id: str
    status: str
    replaced: bool
    files: List[ImportedFile]
