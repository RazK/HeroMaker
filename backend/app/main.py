from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import creations, tasks, files, characters
from app.database import engine, Base

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
app.include_router(tasks.router, prefix="/api/creations", tags=["tasks"]) # Nested tasks under creations
app.include_router(files.router, prefix="/api/files", tags=["files"])
app.include_router(characters.router, prefix="/api/characters", tags=["characters"])

@app.get("/")
def root():
    return {"message": "HeroMaker API is running"}

