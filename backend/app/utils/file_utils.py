"""
File utilities that use the storage abstraction layer.
Maintains backward compatibility with existing function signatures.
"""
import os
import shutil
from pathlib import Path
from app.config.settings import FILES_ROOT
from app.utils.storage import get_storage

def get_creation_path(creation_id: str, user_id: str) -> Path:
    """
    Get the path for a creation's files.
    For local storage, returns the actual directory path.
    For S3 storage, returns a Path object for compatibility (but files are in S3).
    """
    storage = get_storage()
    try:
        # For local storage, get the actual directory path
        dummy_path = storage.get_file_path(user_id, creation_id, ".dummy")
        return dummy_path.parent
    except NotImplementedError:
        # For S3 storage, return a Path object for compatibility (not a real path)
        return Path(FILES_ROOT) / user_id / creation_id
    except Exception:
        # Fallback for local storage
        path = Path(FILES_ROOT) / user_id / creation_id
        path.mkdir(parents=True, exist_ok=True)
        return path

def get_task_file_path(creation_id: str, user_id: str, filename: str) -> Path:
    """
    Get the path for a specific task file.
    For local storage, returns the actual file path.
    For S3 storage, returns a Path object for compatibility (but file is in S3).
    """
    storage = get_storage()
    try:
        return storage.get_file_path(user_id, creation_id, filename)
    except NotImplementedError:
        # S3 storage doesn't support local paths - return a Path for compatibility
        # Callers should use storage methods directly instead
        return Path(FILES_ROOT) / user_id / creation_id / filename

def check_file_exists(creation_id: str, user_id: str, filename: str) -> bool:
    """Check if a file exists for a creation."""
    storage = get_storage()
    return storage.file_exists(user_id, creation_id, filename)

def list_creation_files(creation_id: str, user_id: str) -> list[str]:
    """List all files for a creation."""
    storage = get_storage()
    return storage.list_files(user_id, creation_id)

def get_file_url(creation_id: str, user_id: str, filename: str) -> str:
    """
    Get the URL for a file.
    For local storage, returns API path like /api/files/{user_id}/{creation_id}/{filename}
    For S3 storage, returns presigned URL.
    """
    storage = get_storage()
    return storage.get_file_url(user_id, creation_id, filename)
