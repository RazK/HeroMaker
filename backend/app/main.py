import logging
import sys
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import creations, files, auth, coupons, health
from app.database import engine, Base
from app.config.settings import DEBUG, ALLOWED_ORIGINS
from app.migrations.registry import run_migrations

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
try:
    run_migrations()
    logger.info("Database migrations completed")
except Exception as e:
    logger.error(f"Failed to run migrations: {e}")
    # Don't fail startup - migrations will retry on next restart
    # This allows the app to start even if migrations fail temporarily

app = FastAPI(title="HeroMaker API")

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

# Routers
app.include_router(creations.router, prefix="/api/creations", tags=["creations"])
app.include_router(files.router, prefix="/api/files", tags=["files"])
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(coupons.router, prefix="/api/coupons", tags=["coupons"])
app.include_router(health.router, tags=["health"])

@app.get("/")
def root():
    return {"message": "HeroMaker API is running"}

