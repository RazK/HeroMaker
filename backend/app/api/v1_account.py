"""The account on /api/v1: signing in, the profile, buying credits, coupons.

One API for every client (app/services/principal.py). These are what a person
does with their account, so they need the app's access (scope "app"): an API
key can read its account's credits (GET /api/v1/account) but never sign in as
it, change it, delete it or spend its money.

They run the same code the old routes did (app/api/auth.py, payments.py,
coupons.py); nothing is written twice. Lemon Squeezy's webhook stays at
/api/payments/webhook: it is the store calling us, not a client, and the
store is configured with that address.

    POST   /signup  /login  /login/google  /logout
    GET    /auth/config
    POST   /password/forgot  /password/reset
    GET    PATCH  DELETE  /me
    GET    /packs      POST /checkout      GET /receipts
    POST   /coupons/redeem
"""
from fastapi import APIRouter, BackgroundTasks, Depends, Request, status
from sqlalchemy.orm import Session

from app.api import auth, coupons, payments
from app.database import get_db
from app.schemas.auth import (
    AuthConfigResponse,
    MessageResponse,
    TokenResponse,
    UserResponse,
    DeleteAccountRequest,
    ForgotPasswordRequest,
    GoogleLoginRequest,
    LoginRequest,
    ResetPasswordRequest,
    SignupRequest,
    UpdateProfileRequest,
)
from app.schemas.coupon import CouponRedeemRequest, CouponRedeemResponse
from app.api.payments import CheckoutRequest, CheckoutResponse, PackOut, ReceiptOut
from app.services.principal import APP, Principal, require
from app.services.task_manager import get_task_manager

router = APIRouter()


# --- Signing in: no caller yet.

@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def signup(body: SignupRequest, db: Session = Depends(get_db)):
    return auth.signup(body, db=db)


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    return auth.login(body, db=db)


@router.post("/login/google", response_model=TokenResponse)
def login_google(body: GoogleLoginRequest, db: Session = Depends(get_db)):
    return auth.login_with_google(body, db=db)


@router.post("/logout", response_model=MessageResponse)
def logout():
    return auth.logout()


@router.get("/auth/config", response_model=AuthConfigResponse)
def auth_config():
    return auth.auth_config()


@router.post("/password/forgot", response_model=MessageResponse)
def forgot_password(body: ForgotPasswordRequest, request: Request, background_tasks: BackgroundTasks,
                    db: Session = Depends(get_db)):
    return auth.forgot_password(body, request, background_tasks, db=db)


@router.post("/password/reset", response_model=TokenResponse)
def reset_password(body: ResetPasswordRequest, db: Session = Depends(get_db)):
    return auth.reset_password(body, db=db)


# --- The signed-in person.

@router.get("/me", response_model=UserResponse)
def get_me(who: Principal = Depends(require(APP)), db: Session = Depends(get_db)):
    return auth.get_me(user=who.user, db=db)


@router.patch("/me", response_model=UserResponse)
def update_me(body: UpdateProfileRequest, who: Principal = Depends(require(APP)), db: Session = Depends(get_db)):
    return auth.update_me(body, user=who.user, db=db)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_me(body: DeleteAccountRequest, who: Principal = Depends(require(APP)), db: Session = Depends(get_db),
              task_manager=Depends(get_task_manager)):
    return auth.delete_me(body, user=who.user, db=db, task_manager=task_manager)


# --- Credits: what is on sale, buying, receipts, coupons.

@router.get("/packs", response_model=list[PackOut])
def packs():
    return payments.list_packs()


@router.post("/checkout", response_model=CheckoutResponse)
def checkout(body: CheckoutRequest, who: Principal = Depends(require(APP)), db: Session = Depends(get_db)):
    return payments.create_checkout(body, db=db, user=who.user)


@router.get("/receipts", response_model=list[ReceiptOut])
def receipts(who: Principal = Depends(require(APP)), db: Session = Depends(get_db)):
    return payments.list_receipts(db=db, user=who.user)


@router.post("/coupons/redeem", response_model=CouponRedeemResponse)
def redeem(body: CouponRedeemRequest, who: Principal = Depends(require(APP)), db: Session = Depends(get_db)):
    return coupons.redeem_coupon_endpoint(body, db=db, user=who.user)
