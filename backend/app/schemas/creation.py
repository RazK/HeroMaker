from datetime import datetime
from pydantic import BaseModel, ConfigDict
from typing import Optional, List

class CreationRequest(BaseModel):
    character_name: Optional[str] = None

class CreationStepResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    step_name: str
    status: str  # pending, processing, completed, failed
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    estimated_completion_time: Optional[datetime] = None  # Calculated completion time, updated when progress changes
    error_message: Optional[str] = None
    
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
        }
        return cls(**data)

class CreationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: str
    character_name: Optional[str] = None
    status: str  # Derived from steps
    current_step: Optional[str] = None  # Derived from steps
    user_id: str
    created_at: datetime
    completed_at: Optional[datetime] = None  # Derived from steps
    steps: List[CreationStepResponse] = []
    error_message: Optional[str] = None  # Derived from failed step
    
    @classmethod
    def from_creation(cls, creation):
        """Build CreationResponse from Creation model, including steps."""
        from app.config.steps import STEPS
        
        # Use model_validate to convert Creation model to response (uses @property methods)
        response = cls.model_validate(creation)
        
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
                from app.models import CreationStep
                # Create a pending step response for missing step
                dummy_step = CreationStep(
                    creation_id=creation.id,
                    step_name=step_config["name"],
                    status="pending"
                )
                response.steps.append(CreationStepResponse.from_step(dummy_step))
        
        return response
    

