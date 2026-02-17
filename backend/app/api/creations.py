"""Creation and pipeline API endpoints."""
import logging
import mimetypes
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, File, UploadFile, Form
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.database import get_db, SessionLocal
from app.models import User, Creation, CreationStep
from app.schemas.creation import (
    CreationRequest, CreationResponse, CreationStepResponse,
    MessageResponse, StepConfigResponse, PipelineActionResponse
)
from app.services.auth import get_current_user_required, get_current_user_optional
from app.config.steps import STEPS, get_step_by_name, calculate_steps_cost, get_all_step_names, get_steps_config
from app.services.pipeline import _initialize_creation_steps, execute_step, run_pipeline
from app.services.task_manager import get_task_manager
from app.utils.file_utils import delete_creation_files
from app.utils.storage import get_storage


logger = logging.getLogger(__name__)
router = APIRouter()


def _get_creation_or_404(creation_id: str, db: Session) -> Creation:
    """Fetch creation or raise 404."""
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")
    return creation


def _check_ownership(creation: Creation, user: User):
    """Check user owns the creation or is admin. Raises 403 if not."""
    if not user.is_admin and creation.user_id != user.id:
        raise HTTPException(status_code=403, detail="You don't have permission to access this creation")


# --- Public endpoints (no auth) ---

@router.get("/steps", response_model=StepConfigResponse)
def get_steps_config_endpoint():
    """Get step configuration and costs for frontend."""
    config = get_steps_config()
    total_cost = calculate_steps_cost(get_all_step_names())
    return {"steps": config, "total_cost": total_cost}


@router.get("/", response_model=List[CreationResponse])
def list_creations(
    owner: str = Query("everyone", regex="^(everyone|my)$", description="Filter by ownership"),
    status: str = Query("all", regex="^(all|completed|failed|pending|processing)$", description="Filter by status"),
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    """List creations with filters.

    - Unauthenticated: only completed creations from everyone (public gallery).
    - Authenticated, owner=everyone: all completed + all of the user's own (any status).
    - Authenticated, owner=my: only the user's own creations.

    Status filter is applied on top of the ownership filter.
    """
    # Note: Creation.status is a @property (not a column), so we filter in Python
    all_creations = (
        db.query(Creation)
        .order_by(Creation.updated_at.desc())
        .all()
    )

    if not user:
        # Unauthenticated: completed only
        results = [c for c in all_creations if c.status == "completed"]
    elif owner == "my":
        # Only user's own creations
        results = [c for c in all_creations if c.user_id == user.id]
    else:
        # everyone (authenticated): all completed + all of user's own (any status)
        results = [c for c in all_creations if c.status == "completed" or c.user_id == user.id]

    # Apply status filter
    if status != "all":
        results = [c for c in results if c.status == status]

    return [CreationResponse.from_creation(c) for c in results]


@router.post("/", response_model=CreationResponse, status_code=201)
async def create_creation(
    image_file: UploadFile = File(...),
    character_name: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_required),
):
    """Create a new creation and upload the image file.
    Pipeline must be started separately using POST /{creation_id}/start.
    """
    new_creation = Creation(
        user_id=user.id,
        character_name=character_name,
        name=user.name,
    )
    db.add(new_creation)
    db.commit()
    db.refresh(new_creation)

    _initialize_creation_steps(new_creation.id, db)

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

    db.refresh(new_creation)
    return CreationResponse.from_creation(new_creation)


@router.get("/{creation_id}", response_model=CreationResponse)
def get_creation(
    creation_id: str,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    """Get full creation status with all steps.

    Completed creations are publicly readable (gallery detail view).
    Non-completed creations require auth + ownership.
    """
    creation = _get_creation_or_404(creation_id, db)
    if creation.status != "completed":
        if not user:
            raise HTTPException(status_code=401, detail="Authentication required")
        _check_ownership(creation, user)
    return CreationResponse.from_creation(creation)


@router.patch("/{creation_id}", response_model=CreationResponse)
def update_creation(
    creation_id: str,
    update_data: CreationRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_required),
):
    """Update a creation's metadata (character_name, name, age)."""
    creation = _get_creation_or_404(creation_id, db)
    _check_ownership(creation, user)

    update_dict = update_data.model_dump(exclude_unset=True)
    if not update_dict:
        raise HTTPException(status_code=400, detail="No fields to update")

    for field, value in update_dict.items():
        setattr(creation, field, value)

    db.commit()
    db.refresh(creation)
    return CreationResponse.from_creation(creation)


@router.delete("/{creation_id}", response_model=MessageResponse)
def delete_creation(
    creation_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_required),
    task_manager=Depends(get_task_manager),
):
    """Delete a creation and its files. Cancels all running tasks."""
    creation = _get_creation_or_404(creation_id, db)
    _check_ownership(creation, user)

    cancelled = task_manager.cancel_all_tasks_for_creation(creation_id)
    if cancelled > 0:
        logger.info(f"[{creation_id}] Cancelled {cancelled} tasks before deletion")

    try:
        delete_creation_files(creation_id, creation.user_id)
    except Exception as e:
        logger.warning(f"Error deleting files for creation {creation_id}: {e}")

    db.delete(creation)
    db.commit()
    return {"message": "Creation deleted"}


@router.post("/{creation_id}/start", response_model=PipelineActionResponse)
async def start_pipeline(
    creation_id: str,
    from_step: Optional[str] = Query(None, description="Step name to start from (for retry)"),
    mock_creation_id: Optional[str] = Query(None, description="Creation ID to copy outputs from (admin testing)"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_required),
    task_manager=Depends(get_task_manager),
):
    """Start pipeline (or resume from first failed step, or restart from a specific step).

    - No params: runs from first pending/failed step
    - from_step=X: runs from step X onward
    - mock_creation_id=Y: copies outputs from creation Y instead of calling APIs (admin only)
    """
    creation = _get_creation_or_404(creation_id, db)
    _check_ownership(creation, user)

    if mock_creation_id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required for mock_creation_id")

    if from_step:
        step_names = get_all_step_names()
        if from_step not in step_names:
            raise HTTPException(status_code=400, detail=f"Invalid step name: {from_step}")

    # Check if pipeline is already running (any step processing with an active task)
    processing_steps = [s for s in creation.steps if s.status == "processing"]
    if processing_steps:
        # Check if the processing step actually has a running task (vs orphaned state)
        truly_running = [s for s in processing_steps if task_manager.is_running(creation_id, s.step_name)]
        if truly_running:
            raise HTTPException(
                status_code=400,
                detail=f"Pipeline already running (step: {truly_running[0].step_name})",
            )
        # Orphaned processing steps will be reset by execute_step

    db_session = SessionLocal()

    async def run_pipeline_task():
        try:
            await run_pipeline(
                creation_id,
                creation.user_id,
                from_step=from_step,
                mock_creation_id=mock_creation_id,
                db=db_session,
            )
        except Exception as e:
            logger.error(f"[{creation_id}] Pipeline task error: {e}", exc_info=True)
        finally:
            db_session.close()

    task_manager.create_task(creation_id, "pipeline", run_pipeline_task(), timeout=7200)

    return {
        "message": "Pipeline started",
        "creation_id": creation_id,
        "from_step": from_step or get_all_step_names()[0],
    }


@router.post("/{creation_id}/cancel", response_model=MessageResponse)
async def cancel_pipeline(
    creation_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_required),
    task_manager=Depends(get_task_manager),
):
    """Cancel all running steps for a creation."""
    creation = _get_creation_or_404(creation_id, db)
    _check_ownership(creation, user)

    # Find and cancel all processing steps
    processing_steps = db.query(CreationStep).filter(
        CreationStep.creation_id == creation_id,
        CreationStep.status == "processing",
    ).all()

    if not processing_steps:
        raise HTTPException(status_code=400, detail="No steps are currently running")

    for step in processing_steps:
        step.status = "failed"
        step.error_message = "Step cancelled by user"
    db.commit()

    cancelled = task_manager.cancel_all_tasks_for_creation(creation_id)
    logger.info(f"[{creation_id}] Cancelled {len(processing_steps)} steps, {cancelled} tasks by user {user.id}")

    return {"message": f"Cancelled {len(processing_steps)} running step(s)"}


# --- File serving (moved from files.py) ---

@router.get("/{creation_id}/files/{filename:path}")
async def serve_creation_file(
    creation_id: str,
    filename: str,
    download: bool = Query(False, description="Force download with Content-Disposition: attachment"),
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    """Serve a file for a creation. Public for previews, auth required for downloads."""
    if ".." in filename or ".." in creation_id:
        raise HTTPException(status_code=403, detail="Invalid path")

    creation = _get_creation_or_404(creation_id, db)

    # Downloads require auth + ownership
    if download:
        if not user:
            raise HTTPException(status_code=401, detail="Authentication required for downloads")
        _check_ownership(creation, user)

    user_id = creation.user_id
    storage = get_storage()

    if not storage.file_exists(user_id, creation_id, filename):
        raise HTTPException(status_code=404, detail="File not found")

    if download:
        # Force download
        try:
            file_path = storage.get_file_path(user_id, creation_id, filename)
            if file_path.exists() and file_path.is_file():
                return FileResponse(
                    file_path,
                    filename=filename,
                    media_type="application/octet-stream",
                    headers={"Content-Disposition": f"attachment; filename={filename}"},
                )
        except NotImplementedError:
            presigned_url = storage.get_file_url(user_id, creation_id, filename)
            return RedirectResponse(
                url=presigned_url,
                status_code=302,
                headers={"Content-Disposition": f"attachment; filename={filename}"},
            )
        raise HTTPException(status_code=404, detail="File not found")
    else:
        # Serve for preview
        try:
            file_path = storage.get_file_path(user_id, creation_id, filename)
            if file_path.exists() and file_path.is_file():
                mime_type, _ = mimetypes.guess_type(filename)
                headers = {
                    "Cache-Control": "public, max-age=31536000, immutable",
                    "ETag": f'"{file_path.stat().st_mtime}"',
                }
                if mime_type:
                    headers["Content-Type"] = mime_type
                return FileResponse(file_path, headers=headers)
        except NotImplementedError:
            presigned_url = storage.get_file_url(user_id, creation_id, filename)
            return RedirectResponse(
                url=presigned_url,
                status_code=302,
                headers={"Cache-Control": "public, max-age=86400"},
            )
        raise HTTPException(status_code=404, detail="File not found")
