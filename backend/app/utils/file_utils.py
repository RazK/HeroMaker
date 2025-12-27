import os
import shutil
from pathlib import Path
from app.config.settings import FILES_ROOT

def get_creation_path(creation_id: str, user_id: str) -> Path:
    """Get the path for a creation's files."""
    path = Path(FILES_ROOT) / user_id / creation_id
    path.mkdir(parents=True, exist_ok=True)
    return path

def get_task_file_path(creation_id: str, user_id: str, filename: str) -> Path:
    """Get the path for a specific task file."""
    creation_path = get_creation_path(creation_id, user_id)
    return creation_path / filename

def check_file_exists(creation_id: str, user_id: str, filename: str) -> bool:
    """Check if a file exists for a creation."""
    return get_task_file_path(creation_id, user_id, filename).exists()

def list_creation_files(creation_id: str, user_id: str) -> list[str]:
    """List all files for a creation."""
    path = get_creation_path(creation_id, user_id)
    if not path.exists():
        return []
    return [f.name for f in path.iterdir() if f.is_file()]

def get_file_url(creation_id: str, user_id: str, filename: str) -> str:
    """
    Get the API URL for a file.
    
    Args:
        creation_id: Creation ID
        user_id: User ID
        filename: Filename
    
    Returns:
        URL path like /api/files/{user_id}/{creation_id}/{filename}
    """
    return f"/api/files/{user_id}/{creation_id}/{filename}"
