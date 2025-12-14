import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, Text, JSON, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String, unique=True, index=True)
    google_id = Column(String, unique=True, index=True, nullable=True)
    username = Column(String)
    password_hash = Column(String, nullable=True)
    is_admin = Column(Boolean, default=False)
    subscription_tier = Column(String, default='free')
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    creations = relationship("Creation", back_populates="user")

class Creation(Base):
    __tablename__ = "creations"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"))
    character_name = Column(String, nullable=True)
    status = Column(String, default="pending")  # pending, processing, completed, failed
    current_task = Column(String, nullable=True)
    is_public = Column(Boolean, default=True)
    error_message = Column(Text, nullable=True)
    metadata_json = Column(JSON, default={}, name="metadata") # 'metadata' is reserved in Base
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="creations")

