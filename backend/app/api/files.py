from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import FileResponse, RedirectResponse
import io
from pathlib import Path
from typing import Optional
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

THUMBNAIL_SIZE = (512, 512)
THUMB_PREFIX = "thumb_"
THUMB_QUALITY = 82


def _thumb_key(filename: str) -> str:
    """
    Storage key for a thumbnail request.

    Thumbnails are always JPEG, so the stored key always ends in .jpg no matter
    what extension the caller asked for. The frontend can keep requesting
    thumb_rendered.png; it is served the .jpg object with the right Content-Type.
    """
    return str(Path(filename).with_suffix(".jpg"))


def _render_thumbnail(data: bytes) -> Optional[bytes]:
    """Resize image bytes down to THUMBNAIL_SIZE. Returns None if it is not an image."""
    try:
        from PIL import Image
        with Image.open(io.BytesIO(data)) as img:
            img.thumbnail(THUMBNAIL_SIZE, Image.LANCZOS)
            if img.mode in ("RGBA", "LA", "P"):
                # Flatten transparency onto white so JPEG encoding is valid.
                background = Image.new("RGB", img.size, (255, 255, 255))
                rgba = img.convert("RGBA")
                background.paste(rgba, mask=rgba.split()[-1])
                img = background
            elif img.mode != "RGB":
                img = img.convert("RGB")
            out = io.BytesIO()
            img.save(out, "JPEG", quality=THUMB_QUALITY, optimize=True)
            return out.getvalue()
    except Exception as e:
        logger.error(f"Failed to generate thumbnail: {e}")
        return None


def _ensure_thumbnail(storage, user_id: str, creation_id: str, original_filename: str) -> Optional[str]:
    """
    Make sure a thumbnail exists for the given original, generating it once and
    caching it in whatever storage backend is configured.

    Works for local disk and S3 alike - it goes through the storage interface
    rather than touching paths, which is why S3 deployments used to fall back to
    serving the full-size original for every gallery tile.

    Returns the stored thumbnail filename, or None if one could not be made.
    """
    thumb_filename = _thumb_key(THUMB_PREFIX + original_filename)

    if storage.file_exists(user_id, creation_id, thumb_filename):
        return thumb_filename

    try:
        original = storage.download_file(user_id, creation_id, original_filename)
    except Exception as e:
        logger.error(f"Thumbnail source unreadable {user_id}/{creation_id}/{original_filename}: {e}")
        return None

    thumb = _render_thumbnail(original)
    if thumb is None:
        return None

    try:
        storage.upload_file(user_id, creation_id, thumb_filename, thumb)
    except Exception as e:
        logger.error(f"Failed to store thumbnail {thumb_filename}: {e}")
        return None

    logger.info(
        f"Generated thumbnail {thumb_filename} "
        f"({len(original)/1024:.0f}KB -> {len(thumb)/1024:.0f}KB)"
    )
    return thumb_filename


def _serve(storage, user_id: str, creation_id: str, filename: str, max_age: int):
    """Serve a stored file: directly from disk locally, via presigned redirect on S3."""
    headers = {"Cache-Control": f"public, max-age={max_age}, immutable"}
    try:
        path = storage.get_file_path(user_id, creation_id, filename)
        if path.exists() and path.is_file():
            mime_type, _ = mimetypes.guess_type(path.name)
            if mime_type:
                headers["Content-Type"] = mime_type
            headers["ETag"] = f'"{path.stat().st_mtime}"'
            return FileResponse(path, headers=headers)
        raise HTTPException(status_code=404, detail="File not found")
    except NotImplementedError:
        return RedirectResponse(
            url=storage.get_file_url(user_id, creation_id, filename),
            status_code=302,
            headers={"Cache-Control": f"public, max-age={max_age}"},
        )


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

    Prefix a filename with 'thumb_' to get a downscaled JPEG (e.g.
    thumb_rendered.png). Thumbnails are generated on first request and cached in
    the configured storage backend, so this works on local disk and S3 alike.
    """
    if ".." in filename or ".." in user_id or ".." in creation_id:
        raise HTTPException(status_code=403, detail="Invalid path")

    storage = get_storage()

    is_thumbnail = filename.startswith(THUMB_PREFIX)
    original_filename = filename[len(THUMB_PREFIX):] if is_thumbnail else filename

    if not storage.file_exists(user_id, creation_id, original_filename):
        raise HTTPException(status_code=404, detail="File not found")

    if is_thumbnail:
        thumb_filename = _ensure_thumbnail(storage, user_id, creation_id, original_filename)
        if thumb_filename:
            return _serve(storage, user_id, creation_id, thumb_filename, max_age=31536000)
        # Could not make one (not an image, unreadable) - fall back to the original.
        logger.warning(f"Serving full-size fallback for thumb of {original_filename}")

    return _serve(storage, user_id, creation_id, original_filename, max_age=31536000)
