"""Creation and pipeline API endpoints."""
import logging
from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, File, UploadFile, Form
from sqlalchemy.orm import Session, selectinload

from app.database import get_db, SessionLocal
from app.models import User, Creation, CreationStep
from app.schemas.creation import (
    CreationRequest, CreationResponse, CreationStepResponse, FeaturedRequest,
    MessageResponse, CostResponse, StepConfigResponse, StepActionResponse, PipelineActionResponse
)
from fastapi.security import HTTPAuthorizationCredentials
from app.services.auth import (
    get_current_user_required, get_current_user_optional, security as bearer, verify_access_token,
)
from app.services import step_errors
from app.config.steps import STEPS, get_step_by_name, calculate_steps_cost, get_all_step_names, get_steps_config
from app.services.pipeline import (
    _initialize_creation_steps, _reset_step, execute_step, run_pipeline, steps_from, clear_stale_failures,
)
from app.services.task_manager import get_task_manager, PIPELINE_KEY
from app.services import openai as openai_service
from app.utils.file_utils import delete_creation_files
from app.utils.storage import get_storage


# Note: RunPipelineRequest removed - sequential pipeline removed

logger = logging.getLogger(__name__)
router = APIRouter()


def _checked_style(style: Optional[str]) -> Optional[str]:
    """A style the client asked for, validated against the registry. None or
    empty means "not given", and so does a retired style (an old tab, or a
    retry of a hero made in one): the hero gets, or keeps, its stored style,
    which reads as the default. Anything else unknown is the client's mistake."""
    if style is None or style == "":
        return None
    if openai_service.is_retired_style(style):
        logger.info("Retired style %r asked for; treated as no style", style)
        return None
    if not openai_service.is_valid_style(style):
        valid = ", ".join(openai_service.STYLES)
        raise HTTPException(status_code=400, detail=f"Unknown style '{style}'. Choose one of: {valid}")
    return style


def _is_admin(user: Optional[User]) -> bool:
    """Whether the caller may read a failed step's raw provider error."""
    return bool(user is not None and user.is_admin)


def _admin_or_none(
        credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
        db: Session = Depends(get_db),
) -> Optional[User]:
    """The caller, if they are an admin; None for anyone else. Never raises:
    a hero's page is public, and a stale token must not turn it into a 401."""
    user_id = verify_access_token(credentials.credentials) if credentials else None
    if not user_id:
        return None
    return db.query(User).filter(User.id == user_id, User.is_admin.is_(True), User.deleted_at.is_(None)).first()


def _live_creation(db: Session, creation_id: str) -> Optional[Creation]:
    """A creation the app may show or act on: one its owner has not deleted."""
    return (
        db.query(Creation)
        .filter(Creation.id == creation_id, Creation.deleted_at.is_(None))
        .first()
    )


@router.get("/cost", response_model=CostResponse)
def get_creation_cost(
    steps: Optional[str] = Query(None, description="Comma-separated list of step names")
):
    """Get the credit cost for running steps.
    
    If steps provided, calculates cost for those steps.
    Otherwise, returns cost for full creation pipeline (all steps).
    """
    if steps:
        step_list = [s.strip() for s in steps.split(",")]
    else:
        step_list = get_all_step_names()
    cost = calculate_steps_cost(step_list)
    return {"cost": cost}


@router.get("/steps/config", response_model=StepConfigResponse)
def get_step_config_endpoint():
    """Get step configuration for frontend (names, display names, costs, outputs)."""
    return {"steps": get_steps_config()}


@router.get("/{creation_id}/steps/{step_name}", response_model=CreationStepResponse)
def get_step_status(
        creation_id: str,
        step_name: str,
        db: Session = Depends(get_db),
        admin: Optional[User] = Depends(_admin_or_none),
):
    """Get status of a single step (for polling during processing)."""
    creation = _live_creation(db, creation_id)
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")
    
    step = db.query(CreationStep).filter(
        CreationStep.creation_id == creation_id,
        CreationStep.step_name == step_name
    ).first()
    
    if not step:
        raise HTTPException(status_code=404, detail=f"Step {step_name} not found")
    
    return CreationStepResponse.from_step(step, admin=admin is not None)


@router.get("/{creation_id}", response_model=CreationResponse)
def get_creation(
        creation_id: str,
        db: Session = Depends(get_db),
        admin: Optional[User] = Depends(_admin_or_none),
):
    creation = _live_creation(db, creation_id)
    if not creation and admin is not None:
        # An admin opening a hero they removed, from the user's page.
        from app.services import moderation
        removed = db.query(Creation).filter(Creation.id == creation_id).first()
        if removed is not None and moderation.removal_of(db, removed) is not None:
            creation = removed
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")

    return CreationResponse.from_creation(creation, admin=admin is not None)


@router.patch("/{creation_id}", response_model=CreationResponse)
def update_creation(
        creation_id: str,
        update_data: CreationRequest,
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user_required),
):
    """Update a creation's metadata (character_name, name, age)."""
    creation = _live_creation(db, creation_id)
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")

    # Check permissions
    if not user.is_admin and creation.user_id != user.id:
        raise HTTPException(status_code=403, detail="You don't have permission to update this creation")

    # Apply provided fields only
    update_dict = update_data.model_dump(exclude_unset=True)
    if not update_dict:
        raise HTTPException(status_code=400, detail="No fields to update")

    for field, value in update_dict.items():
        setattr(creation, field, value)

    db.commit()
    db.refresh(creation)

    return CreationResponse.from_creation(creation, admin=_is_admin(user))


@router.get("/", response_model=List[CreationResponse])
def list_creations(
        db: Session = Depends(get_db),
        user: Optional[User] = Depends(get_current_user_optional),
        mine_only: bool = False,
        featured_only: bool = False,
):
    """List creations for the gallery. Public endpoint.

    - mine_only (signed in): the caller's own heroes, in any state.
    - featured_only: Editors' choice, the gallery's default view - the
      finished heroes an admin has starred.
    - neither: every hero ("All heroes") for an admin. "All heroes" is an
      admin view: anyone else gets Editors' choice, so an unstarred hero is
      never listed to a visitor. A hero's own page (GET /{id}) is unaffected,
      so a shared link keeps working.
    """
    # A class hero (made by a student, not yet claimed by a parent) is in no
    # public gallery and not in its paying teacher's "My heroes": it is on the
    # class roster and the child's own page. Only an admin's "All heroes" (and
    # so "Failed") lists it, marked in_class. docs/product/class-sessions.md.
    # Each hero's steps and owner in two queries for the whole list, not two per hero.
    live = (db.query(Creation)
            .options(selectinload(Creation.steps), selectinload(Creation.user))
            .filter(Creation.deleted_at.is_(None)))
    personal = live.filter(Creation.class_id.is_(None))
    if mine_only and user:
        creations = personal.filter(Creation.user_id == user.id).order_by(Creation.updated_at.desc()).all()
    elif not featured_only and user is not None and user.is_admin:
        creations = live.order_by(Creation.updated_at.desc()).all()
    else:
        creations = personal.filter(Creation.featured.is_(True)).order_by(Creation.updated_at.desc()).all()
        # status is derived from the steps, so "finished" is checked here.
        creations = [c for c in creations if c.status == "completed"]

    admin = _is_admin(user)
    return [CreationResponse.from_creation(c, admin=admin) for c in creations]


@router.put("/{creation_id}/featured", response_model=CreationResponse)
def set_featured(
        creation_id: str,
        body: FeaturedRequest,
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user_required),
):
    """Star or unstar a hero for Editors' choice. Admins only."""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    creation = _live_creation(db, creation_id)
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")
    if body.featured and creation.class_id:
        raise HTTPException(status_code=409, detail="A class hero stays private until a parent keeps it")

    # Write updated_at back as it was: the gallery orders by it, and starring
    # a hero must not move it to the top of every view.
    db.query(Creation).filter(Creation.id == creation_id).update(
        {Creation.featured: body.featured, Creation.updated_at: Creation.updated_at},
        synchronize_session=False,
    )
    db.commit()
    db.refresh(creation)
    return CreationResponse.from_creation(creation, admin=_is_admin(user))


@router.delete("/{creation_id}", response_model=MessageResponse)
def delete_creation(
        creation_id: str,
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user_required),
        task_manager = Depends(get_task_manager)
):
    """Delete a creation and its files. Cancels all running tasks."""
    creation = _live_creation(db, creation_id)
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")
    
    # Check permissions (users can only delete their own creations, unless admin)
    if not user.is_admin and creation.user_id != user.id:
        raise HTTPException(status_code=403, detail="You don't have permission to delete this creation")
    
    # Cancel all running tasks for this creation
    cancelled = task_manager.cancel_all_tasks_for_creation(creation_id)
    if cancelled > 0:
        logger.info(f"[{creation_id}] Cancelled {cancelled} tasks before deletion")
    
    # Mark it deleted first, and only then remove its files: the old order
    # removed the files, then failed the DELETE on the ledger's foreign key,
    # and left a hero with no pictures. The row itself stays for the ledger.
    creation.deleted_at = datetime.utcnow()
    db.commit()

    try:
        delete_creation_files(creation.user_id, creation_id)
    except Exception as e:
        logger.warning(f"Error deleting files for creation {creation_id}: {e}")
    
    return {"message": "Creation deleted"}




@router.post("/create", response_model=CreationResponse, status_code=201)
async def create_creation(
        image_file: UploadFile = File(...),
        character_name: Optional[str] = Form(None),
        style: Optional[str] = Form(None),
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user_required)
):
    """
    Create a new creation and upload the image file.

    This endpoint creates the creation record and uploads the image.
    The pipeline must be started separately using the /{creation_id}/run endpoint.
    `style` (optional) is a key of GET /api/styles; it can also be given, or
    changed, when the pipeline is started.
    """
    style = _checked_style(style)
    contents = await image_file.read()
    new_creation = create_with_drawing(
        db, user.id, contents, character_name=character_name, name=user.name, style=style,
    )
    # Return creation response (no pipeline run - frontend will call /run separately)
    return CreationResponse.from_creation(new_creation, admin=_is_admin(user))


def create_with_drawing(
        db: Session,
        owner_id: str,
        contents: bytes,
        *,
        character_name: Optional[str] = None,
        name: Optional[str] = None,
        age: Optional[int] = None,
        style: Optional[str] = None,
        class_id: Optional[str] = None,
        is_public: bool = True,
) -> Creation:
    """A new hero with its steps and its drawing stored as original.jpg.

    The one way a hero comes into being: POST /create and a class student's
    hero (app/api/class_sessions.py) both go through here. `owner_id` is who
    pays for the pipeline and under whose prefix the files are stored.
    """
    new_creation = Creation(
        user_id=owner_id,
        character_name=character_name,
        name=name,  # Creator's name, shown with the drawing
        age=age,
        style=style,
        class_id=class_id,
        is_public=is_public,
    )
    db.add(new_creation)
    db.commit()
    db.refresh(new_creation)

    # Initialize steps
    _initialize_creation_steps(new_creation.id, db)

    # Upload image file
    try:
        storage = get_storage()
        storage.upload_file(owner_id, new_creation.id, "original.jpg", contents)
        logger.info(f"Uploaded image for creation {new_creation.id}")
    except Exception as e:
        logger.error(f"Error uploading image for creation {new_creation.id}: {e}")
        db.delete(new_creation)
        db.commit()
        raise HTTPException(status_code=500, detail=f"Failed to upload image: {str(e)}")

    db.refresh(new_creation)
    return new_creation


# Note: run_creation endpoint removed - sequential pipeline removed
# Users should run steps individually using run_step endpoint

@router.post("/{creation_id}/steps/{step_name}/cancel", response_model=StepActionResponse)
async def cancel_step(
        creation_id: str,
        step_name: str,
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user_required),
        task_manager = Depends(get_task_manager)
):
    """Cancel a running step."""
    creation = _live_creation(db, creation_id)
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")
    
    # Check permissions
    if not user.is_admin and creation.user_id != user.id:
        raise HTTPException(status_code=403, detail="You don't have permission to cancel this step")
    
    # Find the step
    step = db.query(CreationStep).filter(
        CreationStep.creation_id == creation_id,
        CreationStep.step_name == step_name
    ).first()
    
    if not step:
        raise HTTPException(status_code=404, detail=f"Step {step_name} not found")
    
    # Check if already cancelled
    if step.status == "failed" and step.error_message == "Step cancelled by user":
        return {
            "message": f"Step {step_name} is already cancelled",
            "creation_id": creation_id,
            "step_name": step_name,
            "already_cancelled": True
        }
    
    # Only allow canceling processing steps
    if step.status != "processing":
        raise HTTPException(status_code=400, detail=f"Step is not processing (current status: {step.status})")
    
    # Mark as cancelled in DB (source of truth for cancellation)
    step_errors.mark_failed(step, step_errors.CANCELLED_MESSAGE, code=step_errors.CANCELLED)
    db.commit()
    
    # Cancel the runtime task
    cancelled = task_manager.cancel_task(creation_id, step_name)
    
    logger.info(f"[{creation_id}] Step {step_name} cancelled by user {user.id} (task cancelled: {cancelled})")
    
    return {
        "message": f"Step {step_name} cancelled",
        "creation_id": creation_id,
        "step_name": step_name,
        "already_cancelled": False
    }


def _refuse_if_busy(creation: Creation, task_manager, except_step: Optional[str] = None) -> None:
    """400 if this creation already has a pipeline run or another step going."""
    running = [k for k in task_manager.running_for_creation(creation.id) if k != except_step]
    if PIPELINE_KEY in running:
        raise HTTPException(status_code=400, detail="Pipeline already running")
    processing = [
        s.step_name for s in creation.steps
        if s.status == "processing" and s.step_name != except_step
    ]
    busy = processing or running
    if busy:
        raise HTTPException(status_code=400, detail=f"Pipeline already running (step: {busy[0]})")


@router.post("/{creation_id}/steps/{step_name}/run", response_model=StepActionResponse)
async def run_step(
        creation_id: str,
        step_name: str,
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user_required),
        task_manager = Depends(get_task_manager)
):
    """Run a single step independently. Handles retry automatically."""
    creation = _live_creation(db, creation_id)
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")
    
    # Check permissions
    if not user.is_admin and creation.user_id != user.id:
        raise HTTPException(status_code=403, detail="You don't have permission to run this step")
    
    # Validate step_name exists
    step_config = get_step_by_name(step_name)
    if not step_config:
        raise HTTPException(status_code=404, detail=f"Step {step_name} not found")
    
    # Check if step is already running (before creating task)
    if task_manager.is_running(creation_id, step_name):
        raise HTTPException(status_code=400, detail="Step is already running")
    
    # Get step to check current status
    step = db.query(CreationStep).filter(
        CreationStep.creation_id == creation_id,
        CreationStep.step_name == step_name
    ).first()
    
    if not step:
        raise HTTPException(status_code=404, detail=f"Step {step_name} not found")

    # One thing at a time per hero. Steps feed each other (rendered.png ->
    # model.glb -> rigged.glb), so starting one while another runs either
    # fails at once on a missing input or, worse, works on a stale file from an
    # earlier run. On staging, "Try again" fired every unfinished step at once
    # and the three after the painting each failed within a second.
    _refuse_if_busy(creation, task_manager, except_step=step_name)

    # Check if already processing (double-check, in case status changed between checks)
    if step.status == "processing":
        # Double-check task manager (race condition protection)
        if task_manager.is_running(creation_id, step_name):
            raise HTTPException(status_code=400, detail="Step is already running")
        # If not running but status is processing, it's stuck - execute_step will handle it
    
    # Create task for step execution (non-blocking)
    db_session = SessionLocal()
    
    async def run_step_task():
        try:
            await execute_step(creation_id, creation.user_id, step_name, db_session, task_manager=task_manager)
        except ValueError as e:
            # Handle validation errors - mark step as failed if not already marked
            error_msg = str(e)
            if "already running" in error_msg or "stuck" in error_msg:
                logger.info(f"[{creation_id}] Step {step_name} validation: {error_msg}")
            else:
                # Validation error (e.g., input file not found, insufficient credits)
                # Mark step as failed since execute_step didn't get to mark it
                try:
                    step = db_session.query(CreationStep).filter(
                        CreationStep.creation_id == creation_id,
                        CreationStep.step_name == step_name
                    ).first()
                    if step and step.status != "failed":
                        step_errors.mark_failed(step, e)
                        db_session.commit()
                        logger.info(f"[{creation_id}] Marked step {step_name} as failed due to validation error: {error_msg}")
                except Exception as db_error:
                    logger.error(f"[{creation_id}] Failed to mark step as failed: {db_error}")
                logger.error(f"[{creation_id}] Validation error in run_step_task for {step_name}: {error_msg}")
        except Exception as e:
            # Other errors - execute_step should have marked as failed, but double-check
            error_msg = str(e)
            try:
                step = db_session.query(CreationStep).filter(
                    CreationStep.creation_id == creation_id,
                    CreationStep.step_name == step_name
                ).first()
                if step and step.status != "failed":
                    step_errors.mark_failed(step, e)
                    db_session.commit()
                    logger.info(f"[{creation_id}] Marked step {step_name} as failed due to error: {error_msg}")
            except Exception as db_error:
                logger.error(f"[{creation_id}] Failed to mark step as failed: {db_error}")
            logger.error(f"[{creation_id}] Error in run_step_task for {step_name}: {error_msg}", exc_info=True)
        finally:
            db_session.close()
    
    # Get step timeout from config
    timeout = step_config.get("timeout")  # e.g., meshy_3d: 1800s (30 min), openai_render: 300s (5 min)
    
    # Mark step as processing BEFORE creating background task (avoids race condition)
    # This ensures frontend sees "processing" status immediately when it polls
    from datetime import datetime, timedelta
    step.started_at = datetime.utcnow()
    step.status = "processing"
    step_errors.clear(step)
    step.estimated_progress = None
    if step_config.get("estimated_duration"):
        step.estimated_completion_time = step.started_at + timedelta(
            seconds=step_config["estimated_duration"]
        )
    else:
        step.estimated_completion_time = None
    db.commit()
    
    # Create and track task (TaskManager handles timeout and cleanup)
    # This returns immediately, task runs in background
    task_manager.create_task(creation_id, step_name, run_step_task(), timeout=timeout)
    
    return {
        "message": "Step execution started",
        "creation_id": creation_id,
        "step_name": step_name,
        "status": step.status,
        "started_at": step.started_at.isoformat() if step.started_at else None,
        "estimated_completion_time": step.estimated_completion_time.isoformat() if step.estimated_completion_time else None
    }


@router.post("/{creation_id}/run-pipeline", response_model=PipelineActionResponse)
async def run_pipeline_endpoint(
        creation_id: str,
        from_step: Optional[str] = Query(None, description="Step name to start from (for retry)"),
        mock_creation_id: Optional[str] = Query(None, description="Creation ID to copy outputs from (admin testing)"),
        style: Optional[str] = Query(None, description="Painting style (GET /api/styles). Omitted: the hero keeps the one it has."),
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user_required),
        task_manager = Depends(get_task_manager)
):
    """Run full pipeline (all steps sequentially) or from a specific step.

    Steps are executed in order, credits deducted per-step.
    If a step fails, pipeline stops there.

    `style` is stored on the hero before the run starts. Without it the hero
    keeps its style, which is how "Make it again" and "Try again" repeat it.
    Every style costs the same.
    """
    style = _checked_style(style)
    creation = _live_creation(db, creation_id)
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")
    
    # Check permissions
    if not user.is_admin and creation.user_id != user.id:
        raise HTTPException(status_code=403, detail="You don't have permission to run this pipeline")
    
    # mock_creation_id is admin-only
    if mock_creation_id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required for mock_creation_id")

    # Validate from_step if provided
    if from_step:
        step_names = get_all_step_names()
        if from_step not in step_names:
            raise HTTPException(status_code=400, detail=f"Invalid step name: {from_step}")
    
    from_label = start_pipeline(
        creation, db, task_manager,
        from_step=from_step, mock_creation_id=mock_creation_id, style=style,
    )
    return {
        "message": "Pipeline started",
        "creation_id": creation_id,
        "from_step": from_label,
    }


def start_pipeline(
        creation: Creation,
        db: Session,
        task_manager,
        *,
        from_step: Optional[str] = None,
        mock_creation_id: Optional[str] = None,
        style: Optional[str] = None,
) -> str:
    """Start the pipeline for a hero in the background. Returns the first step.

    Used by POST /{id}/run-pipeline and by a class student's hero
    (app/api/class_sessions.py), so both run the same pipeline.run_pipeline:
    charged per step to creation.user_id, refunded by execute_step on failure.
    Callers have checked permissions; `style` is already validated.
    """
    creation_id = creation.id

    # Already running? The DB alone cannot say: for the moment between this
    # endpoint answering and the first step starting, nothing is "processing".
    # A second tap in that window used to start a second run, and creating its
    # task cancelled the first one mid-step.
    _refuse_if_busy(creation, task_manager)

    if style is not None and style != creation.style:
        creation.style = style
        db.commit()

    # Show the run as started before answering, as run_step does: the app reads
    # the hero right after this returns, and a hero still reading "failed" (or
    # "ready", for Make it again) at that moment is never polled again, so it
    # would sit on the old state while the run goes on unseen.
    steps_to_run = steps_from(from_step)
    clear_stale_failures(creation_id, steps_to_run, db)
    first = next((s for s in creation.steps if s.step_name == steps_to_run[0]), None)
    if first is not None:
        _reset_step(first)
        first.status = "processing"
        first.started_at = datetime.utcnow()
        duration = (get_step_by_name(first.step_name) or {}).get("estimated_duration")
        if duration:
            first.estimated_completion_time = first.started_at + timedelta(seconds=duration)
        db.commit()

    # Create a new DB session for the background task
    db_session = SessionLocal()
    owner_id = creation.user_id

    async def run_pipeline_task():
        try:
            await run_pipeline(
                creation_id,
                owner_id,
                from_step=from_step,
                mock_creation_id=mock_creation_id,
                db=db_session
            )
        except Exception as e:
            logger.error(f"[{creation_id}] Pipeline task error: {e}", exc_info=True)
        finally:
            db_session.close()

    # Create pipeline task (no individual step timeout - each step has its own)
    # Use a long timeout for the entire pipeline (e.g., 2 hours)
    task_manager.create_task(creation_id, PIPELINE_KEY, run_pipeline_task(), timeout=7200)
    return from_step or get_all_step_names()[0]
