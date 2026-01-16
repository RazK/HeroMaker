"""Creation and pipeline API endpoints."""
import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query, status, File, UploadFile, Form, Body
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.database import get_db, SessionLocal
from app.models import User, Creation, CreationStep
from app.schemas.creation import CreationResponse, CreationStepResponse
from app.services.auth import get_current_user, get_current_user_required
from app.config.steps import STEPS, get_step_by_name, get_step_cost, calculate_steps_cost, get_all_step_names, get_steps_config
from app.services.pipeline import _initialize_creation_steps, _reset_step, execute_step
from app.services.task_manager import get_task_manager
import asyncio
from app.services.credits import get_balance, deduct_credits
from app.utils.file_utils import delete_creation_files, check_file_exists
from app.utils.storage import get_storage


# Note: RunPipelineRequest removed - sequential pipeline removed

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/cost")
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


@router.get("/steps/config")
def get_step_config_endpoint():
    """Get step configuration for frontend (names, display names, costs, outputs)."""
    return {"steps": get_steps_config()}


@router.get("/{creation_id}/steps/{step_name}", response_model=CreationStepResponse)
def get_step_status(
        creation_id: str,
        step_name: str,
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user)
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
        user: User = Depends(get_current_user)
):
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")
    
    return CreationResponse.from_creation(creation)


@router.get("/", response_model=List[CreationResponse])
def list_creations(
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user)
):
    """List all creations accessible to the current user."""
    if user.is_admin:
        # Admins can see all creations
        creations = db.query(Creation).order_by(Creation.updated_at.desc()).all()
    else:
        # Regular users can only see their own creations
        creations = db.query(Creation).filter(Creation.user_id == user.id).order_by(Creation.updated_at.desc()).all()
    
    return [CreationResponse.from_creation(c) for c in creations]


@router.delete("/{creation_id}")
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




@router.post("/create")
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

@router.post("/{creation_id}/steps/{step_name}/cancel")
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


@router.post("/{creation_id}/steps/{step_name}/run")
async def run_step(
        creation_id: str,
        step_name: str,
        background_tasks: BackgroundTasks = BackgroundTasks(),
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user),
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


