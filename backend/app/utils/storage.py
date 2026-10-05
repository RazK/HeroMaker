"""
Storage abstraction layer for file operations.
Supports both local filesystem (for local development) and S3 (for Railway deployment).
Automatically switches based on environment variables.
"""
import datetime
import os
import threading
import time
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional, BinaryIO
import logging

logger = logging.getLogger(__name__)

# Try to import boto3, but don't fail if it's not available (for local dev)
try:
    import boto3
    from botocore.exceptions import ClientError, BotoCoreError
    BOTO3_AVAILABLE = True
except ImportError:
    BOTO3_AVAILABLE = False
    boto3 = None
    ClientError = Exception
    BotoCoreError = Exception

from app.config.settings import FILES_ROOT

# Cached thumbnails are stored next to their source as "thumb_<filename>".
THUMB_PREFIX = "thumb_"


# Web-optimized copies of 3D files are stored next to theirs as "opt_<filename>".
OPT_PREFIX = "opt_"
OPTIMIZABLE_SUFFIXES = (".glb", ".vrm")

_DERIVED_PREFIXES = (THUMB_PREFIX, OPT_PREFIX)


def thumbnail_name(filename: str) -> Optional[str]:
    """The cached-thumbnail name derived from ``filename``, or None for a thumbnail itself."""
    if filename.startswith(THUMB_PREFIX):
        return None
    return THUMB_PREFIX + filename


def optimized_name(filename: str) -> Optional[str]:
    """The cached web-optimized name for a .glb/.vrm, or None if there is none."""
    if filename.startswith(_DERIVED_PREFIXES) or not filename.lower().endswith(OPTIMIZABLE_SUFFIXES):
        return None
    return OPT_PREFIX + filename


def derived_names(filename: str) -> list[str]:
    """Every cached copy generated from ``filename``; uploading it makes them stale."""
    if filename.startswith(_DERIVED_PREFIXES):
        return []
    return [n for n in (thumbnail_name(filename), optimized_name(filename)) if n]


class StorageBackend(ABC):
    """Abstract base class for storage backends."""
    
    @abstractmethod
    def upload_file(self, user_id: str, creation_id: str, filename: str, file_data: bytes,
                    content_type: Optional[str] = None) -> str:
        """Upload a file and return the storage key/path.

        Uploading a file invalidates its cached copies (``thumb_<filename>``, and
        ``opt_<filename>`` for a .glb/.vrm), so a re-rendered image or re-rigged
        model never keeps showing the old one.
        """
        pass
    
    @abstractmethod
    def download_file(self, user_id: str, creation_id: str, filename: str) -> bytes:
        """Download a file and return its contents."""
        pass
    
    @abstractmethod
    def get_file_url(self, user_id: str, creation_id: str, filename: str, expires_in: int = 86400) -> str:
        """Get a URL to access the file. For S3, returns presigned URL. For local, returns API path."""
        pass
    
    def get_cacheable_url(self, user_id: str, creation_id: str, filename: str) -> tuple[str, int]:
        """A URL for the file that a browser may cache, and for how many seconds.

        The default is ``get_file_url`` and 0: nothing to cache.
        """
        return self.get_file_url(user_id, creation_id, filename), 0

    @abstractmethod
    def file_exists(self, user_id: str, creation_id: str, filename: str) -> bool:
        """Check if a file exists."""
        pass
    
    @abstractmethod
    def list_files(self, user_id: str, creation_id: str) -> list[str]:
        """List all files for a creation."""
        pass
    
    @abstractmethod
    def delete_file(self, user_id: str, creation_id: str, filename: str) -> None:
        """Delete a file."""
        pass
    
    @abstractmethod
    def get_file_path(self, user_id: str, creation_id: str, filename: str) -> Path:
        """Get the local file path (for local storage) or raise NotImplementedError (for S3)."""
        pass


class LocalFileStorage(StorageBackend):
    """Local filesystem storage implementation."""
    
    def __init__(self):
        self.files_root = Path(FILES_ROOT)
        self.files_root.mkdir(parents=True, exist_ok=True)
    
    def _get_file_path(self, user_id: str, creation_id: str, filename: str) -> Path:
        """Get the full path to a file."""
        creation_dir = self.files_root / user_id / creation_id
        creation_dir.mkdir(parents=True, exist_ok=True)
        return creation_dir / filename
    
    def upload_file(self, user_id: str, creation_id: str, filename: str, file_data: bytes,
                    content_type: Optional[str] = None) -> str:
        """Upload a file to local filesystem."""
        file_path = self._get_file_path(user_id, creation_id, filename)
        file_path.write_bytes(file_data)
        for derived in derived_names(filename):
            (file_path.parent / derived).unlink(missing_ok=True)
        return str(file_path)
    
    def download_file(self, user_id: str, creation_id: str, filename: str) -> bytes:
        """Download a file from local filesystem."""
        file_path = self._get_file_path(user_id, creation_id, filename)
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        return file_path.read_bytes()
    
    def get_file_url(self, user_id: str, creation_id: str, filename: str, expires_in: int = 86400) -> str:
        """Get the API URL for a local file."""
        return f"/api/files/{user_id}/{creation_id}/{filename}"
    
    def file_exists(self, user_id: str, creation_id: str, filename: str) -> bool:
        """Check if a file exists in local filesystem."""
        file_path = self._get_file_path(user_id, creation_id, filename)
        return file_path.exists() and file_path.is_file()
    
    def list_files(self, user_id: str, creation_id: str) -> list[str]:
        """List all files for a creation in local filesystem."""
        creation_dir = self.files_root / user_id / creation_id
        if not creation_dir.exists():
            return []
        return [f.name for f in creation_dir.iterdir() if f.is_file()]
    
    def delete_file(self, user_id: str, creation_id: str, filename: str) -> None:
        """Delete a file from local filesystem."""
        file_path = self._get_file_path(user_id, creation_id, filename)
        if file_path.exists():
            file_path.unlink()
    
    def get_file_path(self, user_id: str, creation_id: str, filename: str) -> Path:
        """Get the local file path."""
        return self._get_file_path(user_id, creation_id, filename)


# How long one presigned URL is handed out for. See S3FileStorage.get_cacheable_url.
URL_WINDOW = 3600
# What S3 sends with the file: always ask whether it changed (a 304 when it has
# not, so the bytes never download twice). The URL is reused for an hour, and a
# hero made again within that hour must not keep showing the old one.
S3_CACHE_CONTROL = "no-cache"

_signing = threading.local()


def _install_signing_clock() -> bool:
    """Let a presign on this thread choose its own signing time.

    botocore signs with ``botocore.auth.get_current_datetime()``. This wraps it
    once so that a thread which sets ``_signing.at`` signs at that instant,
    while every other signature (uploads, HEADs, other threads) keeps the real
    clock. Returns False if this botocore does not sign through that function;
    URLs then change on every request, as they always did, and
    tests/test_cacheable_urls.py fails to say so.
    """
    try:
        import botocore.auth as auth
    except ImportError:
        return False
    real = getattr(auth, "get_current_datetime", None)
    if real is None:
        return False
    if getattr(real, "_heromaker_pinnable", False):
        return True

    def get_current_datetime(remove_tzinfo=True):
        at = getattr(_signing, "at", None)
        if at is None:
            return real(remove_tzinfo=remove_tzinfo)
        return at.replace(tzinfo=None) if remove_tzinfo else at

    get_current_datetime._heromaker_pinnable = True  # type: ignore[attr-defined]
    auth.get_current_datetime = get_current_datetime
    return True


class S3FileStorage(StorageBackend):
    """S3-compatible storage implementation (Railway Storage Buckets)."""
    
    def __init__(self):
        if not BOTO3_AVAILABLE:
            raise ImportError("boto3 is required for S3 storage but is not installed")
        
        self.bucket_name = os.getenv("S3_BUCKET")
        self.endpoint_url = os.getenv("S3_ENDPOINT", "https://storage.railway.app")
        self.access_key_id = os.getenv("S3_ACCESS_KEY_ID")
        self.secret_access_key = os.getenv("S3_SECRET_ACCESS_KEY")
        self.region = os.getenv("S3_REGION", "auto")
        
        if not all([self.bucket_name, self.access_key_id, self.secret_access_key]):
            raise ValueError("S3 credentials not fully configured. Required: S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY")
        
        # Initialize S3 client
        self.s3_client = boto3.client(
            's3',
            endpoint_url=self.endpoint_url,
            aws_access_key_id=self.access_key_id,
            aws_secret_access_key=self.secret_access_key,
            region_name=self.region
        )
        
        logger.info(f"Initialized S3 storage: bucket={self.bucket_name}, endpoint={self.endpoint_url}")
    
    def _get_s3_key(self, user_id: str, creation_id: str, filename: str) -> str:
        """Get the S3 key for a file (maintains same structure as local: {user_id}/{creation_id}/{filename})."""
        return f"{user_id}/{creation_id}/{filename}"
    
    def upload_file(self, user_id: str, creation_id: str, filename: str, file_data: bytes,
                    content_type: Optional[str] = None) -> str:
        """Upload a file to S3."""
        s3_key = self._get_s3_key(user_id, creation_id, filename)
        extra = {"ContentType": content_type} if content_type else {}
        try:
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=s3_key,
                Body=file_data,
                **extra,
            )
            logger.debug(f"Uploaded file to S3: {s3_key}")
        except (ClientError, BotoCoreError) as e:
            logger.error(f"Failed to upload file to S3: {s3_key}, error: {e}")
            raise
        for derived in derived_names(filename):
            # delete_object succeeds for a missing key, so this is one cheap call.
            try:
                self.s3_client.delete_object(
                    Bucket=self.bucket_name, Key=self._get_s3_key(user_id, creation_id, derived)
                )
            except (ClientError, BotoCoreError) as e:
                logger.warning(f"Could not invalidate {derived} for {s3_key}: {e}")
        return s3_key
    
    def download_file(self, user_id: str, creation_id: str, filename: str) -> bytes:
        """Download a file from S3."""
        s3_key = self._get_s3_key(user_id, creation_id, filename)
        try:
            response = self.s3_client.get_object(Bucket=self.bucket_name, Key=s3_key)
            return response['Body'].read()
        except ClientError as e:
            if e.response['Error']['Code'] == 'NoSuchKey':
                raise FileNotFoundError(f"File not found in S3: {s3_key}")
            logger.error(f"Failed to download file from S3: {s3_key}, error: {e}")
            raise
    
    def get_file_url(self, user_id: str, creation_id: str, filename: str, expires_in: int = 86400) -> str:
        """Generate a presigned URL for S3 file access."""
        s3_key = self._get_s3_key(user_id, creation_id, filename)
        try:
            url = self.s3_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': self.bucket_name, 'Key': s3_key},
                ExpiresIn=expires_in
            )
            return url
        except (ClientError, BotoCoreError) as e:
            logger.error(f"Failed to generate presigned URL for S3: {s3_key}, error: {e}")
            raise
    
    def get_cacheable_url(self, user_id: str, creation_id: str, filename: str,
                          now: Optional[float] = None) -> tuple[str, int]:
        """A presigned URL that stays the same for an hour, and seconds until it changes.

        A presigned URL carries its signing time, so presigning on every request
        gave a new URL every request and the browser cache never hit: a hero's
        3D files downloaded again on every screen that showed them. Signing at
        the start of the current hour returns the same URL all hour. It is valid
        for two, so a URL handed out at 10:59 still works at 11:59, and the
        redirect to it may be cached until the hour ends.
        """
        now = time.time() if now is None else now
        start = int(now // URL_WINDOW) * URL_WINDOW
        s3_key = self._get_s3_key(user_id, creation_id, filename)
        params = {"Bucket": self.bucket_name, "Key": s3_key, "ResponseCacheControl": S3_CACHE_CONTROL}
        pinned = _install_signing_clock()
        _signing.at = datetime.datetime.fromtimestamp(start, datetime.timezone.utc)
        try:
            url = self.s3_client.generate_presigned_url(
                "get_object", Params=params, ExpiresIn=2 * URL_WINDOW,
            )
        except (ClientError, BotoCoreError) as e:
            logger.error(f"Failed to generate presigned URL for S3: {s3_key}, error: {e}")
            raise
        finally:
            _signing.at = None
        return url, (max(0, int(start + URL_WINDOW - now)) if pinned else 0)

    def file_exists(self, user_id: str, creation_id: str, filename: str) -> bool:
        """Check if a file exists in S3."""
        s3_key = self._get_s3_key(user_id, creation_id, filename)
        try:
            self.s3_client.head_object(Bucket=self.bucket_name, Key=s3_key)
            return True
        except ClientError as e:
            if e.response['Error']['Code'] == '404':
                return False
            logger.error(f"Error checking file existence in S3: {s3_key}, error: {e}")
            raise
    
    def list_files(self, user_id: str, creation_id: str) -> list[str]:
        """List all files for a creation in S3."""
        prefix = f"{user_id}/{creation_id}/"
        try:
            response = self.s3_client.list_objects_v2(
                Bucket=self.bucket_name,
                Prefix=prefix
            )
            if 'Contents' not in response:
                return []
            # Extract filenames from S3 keys (remove the prefix)
            files = [obj['Key'][len(prefix):] for obj in response['Contents']]
            return files
        except (ClientError, BotoCoreError) as e:
            logger.error(f"Failed to list files in S3: {prefix}, error: {e}")
            raise
    
    def delete_file(self, user_id: str, creation_id: str, filename: str) -> None:
        """Delete a file from S3."""
        s3_key = self._get_s3_key(user_id, creation_id, filename)
        try:
            self.s3_client.delete_object(Bucket=self.bucket_name, Key=s3_key)
            logger.debug(f"Deleted file from S3: {s3_key}")
        except (ClientError, BotoCoreError) as e:
            logger.error(f"Failed to delete file from S3: {s3_key}, error: {e}")
            raise
    
    def get_file_path(self, user_id: str, creation_id: str, filename: str) -> Path:
        """S3 storage doesn't have local file paths."""
        raise NotImplementedError("S3 storage doesn't support local file paths. Use download_file() instead.")


# Factory function to get the appropriate storage backend
_storage_instance: Optional[StorageBackend] = None

def get_storage() -> StorageBackend:
    """
    Get the appropriate storage backend based on environment variables.
    - If S3_BUCKET is set → use S3FileStorage
    - Otherwise → use LocalFileStorage
    
    Returns a singleton instance.
    
    Note: S3 initialization errors are logged but don't crash the app.
    If S3 fails to initialize, falls back to LocalFileStorage.
    """
    global _storage_instance
    
    if _storage_instance is None:
        if os.getenv("S3_BUCKET"):
            try:
                logger.info("Initializing S3 storage backend...")
                _storage_instance = S3FileStorage()
                logger.info("S3 storage backend initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize S3 storage: {e}. Falling back to local filesystem.")
                logger.warning("S3 credentials may be incorrect or S3 service unavailable")
                _storage_instance = LocalFileStorage()
        else:
            logger.info("Using local filesystem storage backend")
            _storage_instance = LocalFileStorage()
    
    return _storage_instance

