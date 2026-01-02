from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User
from app.schemas.auth import (
    SignupRequest,
    LoginRequest,
    UserResponse,
    TokenResponse,
    MessageResponse
)
from app.services.auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user
)

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
        tokens=0  # New users start with 0 tokens
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
    user: User = Depends(get_current_user)
):
    """Get current user information."""
    return UserResponse.from_user(user)


@router.post("/logout", response_model=MessageResponse)
def logout():
    """
    Logout endpoint (client-side token removal).
    This is mainly for API consistency - actual logout happens client-side by removing the token.
    """
    return MessageResponse(message="Logged out successfully")


