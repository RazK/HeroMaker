from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional
import re


class SignupRequest(BaseModel):
    username: str
    email: str  # Changed from EmailStr to str to allow .local domains
    password: str
    
    @field_validator('password')
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError('Password must be at least 6 characters long')
        return v
    
    @field_validator('username')
    @classmethod
    def validate_username(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError('Username cannot be empty')
        return v.strip()
    
    @field_validator('email')
    @classmethod
    def validate_email(cls, v: str) -> str:
        """Validate email format, allowing .local domains for development."""
        if not v or not v.strip():
            raise ValueError('Email cannot be empty')
        email = v.strip().lower()
        # Basic email regex (allows .local and other TLDs)
        email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(email_pattern, email):
            raise ValueError('Invalid email format')
        return email


class LoginRequest(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    tokens: int
    is_admin: bool
    created_at: str
    
    @classmethod
    def from_user(cls, user):
        return cls(
            id=user.id,
            username=user.username,
            email=user.email,
            tokens=user.tokens,
            is_admin=user.is_admin,
            created_at=user.created_at.isoformat() if user.created_at else None
        )


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class MessageResponse(BaseModel):
    message: str

