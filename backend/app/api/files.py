from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path
import os
from app.config.settings import ASSETS_ROOT

router = APIRouter()

@router.get("/{path:path}")
async def serve_file(path: str):
    # Basic security check
    if ".." in path:
        raise HTTPException(status_code=403, detail="Invalid path")
    
    full_path = Path(ASSETS_ROOT) / path
    
    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
        
    return FileResponse(full_path)

