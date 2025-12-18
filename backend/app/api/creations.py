from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Query
from sqlalchemy.orm import Session, joinedload
from typing import Optional
from app.database import get_db
from app.models import Creation, User, CreationStep
from app.schemas.creation import CreationRequest, CreationResponse
from app.services.auth import get_current_user
from app.config.steps import get_step_by_name
from app.utils.file_utils import get_creation_path, get_task_file_path
from app.services.pipeline import run_pipeline_sequential, execute_step_sync, _initialize_creation_steps, _reset_step
import shutil

router = APIRouter()

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
    
    print(f"[API] PATCH /creations/{creation_id}: character_name={creation_update.character_name}, name={creation_update.name}, age={creation_update.age}")
    
    if creation_update.character_name is not None:
        creation.character_name = creation_update.character_name
        print(f"[API] Updated character_name to: {creation.character_name}")
    
    if creation_update.name is not None:
        # Convert empty string to None, otherwise use the trimmed value
        if isinstance(creation_update.name, str):
            trimmed = creation_update.name.strip()
            creation.name = trimmed if trimmed else None
        else:
            creation.name = None
        print(f"[API] Updated name to: {creation.name}")
    
    if creation_update.age is not None:
        creation.age = creation_update.age
        print(f"[API] Updated age to: {creation.age}")
    
    db.commit()
    db.refresh(creation)
    print(f"[API] After refresh - name: {creation.name}, age: {creation.age}")
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
    
    # Remove files
    path = get_creation_path(creation_id, user.id, is_temp=True)
    if path.exists():
        shutil.rmtree(path)
    path_perm = get_creation_path(creation_id, user.id, is_temp=False)
    if path_perm.exists():
        shutil.rmtree(path_perm)

    db.delete(creation)
    db.commit()
    return {"message": "Creation deleted successfully"}

@router.post("/upload", response_model=CreationResponse)
async def upload_image(
    file: UploadFile = File(...),
    character_name: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
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
    
    # Save file as original.jpg
    output_filename = "original.jpg"
    save_path = get_task_file_path(new_creation.id, user.id, output_filename, is_temp=True)
    save_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(save_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
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
    restart: bool = Query(False, description="If true, restart from step 1. If false, resume from first incomplete step."),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Run pipeline sequentially. Calls shared logic directly."""
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")
    
    # Create new DB session for background task
    from app.database import SessionLocal
    db_session = SessionLocal()
    
    # Trigger pipeline in background
    def run_pipeline_task():
        try:
            run_pipeline_sequential(creation_id, user.id, restart, db_session)
        finally:
            db_session.close()
    
    background_tasks.add_task(run_pipeline_task)
    
    return {
        "message": "Pipeline run triggered",
        "creation_id": creation_id,
        "restart": restart
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
            from app.utils.file_utils import check_file_exists
            if not check_file_exists(creation_id, user.id, dep_output, is_temp=True):
                raise HTTPException(
                    status_code=400,
                    detail=f"Dependency {step_config['depends_on']} output not found: {dep_output}"
                )
    
    # Create new DB session for background task
    from app.database import SessionLocal
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


