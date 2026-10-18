"""Admin API endpoints for managing users and coupons."""
import re
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User, Coupon, Creation
from app.schemas.admin import (
    AdminUserResponse,
    AdminUserCounts,
    AdminUserUpdate,
    AdminCouponResponse,
    AdminCouponCreate,
    AdminCouponUpdate,
    CreationStats,
)
import logging
import secrets

from app.services import account_deletion
from app.services.auth import get_current_user
from app.services.task_manager import get_task_manager
from app.services.users import count_users, list_users_with_stats, update_user
from app.utils.storage import get_storage
from app.api import finance, money

logger = logging.getLogger(__name__)

router = APIRouter()

# Finance: margin report (JSON + server-rendered HTML) and the credit ledger's
# audit views. Kept in its own module because it is a different concern from
# user/coupon CRUD, but mounted here so everything admin lives under one prefix.
router.include_router(finance.router, prefix="/finance", tags=["admin-finance"])
# Money: the admin console's company view - income, costs, net, provider
# balances and the monthly bills.
router.include_router(money.router, prefix="/money", tags=["admin-money"])

# Unambiguous: no 0/O, 1/I/L.
_COUPON_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def _new_coupon_code() -> str:
    return "HERO-" + "".join(secrets.choice(_COUPON_ALPHABET) for _ in range(6))


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Dependency that requires the current user to be an admin."""
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return user


# ============ User Endpoints ============

@router.get("/users", response_model=List[AdminUserResponse])
def list_users(
    include_test: bool = Query(
        False,
        description="Also list test accounts (robot_* usernames, @example.com emails).",
    ),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin)
):
    """List live users with creation statistics. Deleted accounts never appear;
    test accounts only with include_test=true, so they cannot bury real people."""
    users_data = list_users_with_stats(db, include_test=include_test)
    return [
        AdminUserResponse(
            id=u["id"],
            username=u["username"],
            email=u["email"],
            name=u["name"],
            date_of_birth=u["date_of_birth"],
            credits=u["credits"],
            is_admin=u["is_admin"],
            created_at=u["created_at"],
            creation_stats=CreationStats(**u["creation_stats"]),
            is_test_account=u["is_test_account"],
        )
        for u in users_data
    ]


@router.get("/users/count", response_model=AdminUserCounts)
def users_count(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin)
):
    """How many live accounts there are, real and test: the numbers behind the
    list's "Show test accounts (N)" toggle."""
    return AdminUserCounts(**count_users(db))


@router.patch("/users/{user_id}", response_model=AdminUserResponse)
def admin_update_user(
    user_id: str,
    update_data: AdminUserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin)
):
    """Update a user's credits or admin status."""
    # Build update kwargs
    update_kwargs = {}
    if update_data.credits is not None:
        update_kwargs["credits"] = update_data.credits
    if update_data.is_admin is not None:
        update_kwargs["is_admin"] = update_data.is_admin
    
    if not update_kwargs:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update"
        )
    
    updated_user = update_user(user_id, db, **update_kwargs)
    if not updated_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Get fresh stats
    users_data = list_users_with_stats(db)
    user_data = next((u for u in users_data if u["id"] == user_id), None)
    
    return AdminUserResponse(
        id=updated_user.id,
        username=updated_user.username,
        email=updated_user.email,
        name=updated_user.name,
        date_of_birth=updated_user.date_of_birth,
        credits=updated_user.credits,
        is_admin=updated_user.is_admin,
        created_at=updated_user.created_at,
        creation_stats=CreationStats(**user_data["creation_stats"]) if user_data else CreationStats(completed=0, failed=0, in_progress=0),
        is_test_account=user_data["is_test_account"] if user_data else False,
    )


@router.delete("/users/{user_id}")
def admin_delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    task_manager=Depends(get_task_manager),
):
    """
    Delete a user's account, exactly as they could themselves: heroes and files
    removed, the row kept anonymous because payments and the ledger point at it.
    See app/services/account_deletion.py. (A plain db.delete here used to fail
    on those foreign keys.)
    """
    if user_id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete yourself"
        )

    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    try:
        account_deletion.delete_account(db, user, task_manager)
    except Exception:
        db.rollback()
        logger.exception("Admin could not delete account %s", user_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The account could not be deleted right now. Please try again.",
        )

    return {"message": "User deleted successfully"}


# ============ Coupon Endpoints ============

@router.get("/coupons", response_model=List[AdminCouponResponse])
def list_coupons(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin)
):
    """List all coupons."""
    coupons = db.query(Coupon).order_by(Coupon.created_at.desc()).all()
    return [AdminCouponResponse.model_validate(c) for c in coupons]


@router.post("/coupons", response_model=AdminCouponResponse, status_code=status.HTTP_201_CREATED)
def create_coupon(
    coupon_data: AdminCouponCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin)
):
    """Create a new coupon."""
    # Normalize code; none given means "make one up".
    code = (coupon_data.code or "").strip().upper() or _new_coupon_code()
    
    # Check if code already exists
    existing = db.query(Coupon).filter(Coupon.code == code).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Coupon code '{code}' already exists"
        )
    
    coupon = Coupon(
        code=code,
        credit_amount=coupon_data.credit_amount,
        max_uses=coupon_data.max_uses,
        allow_multiple_per_user=coupon_data.allow_multiple_per_user,
        expires_at=coupon_data.expires_at,
        is_active=True,
    )
    db.add(coupon)
    db.commit()
    db.refresh(coupon)
    
    return AdminCouponResponse.model_validate(coupon)


@router.patch("/coupons/{coupon_id}", response_model=AdminCouponResponse)
def admin_update_coupon(
    coupon_id: str,
    update_data: AdminCouponUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin)
):
    """Update a coupon's active status."""
    coupon = db.query(Coupon).filter(Coupon.id == coupon_id).first()
    if not coupon:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Coupon not found"
        )
    
    if update_data.is_active is not None:
        coupon.is_active = update_data.is_active
    
    db.commit()
    db.refresh(coupon)
    
    return AdminCouponResponse.model_validate(coupon)


@router.delete("/coupons/{coupon_id}")
def admin_delete_coupon(
    coupon_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin)
):
    """Delete a coupon."""
    coupon = db.query(Coupon).filter(Coupon.id == coupon_id).first()
    if not coupon:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Coupon not found"
        )
    
    db.delete(coupon)
    db.commit()
    
    return {"message": "Coupon deleted successfully"}


# ============ Hero Statue (prototype) ============

@router.get("/creations/{creation_id}/print-file")
def statue_print_file(
    creation_id: str,
    height_mm: float = Query(90.0, ge=30, le=250, description="Total height, base included"),
    name: Optional[str] = Query(None, max_length=40, description="Engraved hero name (default: the hero's)"),
    child: Optional[str] = Query(None, max_length=40, description="'drawn by ...' (default: the creator's first name)"),
    age: Optional[int] = Query(None, ge=1, le=120),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """A print-ready Hero Statue package for one hero (admin only).

    model.glb (the textured Meshy sculpt) -> repaired, watertight, scaled,
    on an engraved base -> zip of OBJ+MTL+texture, 3MF, preview GLB and
    report.json. Upload the zip to a full-colour resin service. Takes ~10 s;
    sync on purpose (a `def` endpoint runs in the threadpool).
    """
    from app.services import statue

    creation = db.query(Creation).filter(Creation.id == creation_id, Creation.deleted_at.is_(None)).first()
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")
    storage = get_storage()
    if not storage.file_exists(creation.user_id, creation.id, "model.glb"):
        raise HTTPException(status_code=409, detail="This hero has no 3D model yet")
    glb = storage.download_file(creation.user_id, creation.id, "model.glb")
    hero = name if name is not None else (creation.character_name or "")
    kid = child if child is not None else (creation.name or "")
    try:
        data, report = statue.make_statue_package(glb, height_mm, hero, kid, age if age is not None else creation.age)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"Could not make a print file: {e}")
    slug = re.sub(r"[^a-z0-9]+", "-", (hero or "hero").lower()).strip("-") or "hero"
    logger.info("statue print file: creation=%s height=%s watertight=%s volume_cm3=%s",
                creation.id, height_mm, report.get("watertight"), report.get("volume_cm3"))
    return Response(
        content=data,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="statue-{slug}-{int(round(height_mm))}mm.zip"',
            "X-Statue-Watertight": str(report.get("watertight")).lower(),
            "X-Statue-Volume-Cm3": str(report.get("volume_cm3")),
        },
    )
