import logging
import sys
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import creations, files
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
Base.metadata.create_all(bind=engine)

# Run database migrations on startup
run_migrations()

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

# Health check endpoints (no /api prefix for easier monitoring)
from app.api import health
app.include_router(health.router, tags=["health"])

@app.get("/")
def root():
    return {"message": "HeroMaker API is running"}

