import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import creations, files
from app.database import engine, Base

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

# Create tables (for V2 SQLite convenience)
Base.metadata.create_all(bind=engine)

app = FastAPI(title="HeroMaker API")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(creations.router, prefix="/api/creations", tags=["creations"])
app.include_router(files.router, prefix="/api/files", tags=["files"])

@app.get("/")
def root():
    return {"message": "HeroMaker API is running"}

