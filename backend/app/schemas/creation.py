from datetime import datetime, timezone
from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Dict
from app.config.steps import STEPS, get_step_by_name
from app.models import CreationStep
from app.services.openai import DEFAULT_STYLE, resolve_style
from app.services import step_errors

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
    # A failed step (app/services/step_errors.py). Everyone gets error_code and
    # error_user, one safe line; error_message is that same line, except for an
    # admin, who also gets the raw provider text (error_detail) and its request
    # ID. The raw text never reaches anyone else.
    error_message: Optional[str] = None
    error_code: Optional[str] = None
    error_user: Optional[str] = None
    credits_refunded: bool = False
    error_detail: Optional[str] = None
    error_request_id: Optional[str] = None
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
    def from_step(cls, step, admin: bool = False, in_class: Optional[bool] = None):
        """Build CreationStepResponse from a CreationStep model. Safe by
        default: only ``admin=True`` carries the raw error."""
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
            "metadata_json": step.metadata_json or {},
            "progress": progress,
            "estimated_duration": config.get("estimated_duration") or step.estimated_duration,
        }
        if in_class is None:
            in_class = bool(getattr(getattr(step, "creation", None), "class_id", None))
        data.update(step_errors.response_fields(step, admin=admin, in_class=in_class))
        return cls(**data)

# The drawing is uploaded once, when the hero is created; every other file is
# the output of a step, rewritten each time that step runs again.
ORIGINAL_FILE = "original.jpg"


def _version(at: Optional[datetime]) -> Optional[str]:
    """A short token that changes whenever ``at`` does (ms since the epoch, hex)."""
    if at is None:
        return None
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    return format(int(at.timestamp() * 1000), "x")


def file_versions(creation) -> Dict[str, str]:
    """For each of the hero's files that exists, a version that changes when it does.

    The client appends it to a file's URL (``thumb_rendered.png?v=<version>``),
    which lets the API mark that URL cacheable for a year (see api/files.py):
    re-running a step gives its output a new completed_at, hence a new URL.
    A step's output is only listed once the step has completed; until then its
    URL carries no version and is revalidated on every use.
    """
    versions = {}
    created = _version(creation.created_at)
    if created:
        versions[ORIGINAL_FILE] = created
    by_name = {step.step_name: step for step in creation.steps}
    for config in STEPS:
        step = by_name.get(config["name"])
        output = config.get("output")
        if output and step is not None and step.status == "completed":
            done = _version(step.completed_at)
            if done:
                versions[output] = done
    return versions


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
    error_message: Optional[str] = None  # The failed step's error_message (safe unless admin)
    style: str = DEFAULT_STYLE  # Key of the painting's style; a NULL column reads as the default
    featured: bool = False  # Starred by an admin: shown under Editors' choice
    # Made in a class and not yet kept by a parent: private, never featured.
    in_class: bool = False
    file_versions: Dict[str, str] = {}  # file name -> version token for its URL (see file_versions)

    @classmethod
    def from_creation(cls, creation, admin: bool = False):
        """Build CreationResponse from Creation model, including steps. Safe by
        default: only ``admin=True`` carries a failed step's raw error."""
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
            error_message=None,
            style=resolve_style(creation.style),
            featured=bool(creation.featured),
            in_class=bool(getattr(creation, "class_id", None)),
            file_versions=file_versions(creation),
            steps=[],
        )
        
        # Build steps list in STEPS config order (not DB order)
        in_class = bool(getattr(creation, "class_id", None))
        steps_by_name = {step.step_name: step for step in creation.steps}
        for step_config in STEPS:
            step = steps_by_name.get(step_config["name"])
            if step:
                response.steps.append(CreationStepResponse.from_step(step, admin=admin, in_class=in_class))
            else:
                # Step not found - create a pending step response
                dummy_step = CreationStep(
                    creation_id=creation.id,
                    step_name=step_config["name"],
                    status="pending"
                )
                response.steps.append(CreationStepResponse.from_step(dummy_step, admin=admin, in_class=in_class))

        # The hero's error is its first failed step's, as that step serves it.
        if creation.status == "failed":
            response.error_message = next(
                (s.error_message for s in response.steps if s.status == "failed" and s.error_message), None
            )
        
        return response
    

