from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import FileResponse, RedirectResponse
from pathlib import Path
import os
import mimetypes
from sqlalchemy.orm import Session
from app.config.settings import FILES_ROOT
from app.utils.storage import get_storage
from app.services.auth import get_current_user_required
from app.models import User, Creation
from app.database import get_db

router = APIRouter()


@router.get("/download/{user_id}/{creation_id}/{filename:path}")
async def download_file(
    user_id: str, 
    creation_id: str, 
    filename: str,
    current_user: User = Depends(get_current_user_required),
    db: Session = Depends(get_db)
):
    """
    Download a file. Requires authentication and ownership.
    Returns file with Content-Disposition: attachment header.
    """
    # Basic security check
    if ".." in filename or ".." in user_id or ".." in creation_id:
        raise HTTPException(status_code=403, detail="Invalid path")
    
    # Ownership check: user must own the creation or be admin
    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")
    if not current_user.is_admin and creation.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only download your own creations")
    
    storage = get_storage()
    
    # Check if file exists
    if not storage.file_exists(user_id, creation_id, filename):
        raise HTTPException(status_code=404, detail="File not found")
    
    # For local storage, serve file with download header
    try:
        file_path = storage.get_file_path(user_id, creation_id, filename)
        if file_path.exists() and file_path.is_file():
            return FileResponse(
                file_path,
                filename=filename,
                media_type="application/octet-stream",
                headers={"Content-Disposition": f"attachment; filename={filename}"}
            )
    except NotImplementedError:
        # S3 storage - redirect to presigned URL with download disposition
        presigned_url = storage.get_file_url(user_id, creation_id, filename)
        return RedirectResponse(
            url=presigned_url,
            status_code=302,
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    
    raise HTTPException(status_code=404, detail="File not found")


@router.get("/{user_id}/{creation_id}/{filename:path}")
async def serve_file(user_id: str, creation_id: str, filename: str):
    """
    Serve a file for previews. Public endpoint.
    For local storage, returns the file directly.
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
            # Detect MIME type
            mime_type, _ = mimetypes.guess_type(filename)
            
            # Build headers with caching
            headers = {
                "Cache-Control": "public, max-age=31536000, immutable",
                "ETag": f'"{file_path.stat().st_mtime}"'
            }
            
            # Add Content-Type if we can detect it
            if mime_type:
                headers["Content-Type"] = mime_type
            
            return FileResponse(file_path, headers=headers)
    except NotImplementedError:
        # S3 storage - redirect to presigned URL
        presigned_url = storage.get_file_url(user_id, creation_id, filename)
        return RedirectResponse(
            url=presigned_url,
            status_code=302,
            headers={
                "Cache-Control": "public, max-age=86400"  # 24 hours for redirects
            }
        )
    
    # Fallback: file not found
    raise HTTPException(status_code=404, detail="File not found")

