"""Creation and pipeline API endpoints."""
import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, File, UploadFile, Form
from sqlalchemy.orm import Session

from app.database import get_db, SessionLocal
from app.models import User, Creation, CreationStep
from app.schemas.creation import (
    CreationRequest, CreationResponse, CreationStepResponse,
    MessageResponse, CostResponse, StepConfigResponse, StepActionResponse, PipelineActionResponse
)
from app.services.auth import get_current_user_required, get_current_user_optional
from app.config.steps import STEPS, get_step_by_name, calculate_steps_cost, get_all_step_names, get_steps_config
from app.services.pipeline import _initialize_creation_steps, execute_step, run_pipeline
from app.services.task_manager import get_task_manager
from app.utils.file_utils import delete_creation_files
from app.utils.storage import get_storage


# Note: RunPipelineRequest removed - sequential pipeline removed

logger = logging.getLogger(__name__)
router = APIRouter()


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
):
    """Get status of a single step (for polling during processing)."""
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")
    
    step = db.query(CreationStep).filter(
        CreationStep.creation_id == creation_id,
        CreationStep.step_name == step_name
    ).first()
    
    if not step:
        raise HTTPException(status_code=404, detail=f"Step {step_name} not found")
    
    return CreationStepResponse.from_step(step)


@router.get("/{creation_id}", response_model=CreationResponse)
def get_creation(
        creation_id: str,
        db: Session = Depends(get_db),
):
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")
    
    return CreationResponse.from_creation(creation)


@router.patch("/{creation_id}", response_model=CreationResponse)
def update_creation(
        creation_id: str,
        update_data: CreationRequest,
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user_required),
):
    """Update a creation's metadata (character_name, name, age)."""
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
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

    return CreationResponse.from_creation(creation)


@router.get("/", response_model=List[CreationResponse])
def list_creations(
        db: Session = Depends(get_db),
        user: Optional[User] = Depends(get_current_user_optional),
        mine_only: bool = False
):
    """List creations. Public endpoint - shows all creations in gallery by default."""
    if mine_only and user:
        # Filter to only user's creations
        creations = db.query(Creation).filter(Creation.user_id == user.id).order_by(Creation.updated_at.desc()).all()
    else:
        # Show all creations (public gallery)
        creations = db.query(Creation).order_by(Creation.updated_at.desc()).all()
    
    return [CreationResponse.from_creation(c) for c in creations]


@router.delete("/{creation_id}", response_model=MessageResponse)
def delete_creation(
        creation_id: str,
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user_required),
        task_manager = Depends(get_task_manager)
):
    """Delete a creation and its files. Cancels all running tasks."""
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")
    
    # Check permissions (users can only delete their own creations, unless admin)
    if not user.is_admin and creation.user_id != user.id:
        raise HTTPException(status_code=403, detail="You don't have permission to delete this creation")
    
    # Cancel all running tasks for this creation
    cancelled = task_manager.cancel_all_tasks_for_creation(creation_id)
    if cancelled > 0:
        logger.info(f"[{creation_id}] Cancelled {cancelled} tasks before deletion")
    
    # Delete files
    try:
        delete_creation_files(creation_id, creation.user_id)
    except Exception as e:
        logger.warning(f"Error deleting files for creation {creation_id}: {e}")
    
    # Delete from database (cascades to steps)
    db.delete(creation)
    db.commit()
    
    return {"message": "Creation deleted"}




@router.post("/create", response_model=CreationResponse, status_code=201)
async def create_creation(
        image_file: UploadFile = File(...),
        character_name: Optional[str] = Form(None),
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user_required)
):
    """
    Create a new creation and upload the image file.
    
    This endpoint creates the creation record and uploads the image.
    The pipeline must be started separately using the /{creation_id}/run endpoint.
    """
    # Create creation record
    new_creation = Creation(
        user_id=user.id,
        character_name=character_name,
        name=user.name  # Creator's name (default to user's name)
    )
    db.add(new_creation)
    db.commit()
    db.refresh(new_creation)
    
    # Initialize steps
    _initialize_creation_steps(new_creation.id, db)
    
    # Upload image file
    try:
        storage = get_storage()
        contents = await image_file.read()
        storage.upload_file(user.id, new_creation.id, "original.jpg", contents)
        logger.info(f"Uploaded image for creation {new_creation.id}")
    except Exception as e:
        logger.error(f"Error uploading image for creation {new_creation.id}: {e}")
        db.delete(new_creation)
        db.commit()
        raise HTTPException(status_code=500, detail=f"Failed to upload image: {str(e)}")
    
    # Return creation response (no pipeline run - frontend will call /run separately)
    db.refresh(new_creation)
    return CreationResponse.from_creation(new_creation)


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
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
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
    step.status = "failed"
    step.error_message = "Step cancelled by user"
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


@router.post("/{creation_id}/steps/{step_name}/run", response_model=StepActionResponse)
async def run_step(
        creation_id: str,
        step_name: str,
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user_required),
        task_manager = Depends(get_task_manager)
):
    """Run a single step independently. Handles retry automatically."""
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
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
                        step.status = "failed"
                        step.error_message = error_msg
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
                    step.status = "failed"
                    step.error_message = error_msg
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
    step.error_message = None
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
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user_required),
        task_manager = Depends(get_task_manager)
):
    """Run full pipeline (all steps sequentially) or from a specific step.
    
    Steps are executed in order, credits deducted per-step.
    If a step fails, pipeline stops there.
    """
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
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
    
    # Check if pipeline is already running (any step processing)
    processing_steps = [s for s in creation.steps if s.status == "processing"]
    if processing_steps:
        raise HTTPException(
            status_code=400, 
            detail=f"Pipeline already running (step: {processing_steps[0].step_name})"
        )
    
    # Create a new DB session for the background task
    db_session = SessionLocal()
    
    async def run_pipeline_task():
        try:
            await run_pipeline(
                creation_id, 
                creation.user_id, 
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
    task_manager.create_task(creation_id, "pipeline", run_pipeline_task(), timeout=7200)
    
    return {
        "message": "Pipeline started",
        "creation_id": creation_id,
        "from_step": from_step or get_all_step_names()[0]
    }
