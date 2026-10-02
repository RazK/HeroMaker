import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User
from app.schemas.auth import (
    SignupRequest,
    LoginRequest,
    UserResponse,
    TokenResponse,
    MessageResponse,
    UpdateProfileRequest,
    ForgotPasswordRequest,
    ResetPasswordRequest,
    AuthConfigResponse,
)
from app.services.auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user
)
from app.services.users import update_user
from app.services import mailer, password_reset
from app.config.settings import get_frontend_url

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def signup(
    signup_data: SignupRequest,
    db: Session = Depends(get_db)
):
    """Create a new user account."""
    # Check if username already exists
    existing_user = db.query(User).filter(User.username == signup_data.username).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already taken"
        )
    
    # Check if email already exists
    existing_email = db.query(User).filter(User.email == signup_data.email).first()
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Create new user
    hashed_password = hash_password(signup_data.password)
    new_user = User(
        username=signup_data.username,
        email=signup_data.email,
        password_hash=hashed_password,
        name=signup_data.name,
        date_of_birth=signup_data.date_of_birth,
        credits=0  # New users start with 0 credits
    )
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    # Create access token
    access_token = create_access_token(new_user.id)
    
    return TokenResponse(
        access_token=access_token,
        user=UserResponse.from_user(new_user)
    )


@router.post("/login", response_model=TokenResponse)
def login(
    login_data: LoginRequest,
    db: Session = Depends(get_db)
):
    """Login with username and password."""
    # Find user by username
    user = db.query(User).filter(User.username == login_data.username).first()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )
    
    # Check if user has a password (might be Google-only user in future)
    if not user.password_hash:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )
    
    # Verify password
    if not verify_password(login_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )
    
    # Create access token
    access_token = create_access_token(user.id)
    
    return TokenResponse(
        access_token=access_token,
        user=UserResponse.from_user(user)
    )


@router.get("/me", response_model=UserResponse)
def get_me(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get current user information."""
    # Refresh user from database to ensure we have the latest token balance
    db.refresh(user)
    return UserResponse.from_user(user)


@router.patch("/me", response_model=UserResponse)
def update_me(
    update_data: UpdateProfileRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update current user's profile."""
    # Check if trying to change password
    if update_data.new_password:
        if not update_data.current_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current password is required to change password"
            )
        if not verify_password(update_data.current_password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current password is incorrect"
            )
    
    # Check username uniqueness if changing
    if update_data.username and update_data.username != user.username:
        existing = db.query(User).filter(User.username == update_data.username).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already taken"
            )
    
    # Check email uniqueness if changing
    if update_data.email and update_data.email != user.email:
        existing = db.query(User).filter(User.email == update_data.email).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered"
            )
    
    # Build update kwargs
    update_kwargs = {}
    if update_data.name is not None:
        update_kwargs["name"] = update_data.name
    if update_data.username is not None:
        update_kwargs["username"] = update_data.username
    if update_data.email is not None:
        update_kwargs["email"] = update_data.email
    if update_data.date_of_birth is not None:
        update_kwargs["date_of_birth"] = update_data.date_of_birth
    if update_data.new_password:
        update_kwargs["password_hash"] = hash_password(update_data.new_password)
    
    if update_kwargs:
        updated_user = update_user(user.id, db, **update_kwargs)
        return UserResponse.from_user(updated_user)
    
    return UserResponse.from_user(user)


@router.post("/logout", response_model=MessageResponse)
def logout():
    """
    Logout endpoint (client-side token removal).
    This is mainly for API consistency - actual logout happens client-side by removing the token.
    """
    return MessageResponse(message="Logged out successfully")




@router.get("/config", response_model=AuthConfigResponse)
def auth_config():
    """Which sign-in features this deployment offers."""
    return AuthConfigResponse(password_reset=mailer.is_configured())


FORGOT_PASSWORD_MESSAGE = "If that email has an account, a reset link is on its way."


def _client_ip(request: Request) -> str:
    """
    Best-effort client address for rate limiting.

    The backend sits behind Railway's edge (and, for browser calls, the
    frontend's nginx), so the socket peer is a proxy. The first
    X-Forwarded-For entry is the original client as the first proxy saw it.
    It can be forged, which is why the per-email limit, not this one, is what
    protects an inbox; this one only slows a single noisy client.
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    first = forwarded.split(",")[0].strip()
    if first:
        return first
    return request.client.host if request.client else "unknown"


@router.post("/forgot-password", response_model=MessageResponse)
def forgot_password(
    data: ForgotPasswordRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Email a single-use reset link.

    Always the same 200 answer, whether or not the account exists and whether
    or not a limit was hit, so it cannot be used to discover who has an
    account. The email is sent after the response, so a known address does not
    answer measurably slower than an unknown one.
    """
    reply = MessageResponse(message=FORGOT_PASSWORD_MESSAGE)
    if not data.email or not password_reset.allow_request(data.email, _client_ip(request)):
        return reply

    user = db.query(User).filter(func.lower(User.email) == data.email).first()
    if user is None:
        return reply

    token = password_reset.create_token(db, user)
    link = f"{get_frontend_url()}/reset-password?token={token}"
    background_tasks.add_task(mailer.send_password_reset, user.email, link)
    return reply


@router.post("/reset-password", response_model=TokenResponse)
def reset_password(data: ResetPasswordRequest, db: Session = Depends(get_db)):
    """Set a new password with a reset token, and sign the user in."""
    found = password_reset.find_valid(db, data.token)
    if found is None or not password_reset.consume(db, found[0]):
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This link has expired or was already used.",
        )
    _, user = found
    user.password_hash = hash_password(data.new_password)
    db.commit()
    db.refresh(user)
    logger.info("Password reset for user %s", user.id)
    return TokenResponse(
        access_token=create_access_token(user.id),
        user=UserResponse.from_user(user),
    )
