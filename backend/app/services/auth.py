from fastapi import Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User

# Debug user constant for V2
DEBUG_USER_ID = "debug-user-uuid"
DEBUG_USER_EMAIL = "debug@heromaker.local"

def get_current_user(db: Session = Depends(get_db)) -> User:
    """
    Get the current authenticated user.
    For V2, this always returns a debug user.
    """
    user = db.query(User).filter(User.id == DEBUG_USER_ID).first()
    if not user:
        user = User(
            id=DEBUG_USER_ID,
            email=DEBUG_USER_EMAIL,
            username="Debug User",
            is_admin=True
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    return user

