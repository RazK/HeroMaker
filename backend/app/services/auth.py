from datetime import datetime, timedelta
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy.orm import Session
import bcrypt
from app.database import get_db
from app.models import User
from app.config.settings import JWT_SECRET_KEY, JWT_ALGORITHM, JWT_EXPIRATION_HOURS

# Debug user constant for V2 (kept for backward compatibility during migration)
DEBUG_USER_ID = "debug-user-uuid"
DEBUG_USER_EMAIL = "debug@heromaker.local"

# HTTP Bearer token security scheme
security = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against a hash."""
    try:
        return bcrypt.checkpw(
            plain_password.encode('utf-8'),
            hashed_password.encode('utf-8')
        )
    except Exception:
        return False


def create_access_token(user_id: str) -> str:
    """Create a JWT access token for a user."""
    now = datetime.utcnow()
    expire = now + timedelta(hours=JWT_EXPIRATION_HOURS)
    payload = {
        "sub": user_id,  # Subject (user ID)
        "exp": int(expire.timestamp()),   # Expiration time (unix timestamp)
        "iat": int(now.timestamp())  # Issued at (unix timestamp)
    }
    token = jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)
    return token


def verify_access_token(token: str) -> Optional[str]:
    """
    Verify a JWT access token and return the user ID if valid.
    Returns None if token is invalid or expired.
    """
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            return None
        return user_id
    except JWTError:
        return None


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """
    Get the current authenticated user from JWT token.
    Falls back to debug user if no token provided (for backward compatibility during migration).
    """
    # If no credentials provided, fall back to debug user for backward compatibility
    if not credentials:
        user = db.query(User).filter(User.id == DEBUG_USER_ID).first()
        if not user:
            user = User(
                id=DEBUG_USER_ID,
                email=DEBUG_USER_EMAIL,
                username="Debug User",
                is_admin=True,
                credits=1000  # Give debug user credits for testing
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        return user
    
    # Extract token and verify
    token = credentials.credentials
    user_id = verify_access_token(token)
    
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Get user from database
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return user


def get_current_user_required(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """
    Get the current authenticated user from JWT token (required - no fallback).
    Raises 401 if no token or invalid token.
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    token = credentials.credentials
    user_id = verify_access_token(token)
    
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return user

