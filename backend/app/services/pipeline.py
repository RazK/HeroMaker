"""
Pipeline Orchestration Service - Async step execution with coroutines.
Steps are executed as async coroutines with DB-level locking, reconciliation, and timeout support.
"""
import time
import logging
import tempfile
import threading
import asyncio
from pathlib import Path
from typing import Optional, Dict, Any, Callable, List
from datetime import datetime, timedelta
from contextlib import contextmanager
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

logger = logging.getLogger(__name__)

# Note: Task tracking moved to TaskManager in app state (main.py)

from app.models import Creation, CreationStep
from app.config.steps import STEPS, get_step_by_name, get_step_cost, get_all_step_names
from app.database import SessionLocal
from app.utils.file_utils import (
    check_file_exists,
    get_file_url,
    upload_file_to_storage,
    download_file_from_storage
)
from app.utils.storage import get_storage
from app.services import image_processing
from app.services import openai as openai_service
from app.services import meshy
from app.services import vrm_conversion
from app.services.meshy import MeshyClient, MeshyAPIError
from app.services.credits import get_balance, deduct_credits


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
    step.metadata_json = {}  # Clear step-specific metadata


def _copy_file_from_mock_creation(mock_creation_id: str, filename: str, target_user_id: str, target_creation_id: str, db: Session) -> None:
    """Copy a file from mock creation to target creation."""
    mock_creation = db.query(Creation).filter(Creation.id == mock_creation_id).first()
    if not mock_creation:
        raise ValueError(f"Mock creation {mock_creation_id} not found")
    
    mock_user_id = mock_creation.user_id
    file_data = download_file_from_storage(mock_user_id, mock_creation_id, filename)
    upload_file_to_storage(target_user_id, target_creation_id, filename, file_data)


@contextmanager
def _get_file_path_for_processing(creation_id: str, user_id: str, filename: str, mode: str = "r"):
    """
    Context manager to get a file path for processing.
    For local storage, returns the actual file path.
    For S3 storage, downloads to a temporary file and cleans up after.
    
    Args:
        creation_id: Creation ID
        user_id: User ID
        filename: Filename
        mode: File mode ('r' for read, 'w' for write)
    
    Yields:
        Path object to the file (local or temporary)
    """
    storage = get_storage()
    
    # Check if storage supports local file paths
    try:
        # Try to get local file path (works for local storage)
        file_path = storage.get_file_path(user_id, creation_id, filename)
        if mode == "r" and not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        yield file_path
        # For write mode with local storage, file is already saved at file_path
        # No additional action needed
    except NotImplementedError:
        # S3 storage - use temporary files
        if mode == "r":
            # Download from S3 to temporary file
            file_data = storage.download_file(user_id, creation_id, filename)
            with tempfile.NamedTemporaryFile(delete=False, suffix=Path(filename).suffix) as tmp_file:
                tmp_file.write(file_data)
                tmp_path = Path(tmp_file.name)
            try:
                yield tmp_path
            finally:
                # Clean up temporary file
                if tmp_path.exists():
                    tmp_path.unlink()
        else:  # mode == "w"
            # Create temporary file, upload to S3 after writing
            with tempfile.NamedTemporaryFile(delete=False, suffix=Path(filename).suffix) as tmp_file:
                tmp_path = Path(tmp_file.name)
            try:
                yield tmp_path
                # Upload to S3 after writing
                if tmp_path.exists():
                    file_data = tmp_path.read_bytes()
                    storage.upload_file(user_id, creation_id, filename, file_data)
            finally:
                # Clean up temporary file
                if tmp_path.exists():
                    tmp_path.unlink()




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
    """Create rigging task, poll until complete, download file, and download animations if available."""
    # Create task
    logger.info(f"[{step.creation_id}] Creating rigging task with input_task_id: {input_task_id}")
    task_id = client.create_rigging_task(input_task_id)
    logger.info(f"[{step.creation_id}] Rigging task created: {task_id}")
    
    # Store rig_task_id in metadata
    if not step.metadata_json:
        step.metadata_json = {}
    step.metadata_json["rig_task_id"] = task_id
    flag_modified(step, "metadata_json")  # Tell SQLAlchemy the JSON field changed
    db.commit()
    
    # Poll until complete (updates progress in DB)
    download_url = _poll_meshy_task_with_progress(
        task_id,
        client.get_rigging_status,
        step,
        db,
        _extract_rig_download_url
    )
    
    # Download rigged.glb file
    client.download_file(download_url, output_path)
    logger.info(f"[{step.creation_id}] Downloaded rigged.glb to {output_path}")
    
    # Get final rigging status to check for basic_animations
    try:
        final_rig_status = client.get_rigging_status(task_id)
        basic_animations = final_rig_status.get("result", {}).get("basic_animations")
        
        if basic_animations:
            # Get user_id from creation
            creation = db.query(Creation).filter(Creation.id == step.creation_id).first()
            if not creation:
                logger.warning(f"[{step.creation_id}] Creation not found, skipping animation download")
                return
            user_id = creation.user_id
            
            # Download walking.glb if available and upload to storage
            walking_glb_url = basic_animations.get("walking_glb_url")
            if walking_glb_url:
                # Download to temporary file first
                with tempfile.NamedTemporaryFile(delete=False, suffix=".glb") as tmp_file:
                    tmp_path = Path(tmp_file.name)
                try:
                    client.download_file(walking_glb_url, tmp_path)
                    # Upload to storage (S3 or local filesystem)
                    walking_file_data = tmp_path.read_bytes()
                    upload_file_to_storage(user_id, step.creation_id, "walking.glb", walking_file_data)
                    step.metadata_json["walking_glb_url"] = "walking.glb"
                    flag_modified(step, "metadata_json")  # Tell SQLAlchemy the JSON field changed
                    db.commit()
                    logger.info(f"[{step.creation_id}] Downloaded and uploaded walking.glb to storage")
                except Exception as e:
                    logger.error(f"[{step.creation_id}] Failed to download/upload walking.glb: {e}")
                finally:
                    # Clean up temporary file
                    if tmp_path.exists():
                        tmp_path.unlink()
        else:
            logger.info(f"[{step.creation_id}] No basic_animations found in rigging response")
    except MeshyAPIError as e:
        logger.error(f"[{step.creation_id}] Failed to get final rigging status for animations: {e}")


# ============================================================================
# Step Coroutines (Async)
# ============================================================================

async def step_image_processing(creation_id: str, user_id: str, db: Session) -> None:
    """Process image: original.jpg → processed.jpg"""
    storage = get_storage()
    loop = asyncio.get_event_loop()
    
    with _get_file_path_for_processing(creation_id, user_id, "original.jpg", "r") as input_path:
        with _get_file_path_for_processing(creation_id, user_id, "processed.jpg", "w") as output_path:
            await loop.run_in_executor(
                None,
                lambda: image_processing.process_image(input_path, output_path)
            )


async def step_openai_render(creation_id: str, user_id: str, db: Session) -> None:
    """Render image: processed.jpg → rendered.png"""
    storage = get_storage()
    loop = asyncio.get_event_loop()
    
    with _get_file_path_for_processing(creation_id, user_id, "processed.jpg", "r") as input_path:
        with _get_file_path_for_processing(creation_id, user_id, "rendered.png", "w") as output_path:
            await loop.run_in_executor(
                None,
                lambda: openai_service.render_image(input_path, output_path)
            )


async def step_meshy_3d(creation_id: str, user_id: str, db: Session) -> None:
    """Generate 3D model: rendered.png → model.glb"""
    storage = get_storage()
    loop = asyncio.get_event_loop()
    client = MeshyClient()
    
    with _get_file_path_for_processing(creation_id, user_id, "rendered.png", "r") as input_path:
        # Create task (sync call)
        task_id = await loop.run_in_executor(
            None,
            lambda: client.create_image_to_3d_task(input_path, pose_mode="t-pose")
        )
        
        logger.info(f"[{creation_id}] Meshy 3D task created: {task_id}")
        
        # Store task_id in DB for meshy_rig dependency
        step = _get_creation_step(creation_id, "meshy_3d", db)
        step.metadata_json = {"meshy_3d_task_id": task_id}
        flag_modified(step, "metadata_json")
        db.commit()
        
        # Poll and download (sync call)
        with _get_file_path_for_processing(creation_id, user_id, "model.glb", "w") as output_path:
            await loop.run_in_executor(
                None,
                lambda: execute_meshy_3d_sync(task_id, output_path, step, db, client)
            )


async def step_meshy_rig(creation_id: str, user_id: str, db: Session) -> None:
    """Rig 3D model: model.glb → rigged.glb"""
    storage = get_storage()
    loop = asyncio.get_event_loop()
    
    # Get meshy_3d task_id from meshy_3d step metadata
    meshy_3d_step = db.query(CreationStep).filter(
        CreationStep.creation_id == creation_id,
        CreationStep.step_name == "meshy_3d"
    ).first()
    
    if not meshy_3d_step:
        raise ValueError("meshy_3d step not found")
    
    step_metadata = meshy_3d_step.metadata_json or {}
    input_task_id = step_metadata.get("meshy_3d_task_id")
    if not input_task_id:
        raise ValueError("No meshy_3d_task_id found in meshy_3d step metadata")
    
    client = MeshyClient()
    step = _get_creation_step(creation_id, "meshy_rig", db)
    
    with _get_file_path_for_processing(creation_id, user_id, "rigged.glb", "w") as output_path:
        await loop.run_in_executor(
            None,
            lambda: execute_meshy_rig_sync(input_task_id, output_path, step, db, client)
        )


async def step_convert_vrm(creation_id: str, user_id: str, db: Session) -> None:
    """Convert GLB to VRM: rigged.glb → avatar.vrm"""
    storage = get_storage()
    loop = asyncio.get_event_loop()
    
    with _get_file_path_for_processing(creation_id, user_id, "rigged.glb", "r") as input_path:
        with _get_file_path_for_processing(creation_id, user_id, "avatar.vrm", "w") as output_path:
            # Try to find rendered.png as thumbnail
            if storage.file_exists(user_id, creation_id, "rendered.png"):
                with _get_file_path_for_processing(creation_id, user_id, "rendered.png", "r") as thumbnail_path:
                    await loop.run_in_executor(
                        None,
                        lambda: vrm_conversion.convert_glb_to_vrm(input_path, output_path, thumbnail_path=thumbnail_path)
                    )
            else:
                await loop.run_in_executor(
                    None,
                    lambda: vrm_conversion.convert_glb_to_vrm(input_path, output_path, thumbnail_path=None)
                )


# Step coroutine registry
STEP_COROUTINES = {
    "image_processing": step_image_processing,
    "openai_render": step_openai_render,
    "meshy_3d": step_meshy_3d,
    "meshy_rig": step_meshy_rig,
    "convert_vrm": step_convert_vrm,
}


def get_step_coroutine(step_name: str):
    """Get step coroutine by name."""
    return STEP_COROUTINES.get(step_name)


# ============================================================================
# Execute Step Function (Async) - Simplified
# ============================================================================

async def execute_step(
    creation_id: str,
    user_id: str,
    step_name: str,
    db: Session,
    mock_creation_id: Optional[str] = None,
    task_manager = None
) -> dict:
    """
    Execute a single step. Simplified flow (one step at a time invariant):
    1. Validate step exists
    2. Check input file exists
    3. Check/deduct credits
    4. Mark as processing
    5. Execute step (or mock)
    6. Mark completed/failed
    """
    step_config = get_step_by_name(step_name)
    if not step_config:
        raise ValueError(f"Step {step_name} not found")
    
    storage = get_storage()
    
    # Get step record
    step = db.query(CreationStep).filter(
        CreationStep.creation_id == creation_id,
        CreationStep.step_name == step_name
    ).first()
    
    if not step:
        raise ValueError(f"Step {step_name} not found")
    
    # Reset step if retrying (failed or completed state)
    if step.status in ("failed", "completed"):
        _reset_step(step)
        db.commit()
    
    # Validate input file exists
    input_filename = step_config.get("input")
    if input_filename and not storage.file_exists(user_id, creation_id, input_filename):
        step.status = "failed"
        step.error_message = f"Input file not found: {input_filename}"
        db.commit()
        raise ValueError(f"Input file not found: {input_filename}")
    
    # Validate meshy_rig dependency (needs meshy_3d task_id)
    if step_name == "meshy_rig":
        meshy_3d_step = db.query(CreationStep).filter(
            CreationStep.creation_id == creation_id,
            CreationStep.step_name == "meshy_3d"
        ).first()
        if not meshy_3d_step:
            step.status = "failed"
            step.error_message = "meshy_3d step not found"
            db.commit()
            raise ValueError("meshy_3d step not found")
        
        task_id = (meshy_3d_step.metadata_json or {}).get("meshy_3d_task_id")
        if not task_id:
            step.status = "failed"
            step.error_message = "meshy_3d step must be completed first"
            db.commit()
            raise ValueError("meshy_3d step must be completed first")
    
    # Check and deduct credits
    step_cost = step_config.get("credit_cost", 0)
    if step_cost > 0:
        balance = get_balance(user_id, db)
        if balance < step_cost:
            step.status = "failed"
            step.error_message = f"Insufficient credits. Need {step_cost}, have {balance}"
            db.commit()
            raise ValueError(f"Insufficient credits. Need {step_cost}, have {balance}")
        deduct_credits(user_id, step_cost, db, reason=f"step:{step_name}")
        logger.info(f"[{creation_id}] Deducted {step_cost} credits for step {step_name}")
    
    # Mark as processing (only if not already set by API endpoint)
    if step.status != "processing" or not step.started_at:
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
    logger.info(f"[{creation_id}] Starting step: {step_name}")
    
    # Execute step
    try:
        # Check if cancelled before execution
        db.refresh(step)
        if step.status == "failed" and step.error_message == "Step cancelled by user":
            return {"status": "cancelled"}
        
        if mock_creation_id:
            # Mock mode: Copy output file from mock creation
            output_filename = step_config.get("output")
            if not output_filename:
                raise ValueError(f"Step {step_name} has no output file to copy")
            
            logger.info(f"[{creation_id}] Mock mode: Copying {output_filename} from {mock_creation_id}")
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: _copy_file_from_mock_creation(
                    mock_creation_id, output_filename, user_id, creation_id, db
                )
            )
            
            # Copy meshy_3d metadata for meshy_rig dependency
            if step_name == "meshy_3d":
                mock_step = db.query(CreationStep).filter(
                    CreationStep.creation_id == mock_creation_id,
                    CreationStep.step_name == "meshy_3d"
                ).first()
                if mock_step and mock_step.metadata_json:
                    step.metadata_json = mock_step.metadata_json.copy()
                    flag_modified(step, "metadata_json")
                    db.commit()
        else:
            # Normal mode: Execute step coroutine
            step_coro = get_step_coroutine(step_name)
            if not step_coro:
                raise ValueError(f"Step coroutine not found for {step_name}")
            await step_coro(creation_id, user_id, db)
        
        # Check if cancelled during execution
        db.refresh(step)
        if step.status == "failed" and step.error_message == "Step cancelled by user":
            return {"status": "cancelled"}
        
        # Verify output file was created
        output_filename = step_config.get("output")
        if output_filename and not storage.file_exists(user_id, creation_id, output_filename):
            raise FileNotFoundError(f"Output file {output_filename} was not created")
        
        # Mark as completed
        step.completed_at = datetime.utcnow()
        step.status = "completed"
        step.estimated_progress = 100
        step.estimated_completion_time = step.completed_at
        duration = (step.completed_at - step.started_at).total_seconds()
        db.commit()
        logger.info(f"[{creation_id}] Step {step_name} completed in {duration:.1f}s")
        
        return {"status": "completed"}
        
    except Exception as e:
        # Mark as failed (unless already cancelled)
        db.refresh(step)
        if not (step.status == "failed" and step.error_message == "Step cancelled by user"):
            step.status = "failed"
            step.error_message = str(e)
            db.commit()
            logger.error(f"[{creation_id}] Step {step_name} failed: {str(e)}", exc_info=True)
        raise


# ============================================================================
# Run Pipeline (Full Sequence)
# ============================================================================

async def run_pipeline(
    creation_id: str,
    user_id: str,
    from_step: Optional[str] = None,
    mock_creation_id: Optional[str] = None,
    db: Session = None
) -> dict:
    """Run full pipeline from first step (or from_step if specified).
    
    Executes steps sequentially, stops on failure.
    Credits deducted per-step by execute_step().
    
    Args:
        creation_id: The creation to process
        user_id: The user who owns the creation
        from_step: Optional step name to start from (for retry scenarios)
        mock_creation_id: Optional creation ID to copy outputs from (for testing)
        db: Database session
    
    Returns:
        dict with "status" ("completed" or "failed") and optionally "failed_step"
    """
    steps_to_run = get_all_step_names()
    
    # If from_step specified, start from there
    if from_step:
        if from_step not in steps_to_run:
            raise ValueError(f"Step {from_step} not found")
        start_idx = steps_to_run.index(from_step)
        steps_to_run = steps_to_run[start_idx:]
    
    logger.info(f"[{creation_id}] Starting pipeline with steps: {steps_to_run}")
    
    for step_name in steps_to_run:
        try:
            result = await execute_step(creation_id, user_id, step_name, db, mock_creation_id)
            
            # Check for cancellation or failure
            if result.get("status") == "cancelled":
                logger.info(f"[{creation_id}] Pipeline stopped: step {step_name} was cancelled")
                return {"status": "cancelled", "stopped_step": step_name}
            
            if result.get("status") != "completed":
                logger.info(f"[{creation_id}] Pipeline stopped: step {step_name} did not complete")
                return {"status": "failed", "failed_step": step_name}
                
        except Exception as e:
            logger.error(f"[{creation_id}] Pipeline failed at step {step_name}: {e}")
            return {"status": "failed", "failed_step": step_name, "error": str(e)}
    
    logger.info(f"[{creation_id}] Pipeline completed successfully")
    return {"status": "completed"}
