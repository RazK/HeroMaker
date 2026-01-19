"""Admin API endpoints for managing users and coupons."""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User, Coupon
from app.schemas.admin import (
    AdminUserResponse,
    AdminUserUpdate,
    AdminCouponResponse,
    AdminCouponCreate,
    AdminCouponUpdate,
    CreationStats,
)
from app.services.auth import get_current_user
from app.services.users import list_users_with_stats, update_user, delete_user

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
