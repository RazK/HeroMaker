from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional
from datetime import date
import re


class SignupRequest(BaseModel):
    username: str
    email: str  # Changed from EmailStr to str to allow .local domains
    password: str
    name: str  # User's real name
    date_of_birth: date  # User's date of birth
    
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
    
    @field_validator('name')
    @classmethod
    def validate_name(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError('Name cannot be empty')
        return v.strip()
    
    @field_validator('date_of_birth')
    @classmethod
    def validate_date_of_birth(cls, v: date) -> date:
        if v > date.today():
            raise ValueError('Date of birth cannot be in the future')
        # Check reasonable age (e.g., at least 1 year old, less than 150 years old)
        today = date.today()
        age = today.year - v.year - ((today.month, today.day) < (v.month, v.day))
        if age < 1:
            raise ValueError('Date of birth must be at least 1 year ago')
        if age > 150:
            raise ValueError('Date of birth seems invalid (age would be over 150)')
        return v


class LoginRequest(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    name: Optional[str]
    credits: int
    is_admin: bool
    created_at: str
    
    @classmethod
    def from_user(cls, user):
        return cls(
            id=user.id,
            username=user.username,
            email=user.email,
            name=user.name,
            credits=user.credits,
            is_admin=user.is_admin,
            created_at=user.created_at.isoformat() if user.created_at else None
        )


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class MessageResponse(BaseModel):
    message: str

