from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Creation, User
from app.services.auth import get_current_user
from app.config.tasks import TASKS, get_task_by_name, get_next_task
from app.utils.file_utils import get_task_file_path, move_to_permanent
from app.services.pipeline import execute_task_async
import shutil
from datetime import datetime

router = APIRouter()

@router.post("/{creation_id}/tasks/{task_name}")
async def execute_task(
    creation_id: str,
    task_name: str,
    file: UploadFile = File(None),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")

    task_config = get_task_by_name(task_name)
    if not task_config:
        raise HTTPException(status_code=404, detail="Task definition not found")

    # Handle file upload for image_capture
    if task_name == "image_capture":
        if not file:
            raise HTTPException(status_code=400, detail="File upload required for image_capture")
        
        output_filename = task_config["output"]
        save_path = get_task_file_path(creation.id, user.id, output_filename, is_temp=True)
        
        with open(save_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    
    # Execute task in background
    background_tasks.add_task(execute_task_async, creation_id, user.id, task_name, db)
    
    # Return immediately with processing status
    output_file = task_config.get("output")
    file_url = None
    if output_file:
        filename = output_file.format(creation_id=creation.id)
        from app.utils.file_utils import get_file_url
        file_url = get_file_url(creation.id, user.id, filename, is_temp=True)
        
    return {
        "task_name": task_name,
        "status": "processing",
        "output_file": output_file.format(creation_id=creation.id) if output_file else None,
        "file_url": file_url
    }

@router.get("/{creation_id}/tasks/{task_name}")
def get_task_status(
    creation_id: str,
    task_name: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    # Retrieve status based on file existence and DB state
    pass # Implementation similar to progress logic

@router.post("/{creation_id}/tasks/{task_name}/retry")
async def retry_task(
    creation_id: str,
    task_name: str,
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")
        
    creation.status = "processing"
    creation.current_task = task_name
    creation.error_message = None
    db.commit()
    
    # Actually trigger the task execution
    background_tasks.add_task(execute_task_async, creation_id, user.id, task_name, db)
    
    return {"task_name": task_name, "status": "processing", "message": "Retry initiated"}

