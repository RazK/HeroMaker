import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./heromaker.db")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
MESHY_API_KEY = os.getenv("MESHY_API_KEY")
DEBUG = os.getenv("DEBUG", "false").lower() == "true"
# ASSETS_ROOT: In Docker, set to /app/assets (mounted from ./assets)
# For local development, use ./assets (relative to backend/ directory) or ../assets (relative to project root)
ASSETS_ROOT = os.getenv("ASSETS_ROOT", "./assets")

# OpenAI Image Model Configuration
# Primary model for image editing (must support images.edit())
OPENAI_IMAGE_MODEL = os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-1")
# Fallback model to try if primary model fails (must support images.edit())
# Note: gpt-image-1-mini does NOT support images.edit(), so it cannot be used as a fallback
OPENAI_IMAGE_MODEL_FALLBACK = os.getenv("OPENAI_IMAGE_MODEL_FALLBACK", None)  # Set to a model name if available

# VRM Converter Service Configuration
# Default: http://localhost:8002 (for docker-compose) or http://localhost:8000 (for standalone)
# When using docker-compose, services communicate via service name: http://vrm-converter:8000
VRM_CONVERTER_SERVICE_URL = os.getenv("VRM_CONVERTER_SERVICE_URL", "http://localhost:8002")
VRM_CONVERTER_TIMEOUT = int(os.getenv("VRM_CONVERTER_TIMEOUT", "300"))  # 5 minutes default

