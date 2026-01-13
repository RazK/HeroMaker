import uuid
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy import Column, String, Boolean, DateTime, Text, JSON, ForeignKey, Integer
from sqlalchemy.orm import relationship
from app.database import Base
from app.config.steps import STEPS

class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String, unique=True, index=True)
    google_id = Column(String, unique=True, index=True, nullable=True)
    username = Column(String, unique=True, index=True)
    password_hash = Column(String, nullable=True)
    tokens = Column(Integer, default=0)
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
    name = Column(String, nullable=True)  # Person's name (for original image)
    age = Column(Integer, nullable=True)  # Person's age (for original image)
    is_public = Column(Boolean, default=True)
    metadata_json = Column(JSON, default={}, name="metadata") # 'metadata' is reserved in Base
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="creations")
    steps = relationship("CreationStep", back_populates="creation", cascade="all, delete-orphan", lazy="select")
    
    @property
    def status(self) -> str:
        """Calculate status from steps: completed if all completed, failed if any failed, processing if any processing, else pending."""
        if not self.steps:
            return "pending"
        
        step_statuses = [s.status for s in self.steps]
        if all(s == "completed" for s in step_statuses):
            return "completed"
        elif any(s == "failed" for s in step_statuses):
            return "failed"
        elif any(s == "processing" for s in step_statuses):
            return "processing"
        return "pending"
    
    @property
    def current_step(self) -> Optional[str]:
        """Get current step: first processing step, or first pending step (in STEPS order)."""
        if not self.steps:
            return STEPS[0]["name"] if STEPS else None
        
        steps_by_name = {s.step_name: s for s in self.steps}
        
        # First processing step
        for step_config in STEPS:
            step = steps_by_name.get(step_config["name"])
            if step and step.status == "processing":
                return step_config["name"]
        
        # First pending step
        for step_config in STEPS:
            step = steps_by_name.get(step_config["name"])
            if not step or step.status == "pending":
                return step_config["name"]
        
        return None
    
    @property
    def completed_at(self) -> Optional[datetime]:
        """Get completed_at from last step's completed_at (if all steps completed)."""
        if self.status != "completed":
            return None

        if not self.steps:
            return None
        
        steps_by_name = {s.step_name: s for s in self.steps}
        
        # Get completed_at of last step in STEPS order
        for step_config in reversed(STEPS):
            step = steps_by_name.get(step_config["name"])
            if step and step.completed_at:
                return step.completed_at
        
        return None
    
    @property
    def error_message(self) -> Optional[str]:
        """Get error_message from first failed step (in STEPS order)."""
        if self.status != "failed":
            return None

        if not self.steps:
            return None
        
        steps_by_name = {s.step_name: s for s in self.steps}
        
        # Get error_message from first failed step
        for step_config in STEPS:
            step = steps_by_name.get(step_config["name"])
            if step and step.status == "failed" and step.error_message:
                return step.error_message
        
        return None
    


class CreationStep(Base):
    __tablename__ = "creation_steps"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    creation_id = Column(String, ForeignKey("creations.id"), nullable=False, index=True)
    step_name = Column(String, nullable=False, index=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    estimated_duration = Column(Integer, nullable=True)  # seconds
    estimated_progress = Column(Integer, nullable=True)  # 0-100, nullable
    estimated_completion_time = Column(DateTime, nullable=True)  # Calculated completion time, updated when progress changes
    status = Column(String, default="pending")  # pending, processing, completed, failed
    error_message = Column(Text, nullable=True)
    metadata_json = Column(JSON, default={}, name="metadata")  # Step-specific metadata (e.g., Meshy API task IDs, animation URLs)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationship
    creation = relationship("Creation", back_populates="steps")


class Coupon(Base):
    """Coupon codes that can be redeemed for tokens."""
    __tablename__ = "coupons"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    code = Column(String, unique=True, index=True, nullable=False)  # e.g., "HERO-XXXXXX"
    token_amount = Column(Integer, nullable=False)  # Tokens awarded on redemption
    max_uses = Column(Integer, default=1)  # Maximum total redemptions (default: single-use)
    current_uses = Column(Integer, default=0)  # How many times it's been redeemed
    expires_at = Column(DateTime, nullable=True)  # NULL = never expires
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    redemptions = relationship("CouponRedemption", back_populates="coupon", cascade="all, delete-orphan")


class CouponRedemption(Base):
    """Tracks which users have redeemed which coupons (single-use-per-user)."""
    __tablename__ = "coupon_redemptions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    coupon_id = Column(String, ForeignKey("coupons.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    redeemed_at = Column(DateTime, default=datetime.utcnow)

    coupon = relationship("Coupon", back_populates="redemptions")
    user = relationship("User")
