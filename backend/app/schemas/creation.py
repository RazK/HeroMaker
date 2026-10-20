from datetime import datetime, timedelta, timezone
from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Optional, List, Dict
from app.config.steps import STEPS, get_step_by_name
from app.models import CreationStep
from app.services.openai import DEFAULT_STYLE, resolve_style
from app.services import step_errors
from app.utils.cutout import CUTOUT_VERSION

# Who drew it: the polaroid's "by Lia, 6". Its owner sets it (the Rename
# sheet), so it is bounded like any text a person types for others to read.
ARTIST_NAME_MAX = 40
ARTIST_AGE_MAX = 120


class CreationRequest(BaseModel):
    character_name: Optional[str] = None
    # The artist's name; empty clears it (the polaroid then shows the
    # account's display name).
    name: Optional[str] = None
    age: Optional[int] = Field(None, ge=1, le=ARTIST_AGE_MAX)

    @field_validator('name')
    @classmethod
    def _artist_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = " ".join(v.split())
        if len(v) > ARTIST_NAME_MAX:
            raise ValueError(f"Keep the name to {ARTIST_NAME_MAX} characters")
        return v

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
    # How many credits the failed step's refund gave back, when it recorded that.
    refunded_credits: Optional[int] = None
    # Admins only, from the ledger (credits.step_billing): what the failed
    # attempt was charged; 0 when it never got as far as its charge.
    charged_credits: Optional[int] = None
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

# A step is charged just before it starts; a charge older than this before
# the failed attempt started belongs to an earlier attempt.
_CHARGE_SLACK = timedelta(seconds=60)


def _bill(view: "CreationStepResponse", step, entry: Optional[dict]) -> None:
    """What the ledger says the failed attempt cost: charged, and given back.
    The ledger is the truth; the step's refund marker is newer than many refunds."""
    started = step.started_at
    if entry is None or started is None or entry["at"] is None or entry["at"] < started - _CHARGE_SLACK:
        view.charged_credits, view.refunded_credits = 0, None
        return
    view.charged_credits = entry["charged"]
    view.refunded_credits = entry["refunded"] or None
    view.credits_refunded = entry["refunded"] > 0


PAINTING = "rendered.png"

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


def painting_look(creation) -> Optional[str]:
    """CreationResponse.painting: see services/painting_cut.py."""
    from app.services.painting_cut import painting_look as look
    return look(creation)


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
    # The painting's derived files (thumb_ and cut_rendered.png) also change
    # when the cut-out algorithm does: fold its version in, so every browser
    # fetches the new cut instead of the copy it cached for a year.
    if PAINTING in versions:
        versions[PAINTING] = f"{versions[PAINTING]}c{CUTOUT_VERSION}"
    return versions


class CreationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: str
    character_name: Optional[str] = None
    name: Optional[str] = None  # Who drew it: the artist's name, else the owner's display name
    age: Optional[int] = None  # The artist's age
    status: str  # Derived from steps
    # The owner's id: the files live under it (/api/files/<user_id>/<id>/...).
    # An opaque UUID, not a credential: nobody signs in with it.
    user_id: str
    # The owner's login name. Half of a sign-in (username + password), so it
    # goes only to the owner and to admins, never to the public gallery.
    username: Optional[str] = None
    # Admins only: the owner's display name, for "whose hero is this".
    owner_name: Optional[str] = None
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
    # How the painting stands on a plate (services/painting_cut.py): "cut"
    # (show cut_rendered.png), "transparent" (it needs no cut), "framed" (no
    # confident cut: show it in a polaroid frame), or None until decided.
    painting: Optional[str] = None

    @classmethod
    def from_creation(cls, creation, admin: bool = False, viewer_id: Optional[str] = None,
                      billing: Optional[dict] = None):
        """Build CreationResponse from Creation model, including steps. Safe by
        default: only ``admin=True`` carries a failed step's raw error and the
        owner's account details (and ``billing``, from credits.step_billing:
        what each failed step was charged and given back), and only the owner (``viewer_id``) or an
        admin gets the owner's login name."""
        owner = creation.user
        private = admin or (viewer_id is not None and viewer_id == creation.user_id)
        # Build response manually to avoid issues with removed properties
        response = cls(
            id=creation.id,
            character_name=creation.character_name,
            # Never the login name: an unnamed drawing reads as the owner's
            # display name, as the gallery shows it.
            name=creation.name or (owner.name if owner else None),
            age=creation.age,
            status=creation.status,
            user_id=creation.user_id,
            username=owner.username if owner and private else None,
            owner_name=owner.name if owner and admin else None,
            created_at=creation.created_at,
            updated_at=creation.updated_at,
            completed_at=creation.completed_at,
            error_message=None,
            style=resolve_style(creation.style),
            featured=bool(creation.featured),
            in_class=bool(getattr(creation, "class_id", None)),
            file_versions=file_versions(creation),
            painting=painting_look(creation),
            steps=[],
        )
        
        # Build steps list in STEPS config order (not DB order)
        in_class = bool(getattr(creation, "class_id", None))
        steps_by_name = {step.step_name: step for step in creation.steps}
        for step_config in STEPS:
            step = steps_by_name.get(step_config["name"])
            if step:
                view = CreationStepResponse.from_step(step, admin=admin, in_class=in_class)
                if admin and billing is not None and step.status == "failed":
                    _bill(view, step, billing.get((creation.id, step.step_name)))
                response.steps.append(view)
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
    

