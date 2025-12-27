"""
Health check endpoints for monitoring and observability.
"""
from fastapi import APIRouter, status
from fastapi.responses import JSONResponse
from sqlalchemy import text
from app.database import engine
from app.config.settings import VRM_CONVERTER_SERVICE_URL
import requests
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/health")
async def health_check():
    """
    Basic health check endpoint.
    Returns 200 if the service is running.
    """
    return {"status": "healthy", "service": "HeroMaker API"}


@router.get("/health/detailed")
async def detailed_health_check():
    """
    Comprehensive health check endpoint.
    Checks database connectivity and optionally external services.
    """
    health_status = {
        "status": "healthy",
        "service": "HeroMaker API",
        "checks": {}
    }
    overall_healthy = True

    # Check database connectivity
    try:
        with engine.connect() as conn:
            result = conn.execute(text("SELECT 1"))
            result.fetchone()
        health_status["checks"]["database"] = {
            "status": "healthy",
            "message": "Database connection successful"
        }
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
        health_status["checks"]["database"] = {
            "status": "unhealthy",
            "message": f"Database connection failed: {str(e)}"
        }
        overall_healthy = False

    # Check VRM converter service (optional, don't fail if unavailable)
    try:
        response = requests.get(f"{VRM_CONVERTER_SERVICE_URL}/health", timeout=5)
        if response.status_code == 200:
            health_status["checks"]["vrm_converter"] = {
                "status": "healthy",
                "message": "VRM converter service is reachable"
            }
        else:
            health_status["checks"]["vrm_converter"] = {
                "status": "degraded",
                "message": f"VRM converter returned status {response.status_code}"
            }
    except Exception as e:
        logger.warning(f"VRM converter health check failed: {e}")
        health_status["checks"]["vrm_converter"] = {
            "status": "unreachable",
            "message": f"VRM converter service is not reachable: {str(e)}"
        }
        # Don't mark overall as unhealthy if VRM converter is down
        # It's an optional service for some operations

    if not overall_healthy:
        health_status["status"] = "unhealthy"
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content=health_status
        )

    return health_status


