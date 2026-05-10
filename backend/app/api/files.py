from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import FileResponse, RedirectResponse, Response
from pathlib import Path
import io
import os
import mimetypes
import logging
from sqlalchemy.orm import Session
from app.utils.storage import get_storage, LocalFileStorage
from app.services.auth import get_current_user_required
from app.models import User, Creation
from app.database import get_db

logger = logging.getLogger(__name__)
router = APIRouter()

THUMBNAIL_SIZE = (300, 300)
THUMB_PREFIX = "thumb_"


def _make_thumbnail_bytes(source_bytes: bytes) -> bytes | None:
    """Generate a 300px JPEG thumbnail from image bytes. Returns None on failure."""
    try:
        from PIL import Image
        with Image.open(io.BytesIO(source_bytes)) as img:
            img.thumbnail(THUMBNAIL_SIZE, Image.LANCZOS)
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=80, optimize=True)
            return buf.getvalue()
    except Exception as e:
        logger.error(f"Failed to generate thumbnail: {e}")
        return None


def _thumb_filename(original_filename: str) -> str:
    """Thumbnail is always stored as JPEG regardless of original format."""
    stem = Path(original_filename).stem
    return f"{THUMB_PREFIX}{stem}.jpg"


@router.get("/download/{user_id}/{creation_id}/{filename:path}")
async def download_file(
    user_id: str,
    creation_id: str,
    filename: str,
    current_user: User = Depends(get_current_user_required),
    db: Session = Depends(get_db)
):
    """Download a file. Requires authentication and ownership."""
    if ".." in filename or ".." in user_id or ".." in creation_id:
        raise HTTPException(status_code=403, detail="Invalid path")

    creation = db.query(Creation).filter(Creation.id == creation_id).first()
    if not creation:
        raise HTTPException(status_code=404, detail="Creation not found")
    if not current_user.is_admin and creation.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only download your own creations")

    storage = get_storage()

    if not storage.file_exists(user_id, creation_id, filename):
        raise HTTPException(status_code=404, detail="File not found")

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
    Thumbnail requests: prefix filename with 'thumb_' (e.g. thumb_rendered.jpg).
    Thumbnails are always stored/served as JPEG regardless of the original format.
    Works for both local storage (disk cache) and S3/R2 (uploaded to bucket).
    """
    if ".." in filename or ".." in user_id or ".." in creation_id:
        raise HTTPException(status_code=403, detail="Invalid path")

    storage = get_storage()

    is_thumbnail = filename.startswith(THUMB_PREFIX)
    if is_thumbnail:
        # Strip the thumb_ prefix to get the original filename, then normalise to
        # the canonical thumb key (always .jpg).
        requested_stem = Path(filename[len(THUMB_PREFIX):]).stem
        original_filename = filename[len(THUMB_PREFIX):]  # e.g. rendered.png
        thumb_key = f"{THUMB_PREFIX}{requested_stem}.jpg"  # e.g. thumb_rendered.jpg
    else:
        original_filename = filename
        thumb_key = None

    if not storage.file_exists(user_id, creation_id, original_filename):
        raise HTTPException(status_code=404, detail="File not found")

    cache_headers = {"Cache-Control": "public, max-age=31536000, immutable"}

    if isinstance(storage, LocalFileStorage):
        # ── Local storage path ──────────────────────────────────────────────
        original_path = storage.get_file_path(user_id, creation_id, original_filename)

        if is_thumbnail:
            thumb_path = original_path.parent / thumb_key
            if not thumb_path.exists():
                thumb_bytes = _make_thumbnail_bytes(original_path.read_bytes())
                if thumb_bytes is None:
                    # Fallback to original
                    return FileResponse(original_path, headers=cache_headers)
                thumb_path.write_bytes(thumb_bytes)
            return FileResponse(
                thumb_path,
                media_type="image/jpeg",
                headers=cache_headers,
            )

        file_path = original_path
        mime_type, _ = mimetypes.guess_type(file_path.name)
        headers = {**cache_headers, "ETag": f'"{file_path.stat().st_mtime}"'}
        if mime_type:
            headers["Content-Type"] = mime_type
        return FileResponse(file_path, headers=headers)

    else:
        # ── S3 / R2 path ────────────────────────────────────────────────────
        if is_thumbnail:
            # Generate thumbnail and cache it in S3 if not already there
            if not storage.file_exists(user_id, creation_id, thumb_key):
                original_bytes = storage.download_file(user_id, creation_id, original_filename)
                thumb_bytes = _make_thumbnail_bytes(original_bytes)
                if thumb_bytes is None:
                    # Fallback: redirect to full-size original
                    url = storage.get_file_url(user_id, creation_id, original_filename)
                    return RedirectResponse(url=url, status_code=302, headers=cache_headers)
                storage.upload_file(user_id, creation_id, thumb_key, thumb_bytes)
                logger.info(f"Generated and cached thumbnail in S3: {user_id}/{creation_id}/{thumb_key}")

            url = storage.get_file_url(user_id, creation_id, thumb_key)
        else:
            url = storage.get_file_url(user_id, creation_id, original_filename)

        return RedirectResponse(url=url, status_code=302, headers=cache_headers)
