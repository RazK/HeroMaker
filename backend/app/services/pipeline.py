"""
Pipeline Orchestration Service - Modular pipeline execution with synchronous step execution.
"""
import time
import logging
from pathlib import Path
from typing import Optional, Dict, Any, Callable
from datetime import datetime, timedelta
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from app.models import Creation, CreationStep
from app.config.steps import STEPS, get_step_by_name
from app.database import SessionLocal
from app.utils.file_utils import (
    get_task_file_path,
    check_file_exists,
    move_to_permanent
)
from app.services import image_processing
from app.services import chatgpt
from app.services import meshy
from app.services import vrm_conversion
from app.services.meshy import MeshyClient, MeshyAPIError


# ============================================================================
# Helper Functions
# ============================================================================

def _initialize_creation_steps(creation_id: str, db: Session) -> None:
    """Create CreationStep records for all steps if they don't exist."""
    for step_config in STEPS:
        existing = db.query(CreationStep).filter(
            CreationStep.creation_id == creation_id,
            CreationStep.step_name == step_config["name"]
        ).first()
        
        if not existing:
            step = CreationStep(
                creation_id=creation_id,
                step_name=step_config["name"],
                status="pending",
                estimated_duration=step_config.get("estimated_duration")  # Set from config
            )
            db.add(step)
    
    db.commit()


def _get_creation_step(creation_id: str, step_name: str, db: Session) -> CreationStep:
    """Get existing CreationStep record by creation_id and step_name."""
    step = db.query(CreationStep).filter(
        CreationStep.creation_id == creation_id,
        CreationStep.step_name == step_name
    ).first()
    
    if not step:
        raise ValueError(f"CreationStep not found for creation_id={creation_id}, step_name={step_name}. Steps should be initialized first.")
    
    return step


def _reset_step(step: CreationStep) -> None:
    """Reset a step to pending state."""
    step.status = "pending"
    step.started_at = None
    step.completed_at = None
    step.error_message = None
    step.estimated_progress = None
    step.estimated_completion_time = None


def _get_step_start_index(creation_id: str, restart: bool, db: Session) -> int:
    """Determine starting index for pipeline execution."""
    if restart:
        return 0
    
    # Find last completed step, start from next one
    steps_by_name = {s.step_name: s for s in db.query(CreationStep).filter(
        CreationStep.creation_id == creation_id
    ).all()}
    
    start_index = 0
    for i, step_config in enumerate(STEPS):
        step = steps_by_name.get(step_config["name"])
        if step and step.status == "completed":
            start_index = i + 1
        else:
            break
    
    return start_index


# ============================================================================
# Meshy Sync Wrappers with Shared Polling
# ============================================================================

def _extract_3d_download_url(status: dict) -> str:
    """Extract download URL from 3D task status."""
    result_url = (
        status.get("model_urls", {}).get("glb") or
        status.get("result", {}).get("model_urls", {}).get("glb") or
        status.get("result", {}).get("glb") or
        status.get("glb")
    )
    if not result_url:
        raise MeshyAPIError(f"No download URL found in 3D status response: {status}")
    return result_url


def _extract_rig_download_url(status: dict) -> str:
    """Extract download URL from rigging task status."""
    result_url = (
        status.get("result", {}).get("rigged_character_glb_url") or
        status.get("rigged_character_glb_url")
    )
    if not result_url:
        raise MeshyAPIError(f"No download URL found in rigging status response: {status}")
    return result_url


def _poll_meshy_task_with_progress(
    task_id: str,
    status_func: Callable[[str], dict],
    step: CreationStep,
    db: Session,
    get_download_url: Callable[[dict], str],
    poll_interval: int = 3
) -> str:
    """
    Shared polling logic for all Meshy tasks.
    Polls status_func(task_id) every poll_interval seconds (default 3s).
    Updates step.estimated_progress in DB on each poll.
    Returns download URL when status=SUCCEEDED and progress>=100.
    """
    max_wait = 3600  # 1 hour
    start_time = time.time()
    
    while True:
        status = status_func(task_id)
        current_status = status.get("status", "UNKNOWN")
        progress = status.get("progress", 0)
        
        # Update progress in DB (only when progress changes)
        if step.estimated_progress != progress:
            step.estimated_progress = progress
            step.updated_at = datetime.utcnow()
            
            # Recalculate estimated_completion_time when progress changes
            if progress > 0 and step.started_at:
                elapsed = (datetime.utcnow() - step.started_at).total_seconds()
                if elapsed > 0:
                    # Calculate: if X% done in Y seconds, total time = Y / (X/100)
                    estimated_total_duration = elapsed / (progress / 100.0)
                    step.estimated_completion_time = step.started_at + timedelta(seconds=estimated_total_duration)
                    remaining = estimated_total_duration - elapsed
                    logger.info(f"[{step.creation_id}] {step.step_name} progress: {progress}% (elapsed: {elapsed:.1f}s, remaining: ~{remaining:.1f}s)")
            
            db.commit()
        
        # Check if complete
        if current_status == "SUCCEEDED" and progress >= 100:
            return get_download_url(status)
        
        # Check for failure
        if current_status == "FAILED":
            error_msg = status.get("error", {}).get("message", "Unknown error")
            raise MeshyAPIError(f"Meshy task {task_id} failed: {error_msg}")
        
        # Check timeout
        elapsed = time.time() - start_time
        if elapsed > max_wait:
            raise MeshyAPIError(f"Meshy task {task_id} timed out after {max_wait} seconds")
        
        time.sleep(poll_interval)


def execute_meshy_3d_sync(
    task_id: str,
    output_path: Path,
    step: CreationStep,
    db: Session,
    client: MeshyClient
) -> None:
    """Poll 3D task until complete, download file. Task should already be created."""
    # Poll until complete (updates progress in DB)
    download_url = _poll_meshy_task_with_progress(
        task_id,
        client.get_image_to_3d_status,
        step,
        db,
        _extract_3d_download_url
    )
    
    # Download file
    client.download_file(download_url, output_path)


def execute_meshy_rig_sync(
    input_task_id: str,
    output_path: Path,
    step: CreationStep,
    db: Session,
    client: MeshyClient
) -> None:
    """Create rigging task, poll until complete, download file."""
    # Create task
    task_id = client.create_rigging_task(input_task_id)
    
    # Poll until complete (updates progress in DB)
    download_url = _poll_meshy_task_with_progress(
        task_id,
        client.get_rigging_status,
        step,
        db,
        _extract_rig_download_url
    )
    
    # Download file
    client.download_file(download_url, output_path)


# ============================================================================
# Step Execution Logic
# ============================================================================

def execute_step_sync(creation_id: str, user_id: str, step_name: str, db: Session) -> dict:
    """
    Execute a single step synchronously.
    Validates dependencies, executes step, updates DB.
    """
    step_config = get_step_by_name(step_name)
    if not step_config:
        raise ValueError(f"Step {step_name} not found")
    
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if not creation:
        raise ValueError(f"Creation {creation_id} not found")
    
    step = _get_creation_step(creation_id, step_name, db)
    
    # Skip if already completed
    if step.status == "completed":
        return {"status": "completed"}
    
    # Reset if failed
    if step.status == "failed":
        _reset_step(step)
    
    # Validate dependencies
    if step_config.get("depends_on"):
        dep_step_config = get_step_by_name(step_config["depends_on"])
        if dep_step_config and dep_step_config.get("output"):
            dep_output = dep_step_config["output"]
            if "{creation_id}" in dep_output:
                dep_output = dep_output.format(creation_id=creation_id)
            if not check_file_exists(creation_id, user_id, dep_output, is_temp=True):
                raise ValueError(f"Dependency {step_config['depends_on']} output not found: {dep_output}")
    
    # Determine if temp based on whether all steps are completed
    all_steps = db.query(CreationStep).filter(CreationStep.creation_id == creation_id).all()
    is_temp = not all(s.status == "completed" for s in all_steps)
    
    # Update step: processing
    step.started_at = datetime.utcnow()
    step.status = "processing"
    step.error_message = None
    step.estimated_progress = None
    
    # Initialize estimated_completion_time using estimated_duration if available
    if step.estimated_duration:
        step.estimated_completion_time = step.started_at + timedelta(seconds=step.estimated_duration)
        logger.info(f"[{creation_id}] Starting step: {step_name} (estimated duration: {step.estimated_duration}s)")
    else:
        step.estimated_completion_time = None
        logger.info(f"[{creation_id}] Starting step: {step_name}")
    
    db.commit()
    
    # Execute step
    try:
        output_filename = step_config.get("output")
        
        if step_name == "image_processing":
            logger.info(f"[{creation_id}] Executing image_processing...")
            input_path = get_task_file_path(creation_id, user_id, step_config["input"], is_temp)
            output_path = get_task_file_path(creation_id, user_id, output_filename, is_temp)
            image_processing.process_image(input_path, output_path)
            
        elif step_name == "chatgpt_render":
            logger.info(f"[{creation_id}] Executing chatgpt_render (this may take 1-2 minutes)...")
            input_path = get_task_file_path(creation_id, user_id, step_config["input"], is_temp)
            output_path = get_task_file_path(creation_id, user_id, output_filename, is_temp)
            chatgpt.render_image(input_path, output_path)
            
        elif step_name == "meshy_3d":
            logger.info(f"[{creation_id}] Executing meshy_3d (this may take 3-5 minutes)...")
            input_path = get_task_file_path(creation_id, user_id, step_config["input"], is_temp)
            output_path = get_task_file_path(creation_id, user_id, output_filename, is_temp)
            client = MeshyClient()
            # Create task and get task_id before polling
            logger.info(f"[{creation_id}] Creating Meshy 3D task...")
            task_id = client.create_image_to_3d_task(input_path, pose_mode="t-pose")
            logger.info(f"[{creation_id}] Meshy 3D task created: {task_id}, starting polling...")
            # Store task_id in metadata for meshy_rig dependency
            metadata = creation.metadata_json or {}
            metadata["meshy_3d_task_id"] = task_id
            creation.metadata_json = metadata
            db.commit()
            # Poll and download (task already created)
            execute_meshy_3d_sync(task_id, output_path, step, db, client)
            
        elif step_name == "meshy_rig":
            logger.info(f"[{creation_id}] Executing meshy_rig (this may take 3-5 minutes)...")
            # Get meshy_3d task_id from metadata
            metadata = creation.metadata_json or {}
            input_task_id = metadata.get("meshy_3d_task_id")
            if not input_task_id:
                raise ValueError("No meshy_3d_task_id found in metadata")
            
            output_path = get_task_file_path(creation_id, user_id, output_filename, is_temp)
            client = MeshyClient()
            logger.info(f"[{creation_id}] Creating Meshy rigging task for task_id: {input_task_id}...")
            execute_meshy_rig_sync(input_task_id, output_path, step, db, client)
            
        elif step_name == "convert_vrm":
            logger.info(f"[{creation_id}] Executing convert_vrm...")
            input_path = get_task_file_path(creation_id, user_id, step_config["input"], is_temp)
            output_path = get_task_file_path(creation_id, user_id, output_filename, is_temp)
            vrm_conversion.convert_glb_to_vrm(input_path, output_path)
            
        elif step_name == "complete":
            logger.info(f"[{creation_id}] Executing complete (moving files to permanent storage)...")
            move_to_permanent(creation_id, user_id)
            
        else:
            raise ValueError(f"Unknown step: {step_name}")
        
        # Update step: completed
        step.completed_at = datetime.utcnow()
        step.status = "completed"
        step.estimated_progress = 100
        step.estimated_completion_time = step.completed_at  # Set to actual completion time
        duration = (step.completed_at - step.started_at).total_seconds()
        db.commit()
        logger.info(f"[{creation_id}] Step {step_name} completed in {duration:.1f}s")
        
        return {"status": "completed"}
        
    except Exception as e:
        # Update step: failed
        # Re-query step to ensure we have a fresh object for commit
        step = db.query(CreationStep).filter(
            CreationStep.creation_id == creation_id,
            CreationStep.step_name == step_name
        ).first()
        if step:
            step.status = "failed"
            step.error_message = str(e)
            db.commit()
        logger.error(f"[{creation_id}] Step {step_name} failed: {str(e)}", exc_info=True)
        raise


# ============================================================================
# Pipeline Runner
# ============================================================================

def run_pipeline_sequential(creation_id: str, user_id: str, restart: bool, db: Session) -> None:
    """
    Run pipeline sequentially from appropriate starting point.
    Initializes/resets steps as needed, then executes each step in order.
    """
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if not creation:
        raise ValueError(f"Creation {creation_id} not found")
    
    logger.info(f"[{creation_id}] Starting pipeline (restart={restart})")
    
    # Initialize steps if needed
    _initialize_creation_steps(creation_id, db)
    
    # Determine starting point
    start_index = _get_step_start_index(creation_id, restart, db)
    
    # Reset incomplete steps to pending
    steps_by_name = {s.step_name: s for s in db.query(CreationStep).filter(
        CreationStep.creation_id == creation_id
    ).all()}
    
    for i in range(start_index, len(STEPS)):
        step_config = STEPS[i]
        step = steps_by_name.get(step_config["name"])
        if step:
            _reset_step(step)
    
    db.commit()
    
    if start_index >= len(STEPS):
        logger.info(f"[{creation_id}] All steps already completed")
        return  # All steps complete
    
    logger.info(f"[{creation_id}] Starting from step {start_index + 1}/{len(STEPS)}: {STEPS[start_index]['name']}")
    
    # Execute steps sequentially
    for i, step_config in enumerate(STEPS[start_index:], start=start_index + 1):
        step_name = step_config["name"]
        step = _get_creation_step(creation_id, step_name, db)
        
        # Skip if already completed
        if step.status == "completed":
            logger.info(f"[{creation_id}] Step {i}/{len(STEPS)}: {step_name} already completed, skipping")
            continue
        
        logger.info(f"[{creation_id}] Step {i}/{len(STEPS)}: {step_name}")
        # Execute step (blocks until complete)
        execute_step_sync(creation_id, user_id, step_name, db)
    
    logger.info(f"[{creation_id}] Pipeline completed successfully")
