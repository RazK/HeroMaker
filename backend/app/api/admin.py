"""Admin API endpoints for managing users, coupons and data imports."""
import logging
from typing import List

import requests
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User, Coupon, Creation, CreationStep
from app.schemas.admin import (
    AdminUserResponse,
    AdminUserUpdate,
    AdminCouponResponse,
    AdminCouponCreate,
    AdminCouponUpdate,
    CreationStats,
    ImportCreationRequest,
    ImportCreationResponse,
    ImportedFile,
)
from app.services import data_import
from app.services.auth import get_current_user
from app.services.users import list_users_with_stats, update_user, delete_user
from app.utils.storage import get_storage

logger = logging.getLogger(__name__)

router = APIRouter()


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
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin)
):
    """List all users with creation statistics."""
    users_data = list_users_with_stats(db)
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
        )
        for u in users_data
    ]


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
    )


@router.delete("/users/{user_id}")
def admin_delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin)
):
    """Delete a user and all their creations."""
    # Prevent self-deletion
    if user_id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete yourself"
        )
    
    success = delete_user(user_id, db)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
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
    # Normalize code
    code = coupon_data.code.strip().upper()
    
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


# ============ Data Import Endpoints ============
# Copy creations in from another HeroMaker deployment over HTTPS. Developer
# plumbing for making a non-production environment demoable; see
# app/services/data_import.py for the gating rationale.

def require_import_enabled(admin: User = Depends(require_admin)) -> User:
    """
    Second gate, after the admin check: the environment must have opted in.

    Default off means this code is inert on production even when deployed
    there - the flag is only ever set on staging.
    """
    try:
        data_import.require_import_enabled()
    except data_import.ImportDisabled as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    return admin


@router.get("/import/status")
def import_status(admin: User = Depends(require_admin)):
    """Whether this environment will accept imports, and from where."""
    enabled = data_import.import_enabled()
    return {
        "enabled": enabled,
        "allowed_source_hosts": sorted(data_import.allowed_source_hosts()) if enabled else [],
        "importable_files": sorted(data_import.ALLOWED_FILENAMES),
    }


@router.post("/import/creation", response_model=ImportCreationResponse, status_code=status.HTTP_201_CREATED)
def import_creation(
    payload: ImportCreationRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_import_enabled),
):
    """
    Copy one creation from another deployment: fetch its files server-side over
    HTTPS, write them through the storage layer, and insert the rows.

    Files are pulled by this backend rather than pushed by the caller, because
    the source's file endpoint is public HTTPS while its database is not
    reachable from everywhere the import needs to run.
    """
    try:
        source = data_import.validate_source_base_url(payload.source_base_url)
        filenames = data_import.validate_filenames(payload.files)
    except data_import.ImportSourceRejected as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    logger.warning(
        "=" * 60
        + "\nDATA IMPORT: admin %r importing %s/%s from %s (%d files)\n"
        + "=" * 60,
        admin.username,
        payload.source_user_id,
        payload.source_creation_id,
        source,
        len(filenames),
    )

    owner = data_import.resolve_owner(
        db, admin, username=payload.owner_username, name=payload.owner_name
    )

    creation_id = payload.creation_id or payload.source_creation_id
    replaced = False
    existing = db.query(Creation).filter(Creation.id == creation_id).first()
    if existing:
        if not payload.replace:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Creation {creation_id} already exists (pass replace=true to overwrite)",
            )
        db.delete(existing)
        db.commit()
        replaced = True

    creation = Creation(
        id=creation_id,
        user_id=owner.id,
        character_name=payload.character_name,
        name=payload.name or owner.name,
        age=payload.age,
        is_public=True,
        metadata_json={
            "imported_from": source,
            "source_creation_id": payload.source_creation_id,
        },
    )
    if payload.created_at:
        creation.created_at = payload.created_at
    if payload.updated_at:
        creation.updated_at = payload.updated_at
    db.add(creation)
    db.commit()

    for step in payload.steps:
        db.add(CreationStep(
            creation_id=creation.id,
            step_name=step.step_name,
            status=step.status,
            started_at=step.started_at,
            completed_at=step.completed_at,
            estimated_completion_time=step.estimated_completion_time,
            error_message=step.error_message,
            metadata_json=step.metadata_json or {},
        ))
    db.commit()

    # Files last: the rows are cheap to roll back, the downloads are not.
    storage = get_storage()
    session = requests.Session()
    results: List[ImportedFile] = []
    for filename in filenames:
        try:
            data = data_import.fetch_source_file(
                source, payload.source_user_id, payload.source_creation_id,
                filename, session=session,
            )
            storage.upload_file(owner.id, creation.id, filename, data)
            results.append(ImportedFile(filename=filename, bytes=len(data)))
        except Exception as e:
            # One missing file (say walking.glb on an older creation) should not
            # cost the whole creation; report it and carry on.
            logger.warning("DATA IMPORT: %s failed for %s: %s", filename, creation.id, e)
            results.append(ImportedFile(filename=filename, error=str(e)))

    # updated_at is set on flush by onupdate, so restore the source's value last.
    if payload.updated_at:
        creation.updated_at = payload.updated_at
        db.commit()

    db.refresh(creation)
    logger.warning(
        "DATA IMPORT: wrote creation %s (%s) for user %s, %d/%d files",
        creation.id, creation.status, owner.username,
        sum(1 for r in results if r.error is None), len(results),
    )

    return ImportCreationResponse(
        creation_id=creation.id,
        user_id=owner.id,
        status=creation.status,
        replaced=replaced,
        files=results,
    )
