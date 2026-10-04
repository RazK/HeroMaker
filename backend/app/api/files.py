from fastapi import APIRouter, HTTPException, Depends
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, RedirectResponse
from pathlib import Path
from typing import Optional
import io
import mimetypes
import logging
import os
import time
from sqlalchemy.orm import Session
from app.config.settings import FILES_ROOT
from app.utils.storage import get_storage, LocalFileStorage, THUMB_PREFIX, OPT_PREFIX, optimized_name
from app.utils.gltf_optimize import optimize_glb
from app.services.auth import get_current_user_required
from app.models import User, Creation
from app.database import get_db

logger = logging.getLogger(__name__)
router = APIRouter()

# Gallery tiles are ~170-270 CSS px wide; 512 px stays sharp on a 2x phone.
THUMBNAIL_SIZE = (512, 512)
THUMB_JPEG_QUALITY = 82
THUMB_WEBP_QUALITY = 85


def _make_thumbnail(data: bytes) -> tuple[bytes, str]:
    """Shrink an image to fit THUMBNAIL_SIZE. Returns (bytes, mime type).

    A transparent image stays transparent, as a WebP with alpha: converting it
    to RGB would paint everything around the hero black, and at 512 px a
    transparent PNG is ~6x larger than the WebP for no visible difference.
    Opaque images become JPEGs, whatever their original format.
    """
    from PIL import Image, ImageOps
    with Image.open(io.BytesIO(data)) as src:
        # Phone photos are often stored sideways with an EXIF rotation; the
        # thumbnail drops EXIF, so bake the rotation in first.
        img = ImageOps.exif_transpose(src)
        img.thumbnail(THUMBNAIL_SIZE, Image.LANCZOS)
        if img.mode in ("P", "PA", "LA"):
            img = img.convert("RGBA")
        out = io.BytesIO()
        if img.mode == "RGBA" and img.getextrema()[-1][0] < 255:
            img.save(out, "WEBP", quality=THUMB_WEBP_QUALITY, method=6)
            return out.getvalue(), "image/webp"
        if img.mode != "RGB":
            img = img.convert("RGB")
        img.save(out, "JPEG", quality=THUMB_JPEG_QUALITY, optimize=True)
        return out.getvalue(), "image/jpeg"


def _generate_thumbnail(original_path: Path, thumb_path: Path) -> bool:
    """Generate a thumbnail file from an original on disk. Returns True on success."""
    try:
        thumb, _ = _make_thumbnail(original_path.read_bytes())
        thumb_path.write_bytes(thumb)
        return True
    except Exception as e:
        logger.error(f"Failed to generate thumbnail: {e}")
        return False


def _sniff_mime(path: Path) -> Optional[str]:
    """A thumbnail keeps the original's name but not its format (thumb_rendered.png
    is a JPEG or a WebP); read the magic bytes rather than trust the extension."""
    with open(path, "rb") as f:
        head = f.read(12)
    if head.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head.startswith(b"\x89PNG"):
        return "image/png"
    return mimetypes.guess_type(path.name)[0]


def _s3_redirect(storage, user_id: str, creation_id: str, filename: str) -> RedirectResponse:
    return RedirectResponse(
        url=storage.get_file_url(user_id, creation_id, filename),
        status_code=302,
        headers={"Cache-Control": "public, max-age=86400"},  # 24 hours for redirects
    )


def _s3_thumbnail_redirect(storage, user_id: str, creation_id: str,
                           thumb_name: str, original_name: str) -> RedirectResponse:
    """Redirect to the cached S3 thumbnail, generating and storing it on first use.

    The cached thumbnail is checked first, so a warm tile costs one HEAD and a
    presign and never touches the full-size original.
    """
    if not storage.file_exists(user_id, creation_id, thumb_name):
        try:
            data = storage.download_file(user_id, creation_id, original_name)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="File not found")
        try:
            thumb, mime = _make_thumbnail(data)
        except Exception as e:
            # Not an image we can read: fall back to the original, as on disk.
            logger.error(f"Failed to generate thumbnail for {original_name}: {e}")
            return _s3_redirect(storage, user_id, creation_id, original_name)
        storage.upload_file(user_id, creation_id, thumb_name, thumb, content_type=mime)
        logger.info(f"Stored thumbnail {user_id}/{creation_id}/{thumb_name}: "
                    f"{len(data)} -> {len(thumb)} bytes")
    return _s3_redirect(storage, user_id, creation_id, thumb_name)


def _opt_media_type(filename: str) -> str:
    return "model/gltf-binary" if filename.lower().endswith(".glb") else "application/octet-stream"


def _make_optimized(data: bytes, original_name: str) -> Optional[bytes]:
    """A web-optimized copy of a GLB/VRM, or None if it cannot be made.

    ~0.5 s for a pipeline hero (7.4 MB walking.glb -> 1.5 MB); callers run it in
    a worker thread so the event loop is never blocked.
    """
    started = time.perf_counter()
    try:
        result = optimize_glb(data)
    except Exception as e:
        logger.error(f"Failed to optimize {original_name}: {e}")
        return None
    logger.info(f"Optimized {original_name}: {result.before} -> {result.after} bytes "
                f"in {time.perf_counter() - started:.2f}s")
    return result.data


def _s3_optimized_redirect(storage, user_id: str, creation_id: str,
                           opt_name: str, original_name: str) -> RedirectResponse:
    """Redirect to the cached optimized copy, generating and storing it on first use."""
    if not storage.file_exists(user_id, creation_id, opt_name):
        try:
            data = storage.download_file(user_id, creation_id, original_name)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="File not found")
        optimized = _make_optimized(data, original_name)
        if optimized is None:
            return _s3_redirect(storage, user_id, creation_id, original_name)
        storage.upload_file(user_id, creation_id, opt_name, optimized,
                            content_type=_opt_media_type(original_name))
    return _s3_redirect(storage, user_id, creation_id, opt_name)


def _local_optimized_path(original_path: Path, opt_path: Path) -> Path:
    """The cached optimized copy on disk, (re)generated when missing or stale.

    Locally the pipeline writes its outputs straight to disk rather than through
    storage.upload_file, so the copy is also regenerated when it is older than
    the original. Returns the original if no copy can be made.
    """
    if opt_path.exists() and opt_path.stat().st_mtime >= original_path.stat().st_mtime:
        return opt_path
    optimized = _make_optimized(original_path.read_bytes(), original_path.name)
    if optimized is None:
        return original_path
    # Write then rename, so a concurrent request never serves half a file.
    tmp = opt_path.with_name(f".{opt_path.name}.{os.getpid()}.{time.monotonic_ns()}.tmp")
    tmp.write_bytes(optimized)
    os.replace(tmp, opt_path)
    return opt_path


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
    creation = db.query(Creation).filter(Creation.id == creation_id, Creation.deleted_at.is_(None)).first()
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
    to get a thumbnail no larger than THUMBNAIL_SIZE. It is generated from the
    original on first request and cached next to it, on disk or as an S3 object.
    Uploading a new original deletes the cached thumbnail (see storage.upload_file).

    Likewise 'opt_' + a .glb or .vrm name (e.g. opt_walking.glb) serves a copy
    ~5x smaller and visually identical (see app/utils/gltf_optimize.py), made on
    first request and cached the same way. If it cannot be made, the original
    is served instead.
    """
    # Basic security check
    if ".." in filename or ".." in user_id or ".." in creation_id:
        raise HTTPException(status_code=403, detail="Invalid path")

    storage = get_storage()

    # Handle thumbnail and optimized-copy requests
    is_thumbnail = filename.startswith(THUMB_PREFIX)
    is_optimized = (not is_thumbnail and filename.startswith(OPT_PREFIX)
                    and optimized_name(filename[len(OPT_PREFIX):]) == filename)
    if is_thumbnail:
        original_filename = filename[len(THUMB_PREFIX):]
    elif is_optimized:
        original_filename = filename[len(OPT_PREFIX):]
    else:
        original_filename = filename

    if not isinstance(storage, LocalFileStorage):
        # S3 storage: redirect to a presigned URL of the (cached) derived copy or file.
        if is_optimized:
            return await run_in_threadpool(
                _s3_optimized_redirect, storage, user_id, creation_id, filename, original_filename
            )
        if is_thumbnail:
            return await run_in_threadpool(
                _s3_thumbnail_redirect, storage, user_id, creation_id, filename, original_filename
            )
        if not storage.file_exists(user_id, creation_id, filename):
            raise HTTPException(status_code=404, detail="File not found")
        return _s3_redirect(storage, user_id, creation_id, filename)

    # Local storage: serve the file directly
    if not storage.file_exists(user_id, creation_id, original_filename):
        raise HTTPException(status_code=404, detail="File not found")

    original_path = storage.get_file_path(user_id, creation_id, original_filename)

    if is_optimized:
        file_path = await run_in_threadpool(
            _local_optimized_path, original_path, original_path.parent / filename
        )
        return FileResponse(file_path, media_type=_opt_media_type(original_filename), headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "ETag": f'"{file_path.stat().st_mtime}"',
        })

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
        if is_thumbnail:
            mime_type = _sniff_mime(file_path)
        else:
            mime_type, _ = mimetypes.guess_type(file_path.name)

        # Build headers with caching
        headers = {
            "Cache-Control": "public, max-age=31536000, immutable",
            "ETag": f'"{file_path.stat().st_mtime}"'
        }
        return FileResponse(file_path, headers=headers, media_type=mime_type)

    # Fallback: file not found
    raise HTTPException(status_code=404, detail="File not found")
