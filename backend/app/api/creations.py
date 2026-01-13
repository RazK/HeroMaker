import logging
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Query
from sqlalchemy.orm import Session, joinedload
from typing import Optional

from app.database import get_db, SessionLocal
from app.models import Creation, User, CreationStep
from app.schemas.creation import CreationRequest, CreationResponse
from app.services.auth import get_current_user, get_current_user_required
from app.config.steps import get_step_by_name, STEPS, get_total_creation_cost
from app.utils.file_utils import delete_creation_files, check_file_exists
from app.utils.storage import get_storage
from app.services.pipeline import run_pipeline_sequential, execute_step_sync, _initialize_creation_steps
from app.services.pipeline import _reset_step
from app.services.tokens import get_balance

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/cost")
def get_creation_cost():
    """Get the token cost for creating a new hero."""
    return {"cost": get_total_creation_cost()}


@router.get("/{creation_id}", response_model=CreationResponse)
def get_creation(
        creation_id: str,
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user)
):
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")

    # Eagerly load user relationship to include username
    db.refresh(creation, ["user"])

    # In V3, check ownership here

    return CreationResponse.from_creation(creation)


@router.get("/", response_model=dict)
def list_creations(
        status_filter: Optional[str] = Query(None, alias="status"),
        limit: int = 20,
        offset: int = 0,
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user)
):
    query = db.query(Creation).options(joinedload(Creation.steps))

    # Filter by user in V3
    # query = query.filter(Creation.user_id == user.id)

    total = query.count()
    creations = query.order_by(Creation.created_at.desc()).offset(offset).limit(limit).all()

    # Build responses using model properties
    creation_responses = [CreationResponse.from_creation(c) for c in creations]

    if status_filter:
        creation_responses = [c for c in creation_responses if c.status == status_filter]
        total = len(creation_responses)

    return {
        "creations": creation_responses,
        "total": total,
        "limit": limit,
        "offset": offset
    }


@router.patch("/{creation_id}", response_model=CreationResponse)
def update_creation(
        creation_id: str,
        creation_update: CreationRequest,
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user)
):
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")

    logger.debug(
        f"PATCH /creations/{creation_id}: character_name={creation_update.character_name}, name={creation_update.name}, age={creation_update.age}")

    if creation_update.character_name is not None:
        creation.character_name = creation_update.character_name

    if creation_update.name is not None:
        # Convert empty string to None, otherwise use the trimmed value
        if isinstance(creation_update.name, str):
            trimmed = creation_update.name.strip()
            creation.name = trimmed if trimmed else None
        else:
            creation.name = None

    if creation_update.age is not None:
        creation.age = creation_update.age

    db.commit()
    db.refresh(creation)
    # Eagerly load user relationship
    db.refresh(creation, ["user"])
    return CreationResponse.from_creation(creation)


@router.delete("/{creation_id}")
def delete_creation(
        creation_id: str,
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user)
):
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")

    # Remove files using storage abstraction
    delete_creation_files(user.id, creation_id)

    db.delete(creation)
    db.commit()
    return {"message": "Creation deleted successfully"}


@router.post("/upload", response_model=CreationResponse)
async def upload_image(
        file: UploadFile = File(...),
        character_name: Optional[str] = None,
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user_required)
):
    """Upload image file. Creates creation if needed, resets all steps, does NOT start pipeline."""
    # Create new creation
    new_creation = Creation(
        user_id=user.id,
        character_name=character_name
    )
    db.add(new_creation)
    db.commit()
    db.refresh(new_creation)

    # Save file as original.jpg using storage abstraction
    output_filename = "original.jpg"
    storage = get_storage()
    # Read file data
    file.file.seek(0)  # Reset file pointer
    file_data = file.file.read()
    # Upload using storage abstraction (handles both local and S3)
    storage.upload_file(user.id, new_creation.id, output_filename, file_data)

    # Initialize steps
    _initialize_creation_steps(new_creation.id, db)

    # Reset all steps to pending (new upload = fresh start)
    steps = db.query(CreationStep).filter(CreationStep.creation_id == new_creation.id).all()
    for step in steps:
        _reset_step(step)
    db.commit()

    # Return creation response (pipeline not started yet)
    db.refresh(new_creation)
    return CreationResponse.from_creation(new_creation)


@router.post("/{creation_id}/run")
async def run_creation(
        creation_id: str,
        step_name: Optional[str] = Query(None,
                                         description="Optional step name to start from. If None, starts from beginning (step 0)."),
        retry_all_following: bool = Query(True,
                                          description="If true and step_name provided, resets step and all following steps. If false, only resets the specified step."),
        background_tasks: BackgroundTasks = BackgroundTasks(),
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user_required)
):
    """
    Run pipeline sequentially.
    
    - If step_name is None: Always start from beginning (step 0)
    - If step_name is provided: Start from that step, optionally resetting all following steps
    """
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")

    # If step_name is provided, validate it exists and reset steps accordingly
    if step_name:
        step_config = get_step_by_name(step_name)
        if not step_config:
            raise HTTPException(status_code=404, detail=f"Step {step_name} not found")

        # Find step index
        step_index = next((i for i, s in enumerate(STEPS) if s["name"] == step_name), None)
        if step_index is None:
            raise HTTPException(status_code=404, detail=f"Step {step_name} not found in STEPS")

        # Reset this step and optionally all following steps
        all_steps = db.query(CreationStep).filter(CreationStep.creation_id == creation_id).all()
        steps_by_name = {s.step_name: s for s in all_steps}

        if retry_all_following:
            # Reset this step and all following steps
            for i in range(step_index, len(STEPS)):
                step_to_reset = steps_by_name.get(STEPS[i]["name"])
                if step_to_reset:
                    _reset_step(step_to_reset)
        else:
            # Reset only this step
            step_to_reset = steps_by_name.get(step_name)
            if step_to_reset:
                _reset_step(step_to_reset)

        db.commit()
        # When step_name is provided, we start from that step
        start_from_step = step_name
        restart = False  # We've already reset steps, so don't restart from beginning
    else:
        # No step_name: always start from beginning
        start_from_step = None
        restart = True

    # Check tokens BEFORE starting background task (only for fresh starts)
    if restart and start_from_step is None:
        cost = get_total_creation_cost()
        if cost > 0:
            balance = get_balance(user.id, db)
            if balance < cost:
                raise HTTPException(
                    status_code=402,
                    detail=f"Insufficient tokens. Need {cost}, have {balance}"
                )

    # Create new DB session for background task
    db_session = SessionLocal()

    # Trigger pipeline in background
    def run_pipeline_task():
        try:
            run_pipeline_sequential(creation_id, user.id, restart, db_session, start_from_step=start_from_step)
        finally:
            db_session.close()

    background_tasks.add_task(run_pipeline_task)

    return {
        "message": "Pipeline run triggered",
        "creation_id": creation_id,
        "step_name": step_name,
        "retry_all_following": retry_all_following
    }


@router.post("/{creation_id}/steps/{step_name}/run")
async def run_step(
        creation_id: str,
        step_name: str,
        background_tasks: BackgroundTasks = BackgroundTasks(),
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user)
):
    """Run a single step. Validates dependencies, executes in background."""
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")

    # Validate step_name exists
    step_config = get_step_by_name(step_name)
    if not step_config:
        raise HTTPException(status_code=404, detail=f"Step {step_name} not found")

    # Validate dependencies
    if step_config.get("depends_on"):
        dep_step_config = get_step_by_name(step_config["depends_on"])
        if dep_step_config and dep_step_config.get("output"):
            dep_output = dep_step_config["output"]
            if "{creation_id}" in dep_output:
                dep_output = dep_output.format(creation_id=creation_id)
            if not check_file_exists(creation_id, user.id, dep_output):
                raise HTTPException(
                    status_code=400,
                    detail=f"Dependency {step_config['depends_on']} output not found: {dep_output}"
                )

    # Create new DB session for background task
    db_session = SessionLocal()

    # Execute step in background
    def run_step_task():
        try:
            execute_step_sync(creation_id, user.id, step_name, db_session)
        finally:
            db_session.close()

    background_tasks.add_task(run_step_task)

    return {
        "message": "Step execution started",
        "creation_id": creation_id,
        "step_name": step_name
    }


@router.post("/{creation_id}/steps/{step_name}/reset-and-run")
async def reset_and_run_from_step(
        creation_id: str,
        step_name: str,
        background_tasks: BackgroundTasks = BackgroundTasks(),
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user)
):
    """Reset a step and all following steps to pending, then run pipeline from that step."""
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")

    # Validate step_name exists
    step_config = get_step_by_name(step_name)
    if not step_config:
        raise HTTPException(status_code=404, detail=f"Step {step_name} not found")

    # Find step index
    step_index = next((i for i, s in enumerate(STEPS) if s["name"] == step_name), None)
    if step_index is None:
        raise HTTPException(status_code=404, detail=f"Step {step_name} not found in STEPS")

    # Reset this step and all following steps
    all_steps = db.query(CreationStep).filter(CreationStep.creation_id == creation_id).all()
    steps_by_name = {s.step_name: s for s in all_steps}

    for i in range(step_index, len(STEPS)):
        step_to_reset = steps_by_name.get(STEPS[i]["name"])
        if step_to_reset:
            _reset_step(step_to_reset)

    db.commit()

    # Create new DB session for background task
    db_session = SessionLocal()

    # Run pipeline from this step
    def run_pipeline_task():
        try:
            run_pipeline_sequential(creation_id, user.id, restart=False, db=db_session)
        finally:
            db_session.close()

    background_tasks.add_task(run_pipeline_task)

    return {
        "message": "Steps reset and pipeline started",
        "creation_id": creation_id,
        "step_name": step_name
    }
