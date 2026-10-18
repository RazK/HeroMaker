from datetime import datetime
from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from app.config.steps import STEPS, get_step_by_name
from app.models import CreationStep
from app.services.openai import DEFAULT_STYLE, resolve_style

class CreationRequest(BaseModel):
    character_name: Optional[str] = None
    name: Optional[str] = None
    age: Optional[int] = None

class MessageResponse(BaseModel):
    message: str

class FeaturedRequest(BaseModel):
    featured: bool

class CostResponse(BaseModel):
    cost: int

class StepConfigResponse(BaseModel):
    steps: list

class StepActionResponse(BaseModel):
    message: str
    creation_id: str
    step_name: str
    status: Optional[str] = None
    started_at: Optional[datetime] = None
    estimated_completion_time: Optional[datetime] = None
    already_cancelled: Optional[bool] = None

class PipelineActionResponse(BaseModel):
    message: str
    creation_id: str
    from_step: str

class CreationStepResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    step_name: str
    status: str  # pending, processing, completed, failed
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    estimated_completion_time: Optional[datetime] = None  # Calculated completion time, updated when progress changes
    error_message: Optional[str] = None
    metadata_json: Optional[dict] = None  # Step-specific metadata (e.g., Meshy API task IDs, animation URLs)
    # 0-100 as the PROVIDER reported it: Meshy's task progress, which the
    # pipeline's poller stores every 3 s. None while a step runs means the
    # provider reports nothing (the OpenAI render, VRM conversion), and the
    # screen estimates from elapsed time against `estimated_duration`.
    # A completed step reads 100.
    progress: Optional[int] = None
    # The step's typical length in seconds, from the step config.
    estimated_duration: Optional[int] = None

    @classmethod
    def from_step(cls, step):
        """Build CreationStepResponse from a CreationStep model."""
        progress = step.estimated_progress
        if progress is not None:
            progress = max(0, min(100, int(progress)))
        config = get_step_by_name(step.step_name) or {}
        data = {
            "step_name": step.step_name,
            "status": step.status,
            "started_at": step.started_at,
            "completed_at": step.completed_at,
            "estimated_completion_time": step.estimated_completion_time,
            "error_message": step.error_message,
            "metadata_json": step.metadata_json or {},
            "progress": progress,
            "estimated_duration": config.get("estimated_duration") or step.estimated_duration,
        }
        return cls(**data)

class CreationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: str
    character_name: Optional[str] = None
    name: Optional[str] = None  # Creator's name (user who created this)
    age: Optional[int] = None  # Person's age (for original image)
    status: str  # Derived from steps
    user_id: str
    username: Optional[str] = None  # User's username (deprecated, use name instead)
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None  # Derived from steps
    steps: List[CreationStepResponse] = []
    error_message: Optional[str] = None  # Derived from failed step
    style: str = DEFAULT_STYLE  # Key of the painting's style; a NULL column reads as the default
    featured: bool = False  # Starred by an admin: shown under Editors' choice
    # Made in a class and not yet kept by a parent: private, never featured.
    in_class: bool = False

    @classmethod
    def from_creation(cls, creation):
        """Build CreationResponse from Creation model, including steps."""
        # Build response manually to avoid issues with removed properties
        response = cls(
            id=creation.id,
            character_name=creation.character_name,
            name=creation.name or (creation.user.username if creation.user else None),
            age=creation.age,
            status=creation.status,
            user_id=creation.user_id,
            username=creation.user.username if creation.user else None,
            created_at=creation.created_at,
            updated_at=creation.updated_at,
            completed_at=creation.completed_at,
            error_message=creation.error_message,
            style=resolve_style(creation.style),
            featured=bool(creation.featured),
            in_class=bool(getattr(creation, "class_id", None)),
            steps=[],
        )
        
        # Build steps list in STEPS config order (not DB order)
        steps_by_name = {step.step_name: step for step in creation.steps}
        for step_config in STEPS:
            step = steps_by_name.get(step_config["name"])
            if step:
                response.steps.append(CreationStepResponse.from_step(step))
            else:
                # Step not found - create a pending step response
                dummy_step = CreationStep(
                    creation_id=creation.id,
                    step_name=step_config["name"],
                    status="pending"
                )
                response.steps.append(CreationStepResponse.from_step(dummy_step))
        
        return response
    

