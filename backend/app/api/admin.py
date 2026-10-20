"""Admin API endpoints for managing users and coupons."""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import ClassRoom, User, Coupon
from app.schemas.admin import (
    AdminUserResponse,
    AdminUserCounts,
    AdminUserUpdate,
    AdminHeroRemove,
    AdminHeroRestore,
    AdminCreditChange,
    AdminCouponResponse,
    AdminCouponCreate,
    AdminCouponUpdate,
    CreationStats,
)
import logging
import secrets

from app.services import account_deletion, moderation
from app.services.account_kinds import is_test_account
from app.schemas.creation import CreationResponse
from app.services.auth import get_current_user
from app.services.task_manager import get_task_manager
from app.services.credits import step_billing
from app.services.users import count_users, hero_stats, list_users_with_stats, update_user
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


# ============ Schools ============

@router.get("/schools")
def list_schools(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """Teachers and their schools: where, what kind, and what they did with
    us (classes, seats bought, heroes made). Busiest first."""
    from app.services.classes import schools_report

    rows = schools_report(db)
    for r in rows:
        r["last_class_at"] = r["last_class_at"].isoformat() if r["last_class_at"] else None
        r["teacher_since"] = r["teacher_since"].isoformat() if r["teacher_since"] else None
    return {"teachers": rows}


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
    
    before = db.query(User).filter(User.id == user_id).first()
    previous = (int(before.credits or 0), bool(before.is_admin)) if before else (0, False)

    updated_user = update_user(user_id, db, **update_kwargs)
    if not updated_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # The audit log (app/services/moderation.py): what changed, and who did it.
    credits_before, admin_before = previous
    if update_data.credits is not None and int(update_data.credits) != credits_before:
        moderation.record(
            db, admin_id=admin.id, action="set_credits", target_user_id=user_id,
            amount=int(update_data.credits) - credits_before,
            details={"previous_balance": credits_before, "balance_after": int(updated_user.credits or 0)},
        )
    if update_data.is_admin is not None and bool(update_data.is_admin) != admin_before:
        moderation.record(
            db, admin_id=admin.id, action="make_admin" if update_data.is_admin else "remove_admin",
            target_user_id=user_id,
        )
    db.commit()
    db.refresh(updated_user)
    
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

    # Nothing in it names them: the account is anonymous now, and so is this row.
    moderation.record(db, admin_id=admin.id, action="delete_account", target_user_id=user_id)
    db.commit()
    return {"message": "User deleted successfully"}


# ============ A user's page: their heroes, credits and audit log ============
#
# app/services/moderation.py holds the rules; these are its doors. Every one
# is admin-only through require_admin, checked here on the server.

def _moderation_error(e: moderation.ModerationError) -> HTTPException:
    return HTTPException(status_code=e.status, detail=e.message)


def _hero_view(creation, removal, class_title, billing=None) -> dict:
    view = CreationResponse.from_creation(creation, admin=True, billing=billing).model_dump()  # admin-only: raw step errors too
    view["removed"] = None if removal is None else {
        "at": creation.deleted_at,
        "reason": removal.reason,
        "note": removal.note,
        "by": removal.admin.username if removal.admin else None,
    }
    view["class_title"] = class_title
    return view


def _set_file_pass(request: Request, response: Response, admin: User) -> None:
    """The cookie that lets this admin's browser load a removed hero's files
    (its tile, its page), which /api/files refuses everyone else. Sent only to
    /api/files, unreadable by scripts, and never usable as a Bearer token."""
    https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").startswith("https")
    response.set_cookie(
        moderation.FILE_PASS_COOKIE,
        moderation.issue_file_pass(admin.id),
        max_age=moderation.FILE_PASS_SECONDS,
        path="/api/files",
        httponly=True,
        samesite="strict",
        secure=https,
    )


@router.get("/users/{user_id}")
def admin_user_detail(
    user_id: str,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """One account for the admin's user page: who they are, their heroes
    (in progress, failed and removed ones too) and what admins did to it."""
    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None), User.kind == "person").first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    heroes = moderation.user_heroes(db, user)
    # What each failed step cost and gave back, from the ledger: one query.
    billing = step_billing(db, [c.id for c, _, _ in heroes])
    removed = sum(1 for _, r, _ in heroes if r is not None)
    school = None
    if user.school_name:
        school = {
            "name": user.school_name, "city": user.school_city,
            "country": user.school_country, "type": user.school_type,
        }
    _set_file_pass(request, response, admin)
    return {
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "name": user.name,
            "credits": int(user.credits or 0),
            "is_admin": bool(user.is_admin),
            "is_teacher": bool(user.is_teacher),
            "is_test_account": is_test_account(user.username, user.email),
            "created_at": user.created_at,
            "school": school,
            "classes": db.query(ClassRoom).filter(ClassRoom.owner_id == user.id).count(),
        },
        # The same numbers as their card on the users list (hero_stats).
        "counts": {
            **hero_stats([c for c, r, _ in heroes if r is None]),
            "heroes": len(heroes) - removed,
            "removed": removed,
        },
        "heroes": [_hero_view(c, r, t, billing) for c, r, t in heroes],
        "audit": [moderation.action_view(a) for a in moderation.audit_for_user(db, user.id)],
    }


@router.post("/creations/{creation_id}/remove")
def admin_remove_hero(
    creation_id: str,
    body: AdminHeroRemove,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    task_manager=Depends(get_task_manager),
):
    """Take a hero down: gone from the gallery, Editors' choice, classes and
    games, and its files no longer public. Kept, so it can be restored."""
    try:
        row = moderation.remove_hero(db, admin, creation_id, body.reason, body.note, task_manager)
    except moderation.ModerationError as e:
        raise _moderation_error(e)
    return moderation.action_view(row)


@router.post("/creations/{creation_id}/restore")
def admin_restore_hero(
    creation_id: str,
    body: Optional[AdminHeroRestore] = None,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Undo a removal: the hero is back everywhere it was."""
    try:
        row = moderation.restore_hero(db, admin, creation_id, body.note if body else None)
    except moderation.ModerationError as e:
        raise _moderation_error(e)
    return moderation.action_view(row)


@router.post("/users/{user_id}/credits")
def admin_change_credits(
    user_id: str,
    body: AdminCreditChange,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Give credits (amount > 0) or take some back (amount < 0, never below
    zero), with a note. Booked in the ledger as admin_adjust; never revenue."""
    try:
        tx, row = moderation.change_credits(db, admin, user_id, body.amount, body.note)
    except moderation.ModerationError as e:
        raise _moderation_error(e)
    return {"credits": int(tx.balance_after), "action": moderation.action_view(row)}


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
