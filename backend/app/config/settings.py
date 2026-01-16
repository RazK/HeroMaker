import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root if it exists (for local development)
# In Docker/Railway, env vars come from environment, not .env files
_project_root = Path(__file__).parent.parent.parent.parent
_env_file = _project_root / ".env"
if _env_file.exists():
    load_dotenv(dotenv_path=_env_file, override=False)  # override=False: system env vars take precedence
else:
    # No .env file (Docker/Railway) - load from system environment only
    load_dotenv(override=False)

# Always use absolute path to data/db/heromaker.db
_default_db_path = _project_root / "data" / "db" / "heromaker.db"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{_default_db_path.absolute()}")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
MESHY_API_KEY = os.getenv("MESHY_API_KEY")
DEBUG = os.getenv("DEBUG", "false").lower() == "true"
# FILES_ROOT: Set by docker-compose to /app/data/files for containers, or from .env for local dev
# Always use absolute path to data/files (similar to DATABASE_URL)
_default_files_root = _project_root / "data" / "files"
FILES_ROOT = os.getenv("FILES_ROOT", str(_default_files_root.absolute()))

# OpenAI Image Model Configuration
# Primary model for image editing (must support images.edit())
OPENAI_IMAGE_MODEL = os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-1")
# Fallback model to try if primary model fails (must support images.edit())
# Note: gpt-image-1-mini does NOT support images.edit(), so it cannot be used as a fallback
OPENAI_IMAGE_MODEL_FALLBACK = os.getenv("OPENAI_IMAGE_MODEL_FALLBACK", None)  # Set to a model name if available

# VRM Converter Service Configuration
# In docker-compose, services communicate via service name: http://vrm-converter:8000
# For standalone/local: http://localhost:8001 (host) or http://localhost:8000 (container)
# Auto-detect: if VRM_CONVERTER_SERVICE_URL is not set, use Docker service name if in Docker,
# otherwise use localhost:8001 for local development
if os.getenv("VRM_CONVERTER_SERVICE_URL"):
    VRM_CONVERTER_SERVICE_URL = os.getenv("VRM_CONVERTER_SERVICE_URL")
else:
    # Auto-detect: check if running in Docker
    if os.path.exists("/.dockerenv"):
        VRM_CONVERTER_SERVICE_URL = "http://vrm-converter:8000"  # Docker service name
    else:
        VRM_CONVERTER_SERVICE_URL = "http://localhost:8001"  # Local development
VRM_CONVERTER_TIMEOUT = int(os.getenv("VRM_CONVERTER_TIMEOUT", "300"))  # 5 minutes default

# CORS Configuration
# Comma-separated list of allowed origins, or "*" for all origins (default for development)
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*")

# S3 Storage Configuration (optional - only used if S3_BUCKET is set)
# For Railway Storage Buckets (S3-compatible)
S3_BUCKET = os.getenv("S3_BUCKET")  # Bucket name from Railway
S3_ENDPOINT = os.getenv("S3_ENDPOINT", "https://storage.railway.app")  # Railway Storage endpoint
S3_ACCESS_KEY_ID = os.getenv("S3_ACCESS_KEY_ID")  # From bucket credentials
S3_SECRET_ACCESS_KEY = os.getenv("S3_SECRET_ACCESS_KEY")  # From bucket credentials
S3_REGION = os.getenv("S3_REGION", "auto")  # Railway default region

# JWT Authentication Configuration
# Security: JWT_SECRET_KEY must be set explicitly in production
# In development (DEBUG=True), we allow a default but warn about it
_jwt_secret_key = os.getenv("JWT_SECRET_KEY")
if not _jwt_secret_key:
    if DEBUG:
        # Development mode: use a default but warn
        import warnings
        warnings.warn(
            "JWT_SECRET_KEY not set! Using insecure default for development only. "
            "Set JWT_SECRET_KEY environment variable for production.",
            UserWarning
        )
        JWT_SECRET_KEY = "change-this-secret-key-in-production"
    else:
        # Production mode: fail loudly if not set
        raise ValueError(
            "JWT_SECRET_KEY environment variable is required in production. "
            "Set it to a secure random string (e.g., 32+ characters)."
        )
else:
    JWT_SECRET_KEY = _jwt_secret_key
    # Warn if using the default value even when explicitly set
    if JWT_SECRET_KEY == "change-this-secret-key-in-production":
        import warnings
        warnings.warn(
            "JWT_SECRET_KEY is set to the default insecure value! "
            "Change it to a secure random string in production.",
            UserWarning
        )

JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_EXPIRATION_HOURS = int(os.getenv("JWT_EXPIRATION_HOURS", "24"))

