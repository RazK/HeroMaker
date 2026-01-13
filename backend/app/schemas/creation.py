from datetime import datetime
from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from app.config.steps import STEPS
from app.models import CreationStep

class CreationRequest(BaseModel):
    character_name: Optional[str] = None
    name: Optional[str] = None
    age: Optional[int] = None

class CreationStepResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    step_name: str
    status: str  # pending, processing, completed, failed
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    estimated_completion_time: Optional[datetime] = None  # Calculated completion time, updated when progress changes
    error_message: Optional[str] = None
    metadata_json: Optional[dict] = None  # Step-specific metadata (e.g., Meshy API task IDs, animation URLs)
    
    @classmethod
    def from_step(cls, step):
        """Build CreationStepResponse from CreationStep model, excluding estimated_progress."""
        # Exclude estimated_progress from response - frontend calculates from estimated_completion_time
        data = {
            "step_name": step.step_name,
            "status": step.status,
            "started_at": step.started_at,
            "completed_at": step.completed_at,
            "estimated_completion_time": step.estimated_completion_time,
            "error_message": step.error_message,
            "metadata_json": step.metadata_json or {},
        }
        return cls(**data)

class CreationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: str
    character_name: Optional[str] = None
    name: Optional[str] = None  # Person's name (for original image)
    age: Optional[int] = None  # Person's age (for original image)
    status: str  # Derived from steps
    current_step: Optional[str] = None  # Derived from steps
    user_id: str
    username: Optional[str] = None  # User's username (deprecated, use name instead)
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None  # Derived from steps
    steps: List[CreationStepResponse] = []
    error_message: Optional[str] = None  # Derived from failed step
    
    @classmethod
    def from_creation(cls, creation):
        """Build CreationResponse from Creation model, including steps."""
        # Use model_validate to convert Creation model to response (uses @property methods)
        response = cls.model_validate(creation)
        
        # Add username from user relationship if available
        if creation.user:
            response.username = creation.user.username
        else:
            response.username = None
        
        # Build steps list in STEPS config order (not DB order)
        # Steps should be initialized, but handle gracefully if missing (e.g., old creations)
        steps_by_name = {step.step_name: step for step in creation.steps}
        response.steps = []
        for step_config in STEPS:
            step = steps_by_name.get(step_config["name"])
            if step:
                response.steps.append(CreationStepResponse.from_step(step))
            else:
                # Step not found (shouldn't happen for new creations, but handle gracefully)
                # Create a pending step response for missing step
                dummy_step = CreationStep(
                    creation_id=creation.id,
                    step_name=step_config["name"],
                    status="pending"
                )
                response.steps.append(CreationStepResponse.from_step(dummy_step))
        
        return response
    

