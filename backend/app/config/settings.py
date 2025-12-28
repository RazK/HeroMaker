import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/db/heromaker.db")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
MESHY_API_KEY = os.getenv("MESHY_API_KEY")
DEBUG = os.getenv("DEBUG", "false").lower() == "true"
# FILES_ROOT: Set by docker-compose to /app/data/files for containers, or from .env for local dev
# Default to ./data/files for local development
FILES_ROOT = os.getenv("FILES_ROOT", "./data/files")

# OpenAI Image Model Configuration
# Primary model for image editing (must support images.edit())
OPENAI_IMAGE_MODEL = os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-1")
# Fallback model to try if primary model fails (must support images.edit())
# Note: gpt-image-1-mini does NOT support images.edit(), so it cannot be used as a fallback
OPENAI_IMAGE_MODEL_FALLBACK = os.getenv("OPENAI_IMAGE_MODEL_FALLBACK", None)  # Set to a model name if available

# VRM Converter Service Configuration
# In docker-compose, services communicate via service name: http://vrm-converter:8000
# For standalone/local: http://localhost:8001 (host) or http://localhost:8000 (container)
# Default to docker-compose service name, fallback to localhost for local development
VRM_CONVERTER_SERVICE_URL = os.getenv("VRM_CONVERTER_SERVICE_URL", "http://vrm-converter:8000")
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

