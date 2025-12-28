"""
File utilities that use the storage abstraction layer.
Maintains backward compatibility with existing function signatures.
"""
from app.utils.storage import get_storage

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

def upload_file_to_storage(user_id: str, creation_id: str, filename: str, file_data: bytes) -> str:
    """
    Upload a file to storage (S3 or local filesystem).
    
    Args:
        user_id: User ID
        creation_id: Creation ID
        filename: Filename
        file_data: File data as bytes
    
    Returns:
        Storage path or S3 key
    """
    storage = get_storage()
    return storage.upload_file(user_id, creation_id, filename, file_data)

def download_file_from_storage(user_id: str, creation_id: str, filename: str) -> bytes:
    """
    Download a file from storage (S3 or local filesystem).
    
    Args:
        user_id: User ID
        creation_id: Creation ID
        filename: Filename
    
    Returns:
        File data as bytes
    """
    storage = get_storage()
    return storage.download_file(user_id, creation_id, filename)

def delete_file_from_storage(user_id: str, creation_id: str, filename: str) -> None:
    """
    Delete a file from storage (S3 or local filesystem).
    
    Args:
        user_id: User ID
        creation_id: Creation ID
        filename: Filename
    """
    storage = get_storage()
    storage.delete_file(user_id, creation_id, filename)

def delete_creation_files(user_id: str, creation_id: str) -> None:
    """
    Delete all files for a creation from storage (S3 or local filesystem).
    
    Args:
        user_id: User ID
        creation_id: Creation ID
    """
    storage = get_storage()
    files = storage.list_files(user_id, creation_id)
    for filename in files:
        storage.delete_file(user_id, creation_id, filename)
    
    # For local storage, also remove empty directories
    from app.utils.storage import LocalFileStorage
    if isinstance(storage, LocalFileStorage):
        try:
            path = storage.get_file_path(user_id, creation_id, ".dummy")
            creation_dir = path.parent
            if creation_dir.exists() and not any(creation_dir.iterdir()):
                creation_dir.rmdir()
                # Try to remove user directory if empty
                user_dir = creation_dir.parent
                if user_dir.exists() and not any(user_dir.iterdir()):
                    user_dir.rmdir()
        except Exception:
            # Ignore errors when cleaning up directories
            pass
