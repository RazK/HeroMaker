import logging
import sys
import asyncio
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, Base
from app.config.settings import DEBUG, ALLOWED_ORIGINS, DATABASE_URL, FILES_ROOT, VRM_CONVERTER_SERVICE_URL
from app.migrations.registry import run_migrations
from app.utils.storage import get_storage
from app.services.task_manager import TaskManager, set_task_manager, get_task_manager
from app.services.startup_reconcile import interrupt_running, sweep_forever
import os

# Configure structured logging
logging.basicConfig(
    level=logging.INFO if not DEBUG else logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)

logger = logging.getLogger(__name__)
logger.info("HeroMaker API starting...")

# Log important configuration
def log_startup_configuration():
    """Log important configuration information at startup."""
    logger.info("=" * 60)
    logger.info("CONFIGURATION")
    logger.info("=" * 60)
    
    # Database
    db_type = "PostgreSQL" if "postgresql" in DATABASE_URL.lower() else "SQLite"
    logger.info(f"Database: {db_type}")
    if "sqlite" in DATABASE_URL.lower():
        db_path = DATABASE_URL.replace("sqlite:///", "").replace("sqlite:////", "")
        logger.info(f"  Path: {db_path}")
    
    # Storage
    try:
        storage = get_storage()
        storage_type = type(storage).__name__
        logger.info(f"Storage Backend: {storage_type}")
        
        if storage_type == "S3FileStorage":
            s3_bucket = os.getenv("S3_BUCKET", "NOT SET")
            logger.info(f"  S3 Bucket: {s3_bucket}")
            logger.info(f"  S3 Endpoint: {os.getenv('S3_ENDPOINT', 'NOT SET')}")
            logger.warning("  ⚠️  Files are stored in S3 (Railway), not locally!")
        else:
            logger.info(f"  Local Files Root: {FILES_ROOT}")
    except Exception as e:
        logger.error(f"  Failed to initialize storage: {e}")
    
    # VRM Converter Service
    logger.info(f"VRM Converter Service: {VRM_CONVERTER_SERVICE_URL}")
    
    # API Keys
    has_openai = "SET" if os.getenv("OPENAI_API_KEY") else "NOT SET"
    has_meshy = "SET" if os.getenv("MESHY_API_KEY") else "NOT SET"
    logger.info(f"OpenAI API Key: {has_openai}")
    logger.info(f"Meshy API Key: {has_meshy}")
    
    # Debug mode
    logger.info(f"Debug Mode: {DEBUG}")
    
    logger.info("=" * 60)

log_startup_configuration()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """App lifespan: startup and shutdown."""
    # Startup
    logger.info("Starting up...")
    task_manager = TaskManager()
    set_task_manager(task_manager)  # Set global instance
    
    # Steps a previous process left "processing" are failed and refunded by a
    # sweep that starts once that process is surely gone: a deploy overlaps,
    # and the old process keeps running its steps for a while
    # (app/services/startup_reconcile.py).
    sweeper = asyncio.create_task(sweep_forever(task_manager))

    # API heroes still being made keep posting to their webhooks.
    try:
        from app.services.api_heroes import resume_watchers
        resumed = resume_watchers()
        if resumed:
            logger.info(f"Resumed {resumed} API webhook watchers")
    except Exception as e:
        logger.warning(f"Could not resume API webhook watchers: {e}")

    logger.info("TaskManager initialized")
    yield
    
    # Shutdown (a deploy's SIGTERM, once uvicorn has drained requests): cancel
    # this process's tasks, then refund and fail the steps they were in, as the
    # sweep would, but now (startup_reconcile.interrupt_running).
    logger.info("Shutting down: Cancelling all tasks...")
    sweeper.cancel()
    if task_manager:
        counts = await interrupt_running(task_manager)
        logger.info(f"Shutdown interrupted running steps: {counts}")
        set_task_manager(None)  # Clear global instance
    logger.info("Shutdown complete")


# Create tables (for V2 SQLite convenience)
# Wrap in try/except to handle database connection errors gracefully
try:
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables created/verified")
except Exception as e:
    logger.error(f"Failed to create database tables: {e}")
    # Don't fail startup - let health check handle it
    # This allows the app to start even if database is temporarily unavailable

# Run database migrations on startup
# A failure stops the process: a backend whose models are ahead of its schema
# would fail every request that touches the missing column while still passing
# /health. Exiting keeps the previous deploy serving; Railway restarts this one.
try:
    run_migrations()
    logger.info("Database migrations completed")
except Exception as e:
    logger.error(f"Failed to run migrations, refusing to start: {e}")
    raise SystemExit(1)

# Import routers after lifespan is defined (but before app creation)
# This avoids circular imports since routers import get_task_manager from task_manager module
from app.api import creations, files, auth, coupons, health, admin, payments, styles, classes, v1
from app.utils.public_cors import PublicCORS

app = FastAPI(title="HeroMaker API", lifespan=lifespan)

# CORS - use environment variable, default to "*" for backward compatibility
# Split comma-separated origins if provided, otherwise use as-is for "*"
allowed_origins_list = ALLOWED_ORIGINS.split(",") if ALLOWED_ORIGINS != "*" else ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Added last, so it runs first: the public API answers any website.
app.add_middleware(PublicCORS)

# Routers
app.include_router(creations.router, prefix="/api/creations", tags=["creations"])
app.include_router(files.router, prefix="/api/files", tags=["files"])
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(coupons.router, prefix="/api/coupons", tags=["coupons"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(payments.router, prefix="/api/payments", tags=["payments"])
app.include_router(health.router, tags=["health"])
app.include_router(styles.router, tags=["styles"])
app.include_router(classes.teacher_router, prefix="/api/classes", tags=["classes"])
app.include_router(classes.student_router, prefix="/api/class", tags=["classes"])
app.include_router(v1.router, prefix="/api/v1", tags=["public API v1"])

@app.get("/")
def root():
    return {"message": "HeroMaker API is running"}

