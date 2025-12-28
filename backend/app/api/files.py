from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from pathlib import Path
import os
from app.config.settings import FILES_ROOT
from app.utils.storage import get_storage

router = APIRouter()

@router.get("/{user_id}/{creation_id}/{filename:path}")
async def serve_file(user_id: str, creation_id: str, filename: str):
    """
    Serve a file. For local storage, returns the file directly.
    For S3 storage, redirects to a presigned URL.
    """
    # Basic security check
    if ".." in filename or ".." in user_id or ".." in creation_id:
        raise HTTPException(status_code=403, detail="Invalid path")
    
    storage = get_storage()
    
    # Check if file exists
    if not storage.file_exists(user_id, creation_id, filename):
        raise HTTPException(status_code=404, detail="File not found")
    
    # For local storage, serve file directly
    try:
        file_path = storage.get_file_path(user_id, creation_id, filename)
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
    except NotImplementedError:
        # S3 storage - redirect to presigned URL
        presigned_url = storage.get_file_url(user_id, creation_id, filename)
        return RedirectResponse(url=presigned_url, status_code=302)
    
    # Fallback: file not found
    raise HTTPException(status_code=404, detail="File not found")

