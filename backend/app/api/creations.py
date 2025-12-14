from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from app.database import get_db
from app.models import Creation, User
from app.schemas.creation import CreationCreate, CreationResponse, TaskResponse
from app.services.auth import get_current_user
from app.config.tasks import TASKS
from app.utils.file_utils import check_file_exists, get_creation_path
import shutil

router = APIRouter()

@router.post("/", response_model=CreationResponse)
def create_creation(
    creation: CreationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    new_creation = Creation(
        user_id=user.id,
        character_name=creation.character_name,
        current_task="image_capture",
        status="pending"
    )
    db.add(new_creation)
    db.commit()
    db.refresh(new_creation)
    
    # Hydrate tasks for response
    return hydrate_creation_response(new_creation, user.id)

@router.get("/{creation_id}", response_model=CreationResponse)
def get_creation(
    creation_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")
    
    # In V3, check ownership here
    
    return hydrate_creation_response(creation, user.id)

@router.get("/", response_model=dict)
def list_creations(
    status: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    query = db.query(Creation)
    if status:
        query = query.filter(Creation.status == status)
    
    # Filter by user in V3
    # query = query.filter(Creation.user_id == user.id)
    
    total = query.count()
    creations = query.order_by(Creation.created_at.desc()).offset(offset).limit(limit).all()
    
    return {
        "creations": [hydrate_creation_response(c, c.user_id) for c in creations],
        "total": total,
        "limit": limit,
        "offset": offset
    }

@router.patch("/{creation_id}", response_model=CreationResponse)
def update_creation(
    creation_id: str,
    creation_update: CreationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")
    
    if creation_update.character_name is not None:
        creation.character_name = creation_update.character_name
    
    db.commit()
    db.refresh(creation)
    return hydrate_creation_response(creation, user.id)

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

@router.get("/{creation_id}/progress")
def get_creation_progress(
    creation_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")
    
    completed_tasks = []
    pending_tasks = []
    
    # Determine task status based on file existence
    for task in TASKS:
        output_file = task["output"]
        if output_file:
            # Replace placeholder
            filename = output_file.format(creation_id=creation.id)
            is_temp = creation.status != "completed"
            if check_file_exists(creation.id, user.id, filename, is_temp=is_temp):
                completed_tasks.append(task["name"])
            else:
                pending_tasks.append(task["name"])
        else:
            # Special case for 'complete' task or tasks without output
            if creation.status == "completed" and task["name"] == "complete":
                completed_tasks.append(task["name"])
            else:
                pending_tasks.append(task["name"])

    total_tasks = len(TASKS)
    overall_progress = int((len(completed_tasks) / total_tasks) * 100) if total_tasks > 0 else 0
    
    return {
        "creation_id": creation.id,
        "status": creation.status,
        "current_task": creation.current_task,
        "completed_tasks": completed_tasks,
        "processing_task": creation.current_task,
        "pending_tasks": pending_tasks,
        "overall_progress": overall_progress,
        "current_task_progress": 0 # Placeholder for specific task progress
    }

def hydrate_creation_response(creation: Creation, user_id: str) -> CreationResponse:
    # Build task list with status
    tasks_resp = []
    is_temp = creation.status != "completed"
    
    for task in TASKS:
        status = "pending"
        file_url = None
        output_file = task["output"]
        
        if output_file:
            filename = output_file.format(creation_id=creation.id)
            if check_file_exists(creation.id, user_id, filename, is_temp=is_temp):
                status = "completed"
                # Construct URL
                base_path = "temp" if is_temp else "permanent"
                file_url = f"/api/files/{base_path}/{user_id}/{creation.id}/{filename}"
            elif creation.current_task == task["name"]:
                status = "processing"
        elif task["name"] == "complete" and creation.status == "completed":
             status = "completed"
             
        tasks_resp.append(TaskResponse(
            name=task["name"],
            status=status,
            output_file=output_file.format(creation_id=creation.id) if output_file else None,
            file_url=file_url
        ))
        
    response = CreationResponse.from_orm(creation)
    response.tasks = tasks_resp
    return response

