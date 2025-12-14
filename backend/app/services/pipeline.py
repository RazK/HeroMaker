"""
Pipeline Orchestration Service - Executes tasks in the creation pipeline.
"""

import shutil
from pathlib import Path
from sqlalchemy.orm import Session
from datetime import datetime
from app.models import Creation
from app.config.tasks import TASKS, get_task_by_name, get_next_task
from app.utils.file_utils import (
    get_task_file_path,
    check_file_exists,
    get_file_url
)
from app.services import image_processing
from app.services import chatgpt
from app.services import meshy
from app.services import vrm_conversion


def get_task_input_path(creation_id: str, user_id: str, input_filename: str, is_temp: bool = True) -> Path:
    """Resolve input file path from previous task."""
    return get_task_file_path(creation_id, user_id, input_filename, is_temp=is_temp)


def get_task_output_path(creation_id: str, user_id: str, output_filename: str, is_temp: bool = True) -> Path:
    """Resolve output file path."""
    # Handle format placeholders
    if "{creation_id}" in output_filename:
        output_filename = output_filename.format(creation_id=creation_id)
    return get_task_file_path(creation_id, user_id, output_filename, is_temp=is_temp)


def execute_task(creation_id: str, user_id: str, task_name: str, db: Session) -> dict:
    """
    Execute a single pipeline task.
    
    Args:
        creation_id: Creation ID
        user_id: User ID
        task_name: Name of task to execute
        db: Database session
    
    Returns:
        Dict with task status and output info
    """
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if not creation:
        raise ValueError(f"Creation {creation_id} not found")
    
    task_config = get_task_by_name(task_name)
    if not task_config:
        raise ValueError(f"Task {task_name} not found")
    
    # Check dependencies
    if task_config.get("depends_on"):
        dep_task = get_task_by_name(task_config["depends_on"])
        if dep_task and dep_task.get("output"):
            dep_output = dep_task["output"].format(creation_id=creation_id)
            if not check_file_exists(creation_id, user_id, dep_output, is_temp=True):
                raise ValueError(f"Dependency {task_config['depends_on']} output not found")
    
    # Update creation status
    creation.current_task = task_name
    creation.status = "processing"
    creation.error_message = None
    db.commit()
    
    is_temp = creation.status != "completed"
    
    try:
        # Route to appropriate service
        if task_name == "image_capture":
            # This is handled in the endpoint (file upload)
            # Just mark as completed if file exists
            output_filename = task_config["output"]
            if check_file_exists(creation_id, user_id, output_filename, is_temp=True):
                result = {"status": "completed", "output_file": output_filename}
            else:
                result = {"status": "processing", "output_file": output_filename}
        
        elif task_name == "image_processing":
            input_filename = task_config["input"]
            output_filename = task_config["output"]
            input_path = get_task_input_path(creation_id, user_id, input_filename, is_temp)
            output_path = get_task_output_path(creation_id, user_id, output_filename, is_temp)
            
            image_processing.process_image(input_path, output_path)
            result = {"status": "completed", "output_file": output_filename}
        
        elif task_name == "chatgpt_render":
            input_filename = task_config["input"]
            output_filename = task_config["output"]
            input_path = get_task_input_path(creation_id, user_id, input_filename, is_temp)
            output_path = get_task_output_path(creation_id, user_id, output_filename, is_temp)
            
            chatgpt.render_image(input_path, output_path)
            result = {"status": "completed", "output_file": output_filename}
        
        elif task_name == "meshy_3d":
            input_filename = task_config["input"]
            output_filename = task_config["output"]
            input_path = get_task_input_path(creation_id, user_id, input_filename, is_temp)
            output_path = get_task_output_path(creation_id, user_id, output_filename, is_temp)
            
            # Create Meshy task (async - returns task_id immediately)
            # Use T-pose for optimal rigging results (Meshy best practice)
            task_id = meshy.create_image_to_3d_task(input_path, pose_mode="t-pose")
            
            # Store task_id in metadata
            metadata = creation.metadata_json or {}
            metadata["meshy_3d_task_id"] = task_id
            creation.metadata_json = metadata
            db.commit()
            
            # Note: Actual file download will happen in polling function
            result = {
                "status": "processing",
                "output_file": output_filename,
                "meshy_task_id": task_id
            }
        
        elif task_name == "meshy_rig":
            # Get meshy_3d task_id from metadata
            metadata = creation.metadata_json or {}
            input_task_id = metadata.get("meshy_3d_task_id")
            
            if not input_task_id:
                raise ValueError("No meshy_3d_task_id found in metadata")
            
            # Create rigging task
            rig_task_id = meshy.create_rigging_task(input_task_id)
            
            # Store rig_task_id
            metadata["meshy_rig_task_id"] = rig_task_id
            creation.metadata_json = metadata
            db.commit()
            
            output_filename = task_config["output"]
            result = {
                "status": "processing",
                "output_file": output_filename,
                "meshy_task_id": rig_task_id
            }
        
        elif task_name == "meshy_animate":
            # Get rig_task_id from metadata
            metadata = creation.metadata_json or {}
            rig_task_id = metadata.get("meshy_rig_task_id")
            
            if not rig_task_id:
                raise ValueError("No rig_task_id found in metadata")
            
            # Create animation task
            anim_task_id = meshy.create_animation_task(rig_task_id, action_id="idle")
            
            # Store anim_task_id
            metadata["meshy_animate_task_id"] = anim_task_id
            creation.metadata_json = metadata
            db.commit()
            
            output_filename = task_config["output"]
            result = {
                "status": "processing",
                "output_file": output_filename,
                "meshy_task_id": anim_task_id
            }
        
        elif task_name == "select_glb":
            # Simple copy: use animated.glb as selected.glb
            input_filename = task_config["input"]
            output_filename = task_config["output"]
            input_path = get_task_input_path(creation_id, user_id, input_filename, is_temp)
            output_path = get_task_output_path(creation_id, user_id, output_filename, is_temp)
            
            output_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(input_path, output_path)
            
            result = {"status": "completed", "output_file": output_filename}
        
        elif task_name == "convert_vrm":
            input_filename = task_config["input"]
            output_filename = task_config["output"].format(creation_id=creation_id)
            input_path = get_task_input_path(creation_id, user_id, input_filename, is_temp)
            output_path = get_task_output_path(creation_id, user_id, output_filename, is_temp)
            
            vrm_conversion.convert_glb_to_vrm(input_path, output_path)
            result = {"status": "completed", "output_file": output_filename}
        
        elif task_name == "complete":
            # Move files to permanent and mark as complete
            from app.utils.file_utils import move_to_permanent
            move_to_permanent(creation_id, user_id)
            creation.status = "completed"
            creation.current_task = None
            creation.completed_at = datetime.utcnow()
            db.commit()
            
            result = {"status": "completed", "output_file": None}
        
        else:
            raise ValueError(f"Unknown task: {task_name}")
        
        # Update creation if task completed synchronously
        if result.get("status") == "completed":
            creation.updated_at = datetime.utcnow()
            db.commit()
        
        return result
        
    except Exception as e:
        # Mark creation as failed
        creation.status = "failed"
        creation.error_message = str(e)
        creation.updated_at = datetime.utcnow()
        db.commit()
        raise


def execute_task_async(creation_id: str, user_id: str, task_name: str, db: Session):
    """
    Execute task asynchronously and auto-trigger next task on success.
    This is called from FastAPI BackgroundTasks.
    """
    try:
        result = execute_task(creation_id, user_id, task_name, db)
        
        # If task completed successfully and has output, trigger next task
        if result.get("status") == "completed":
            next_task = get_next_task(task_name)
            if next_task:
                # Recursively trigger next task
                execute_task_async(creation_id, user_id, next_task["name"], db)
        
        # For Meshy async tasks, start polling in background
        elif result.get("meshy_task_id"):
            # Use threading for async polling
            import threading
            thread = threading.Thread(
                target=poll_meshy_task_async,
                args=(creation_id, user_id, result["meshy_task_id"], task_name, result.get("output_file"), db)
            )
            thread.daemon = True
            thread.start()
    
    except Exception as e:
        # Error already logged in execute_task
        print(f"Task {task_name} failed: {e}")


def poll_meshy_task_async(
    creation_id: str,
    user_id: str,
    task_id: str,
    task_type: str,
    output_filename: str,
    db: Session
):
    """
    Poll Meshy task and download result when complete.
    Then trigger next task.
    """
    import time
    from app.services.meshy import MeshyClient, MeshyAPIError
    
    client = MeshyClient()
    
    # Determine status function based on task type
    status_funcs = {
        "meshy_3d": client.get_image_to_3d_status,
        "meshy_rig": client.get_rigging_status,
        "meshy_animate": client.get_animation_status,
    }
    
    status_func = status_funcs.get(task_type)
    if not status_func:
        raise ValueError(f"Unknown Meshy task type: {task_type}")
    
    # Poll until complete
    poll_interval = 10  # seconds
    max_wait = 3600  # 1 hour
    
    start_time = time.time()
    while True:
        try:
            status = status_func(task_id)
            current_status = status.get("status", "UNKNOWN")
            progress = status.get("progress", 0)
            
            if current_status == "SUCCEEDED" and progress >= 100:
                # Download file
                # Rigging API returns result.rigged_character_glb_url (not model_urls.glb)
                if task_type == "meshy_rig":
                    result_url = (
                        status.get("result", {}).get("rigged_character_glb_url") or
                        status.get("rigged_character_glb_url")
                    )
                else:
                    result_url = (
                        status.get("model_urls", {}).get("glb") or
                        status.get("result", {}).get("model_urls", {}).get("glb") or
                        status.get("result", {}).get("glb") or
                        status.get("glb")
                    )
                
                if not result_url:
                    raise MeshyAPIError(f"No download URL in response: {status}")
                
                output_path = get_task_file_path(creation_id, user_id, output_filename, is_temp=True)
                client.download_file(result_url, output_path)
                
                # Update creation
                creation = db.query(Creation).filter(Creation.id == creation_id).first()
                if creation:
                    creation.updated_at = datetime.utcnow()
                    db.commit()
                
                # Trigger next task
                next_task = get_next_task(task_type)
                if next_task:
                    execute_task_async(creation_id, user_id, next_task["name"], db)
                
                return
            
            elif current_status == "FAILED":
                error_msg = status.get("error", {}).get("message", "Unknown error")
                creation = db.query(Creation).filter(Creation.id == creation_id).first()
                if creation:
                    creation.status = "failed"
                    creation.error_message = f"Meshy task failed: {error_msg}"
                    db.commit()
                raise MeshyAPIError(f"Task {task_id} failed: {error_msg}")
            
            elapsed = time.time() - start_time
            if elapsed > max_wait:
                raise MeshyAPIError(f"Task {task_id} timed out after {max_wait} seconds")
            
            time.sleep(poll_interval)
        
        except MeshyAPIError:
            raise
        except Exception as e:
            print(f"Error polling Meshy task {task_id}: {e}")
            time.sleep(poll_interval)

