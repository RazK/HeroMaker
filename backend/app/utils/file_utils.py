import os
import shutil
from pathlib import Path
from app.config.settings import ASSETS_ROOT

def get_creation_path(creation_id: str, user_id: str, is_temp: bool = True) -> Path:
    """Get the path for a creation's assets."""
    base_dir = "temp" if is_temp else "permanent"
    path = Path(ASSETS_ROOT) / base_dir / user_id / creation_id
    path.mkdir(parents=True, exist_ok=True)
    return path

def get_task_file_path(creation_id: str, user_id: str, filename: str, is_temp: bool = True) -> Path:
    """Get the path for a specific task file."""
    creation_path = get_creation_path(creation_id, user_id, is_temp)
    return creation_path / filename

def check_file_exists(creation_id: str, user_id: str, filename: str, is_temp: bool = True) -> bool:
    """Check if a file exists for a creation."""
    return get_task_file_path(creation_id, user_id, filename, is_temp).exists()

def list_creation_files(creation_id: str, user_id: str, is_temp: bool = True) -> list[str]:
    """List all files for a creation."""
    path = get_creation_path(creation_id, user_id, is_temp)
    if not path.exists():
        return []
    return [f.name for f in path.iterdir() if f.is_file()]

def move_to_permanent(creation_id: str, user_id: str):
    """Move creation files from temp to permanent storage."""
    temp_path = get_creation_path(creation_id, user_id, is_temp=True)
    perm_path = get_creation_path(creation_id, user_id, is_temp=False)
    
    if temp_path.exists():
        if perm_path.exists():
            shutil.rmtree(perm_path)
        shutil.move(str(temp_path), str(perm_path))

def copy_original_to_temp(creation_id: str, user_id: str):
    """Copy original.jpg from permanent to temp storage (for restarting completed creations)."""
    perm_original = get_task_file_path(creation_id, user_id, "original.jpg", is_temp=False)
    temp_original = get_task_file_path(creation_id, user_id, "original.jpg", is_temp=True)
    
    if perm_original.exists():
        # Ensure temp directory exists
        temp_path = get_creation_path(creation_id, user_id, is_temp=True)
        temp_path.mkdir(parents=True, exist_ok=True)
        
        # Copy original.jpg from permanent to temp
        shutil.copy2(str(perm_original), str(temp_original))
        return True
    return False

def get_file_url(creation_id: str, user_id: str, filename: str, is_temp: bool = True) -> str:
    """
    Get the API URL for a file.
    
    Args:
        creation_id: Creation ID
        user_id: User ID
        filename: Filename
        is_temp: Whether file is in temp or permanent storage
    
    Returns:
        URL path like /api/files/temp/{user_id}/{creation_id}/{filename}
    """
    base_path = "temp" if is_temp else "permanent"
    return f"/api/files/{base_path}/{user_id}/{creation_id}/{filename}"

