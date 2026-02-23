from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import FileResponse, RedirectResponse
from pathlib import Path
import os
import mimetypes
import logging
from sqlalchemy.orm import Session
from app.config.settings import FILES_ROOT
from app.utils.storage import get_storage
from app.services.auth import get_current_user_required
from app.models import User, Creation
from app.database import get_db

logger = logging.getLogger(__name__)
router = APIRouter()

THUMBNAIL_SIZE = (300, 300)
THUMB_PREFIX = "thumb_"


def _generate_thumbnail(original_path: Path, thumb_path: Path) -> bool:
    """Generate a thumbnail from the original image. Returns True on success."""
    try:
        from PIL import Image
        with Image.open(original_path) as img:
            img.thumbnail(THUMBNAIL_SIZE, Image.LANCZOS)
            # Save as JPEG for smaller size, regardless of original format
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            thumb_path_jpg = thumb_path.with_suffix(".jpg")
            img.save(thumb_path_jpg, "JPEG", quality=80, optimize=True)
            # If the requested path was .png, also save there for compatibility
            if thumb_path.suffix != ".jpg":
                os.replace(thumb_path_jpg, thumb_path)
            else:
                thumb_path = thumb_path_jpg
        return True
    except Exception as e:
        logger.error(f"Failed to generate thumbnail: {e}")
        return False


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

    Supports thumbnail requests: prefix filename with 'thumb_' (e.g. thumb_rendered.png)
    to get a 300px thumbnail. Generated on first request and cached on disk.
    """
    # Basic security check
    if ".." in filename or ".." in user_id or ".." in creation_id:
        raise HTTPException(status_code=403, detail="Invalid path")

    storage = get_storage()

    # Handle thumbnail requests
    is_thumbnail = filename.startswith(THUMB_PREFIX)
    if is_thumbnail:
        original_filename = filename[len(THUMB_PREFIX):]
    else:
        original_filename = filename

    # Check if original file exists
    if not storage.file_exists(user_id, creation_id, original_filename):
        raise HTTPException(status_code=404, detail="File not found")

    # For local storage, serve file directly
    try:
        original_path = storage.get_file_path(user_id, creation_id, original_filename)

        if is_thumbnail:
            thumb_path = original_path.parent / filename
            # Generate thumbnail if it doesn't exist yet
            if not thumb_path.exists():
                if not _generate_thumbnail(original_path, thumb_path):
                    # Fallback to original if thumbnail generation fails
                    return FileResponse(original_path, headers={
                        "Cache-Control": "public, max-age=31536000, immutable",
                    })
            file_path = thumb_path
        else:
            file_path = original_path

        if file_path.exists() and file_path.is_file():
            # Detect MIME type
            mime_type, _ = mimetypes.guess_type(file_path.name)

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
        # S3 storage - redirect to presigned URL (thumbnails not supported for S3 yet)
        presigned_url = storage.get_file_url(user_id, creation_id, original_filename)
        return RedirectResponse(
            url=presigned_url,
            status_code=302,
            headers={
                "Cache-Control": "public, max-age=86400"  # 24 hours for redirects
            }
        )

    # Fallback: file not found
    raise HTTPException(status_code=404, detail="File not found")

