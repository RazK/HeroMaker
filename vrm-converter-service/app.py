"""
FastAPI service for converting GLB files to VRM format using Blender.
"""
import os
import uuid
import shutil
import subprocess
import tempfile
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks, Form
from fastapi.responses import FileResponse
from typing import Optional

app = FastAPI(title="GLB to VRM Converter")

# Temporary directory for file processing
TEMP_DIR = "/tmp/vrm_conversion"
os.makedirs(TEMP_DIR, exist_ok=True)

# Path to Blender executable (will be /usr/bin/blender in container)
BLENDER_PATH = os.getenv("BLENDER_PATH", "/usr/bin/blender")

# Path to conversion script
SCRIPT_DIR = Path(__file__).parent
CONVERSION_SCRIPT = SCRIPT_DIR / "conversion_script.py"


def blender_convert(input_path: str, output_path: str, thumbnail_path: Optional[str] = None) -> None:
    """
    Run Blender conversion using subprocess.
    
    Args:
        input_path: Path to input GLB file
        output_path: Path where VRM file should be saved
        thumbnail_path: Optional path to thumbnail image file
    
    Raises:
        Exception: If conversion fails
    """
    if not Path(BLENDER_PATH).exists():
        raise Exception(f"Blender executable not found at {BLENDER_PATH}")
    
    if not CONVERSION_SCRIPT.exists():
        raise Exception(f"Conversion script not found at {CONVERSION_SCRIPT}")
    
    # Run Blender with the conversion script
    # Format: blender --background --python script.py -- input.glb output.vrm [thumbnail_path]
    cmd = [
        BLENDER_PATH,
        "--background",
        "--python",
        str(CONVERSION_SCRIPT),
        "--",
        input_path,
        output_path
    ]
    
    if thumbnail_path:
        cmd.append(thumbnail_path)
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True,
            timeout=300  # 5 minute timeout
        )
        
        # Check if output file was created
        if not Path(output_path).exists():
            raise Exception(
                f"VRM conversion reported success but output file not found.\n"
                f"Blender stdout: {result.stdout}\n"
                f"Blender stderr: {result.stderr}"
            )
        
    except subprocess.TimeoutExpired:
        raise Exception("VRM conversion timed out after 5 minutes")
    except subprocess.CalledProcessError as e:
        raise Exception(
            f"VRM conversion failed:\n"
            f"Return code: {e.returncode}\n"
            f"Stdout: {e.stdout}\n"
            f"Stderr: {e.stderr}"
        ) from e


def cleanup_files(*paths):
    """Cleanup temporary files after the response is sent."""
    for path in paths:
        path_obj = Path(path)
        if path_obj.exists():
            try:
                path_obj.unlink()
            except Exception as e:
                print(f"Warning: Failed to delete {path}: {e}")


@app.post("/convert")
async def convert_glb_to_vrm(
    background_tasks: BackgroundTasks, 
    file: UploadFile = File(...),
    thumbnail: Optional[UploadFile] = File(None)
):
    """
    Convert a GLB file to VRM format.
    
    Args:
        file: Uploaded GLB file
        thumbnail: Optional thumbnail/preview image (PNG, JPG) for the avatar
    
    Returns:
        FileResponse: The converted VRM file
    
    Raises:
        HTTPException: If conversion fails
    """
    # Validate file extension
    if not file.filename or not file.filename.lower().endswith(".glb"):
        raise HTTPException(status_code=400, detail="Only .glb files are supported")
    
    # Validate thumbnail if provided
    thumbnail_path = None
    if thumbnail:
        if not thumbnail.filename:
            raise HTTPException(status_code=400, detail="Thumbnail file must have a filename")
        ext = os.path.splitext(thumbnail.filename)[1].lower()
        if ext not in ['.png', '.jpg', '.jpeg']:
            raise HTTPException(status_code=400, detail="Thumbnail must be PNG or JPG")
    
    job_id = str(uuid.uuid4())
    input_path = os.path.join(TEMP_DIR, f"{job_id}.glb")
    output_path = os.path.join(TEMP_DIR, f"{job_id}.vrm")
    
    try:
        # Save uploaded GLB file to disk
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Save thumbnail if provided
        if thumbnail:
            thumbnail_path = os.path.join(TEMP_DIR, f"{job_id}_thumbnail{os.path.splitext(thumbnail.filename)[1]}")
            with open(thumbnail_path, "wb") as buffer:
                shutil.copyfileobj(thumbnail.file, buffer)
        
        # Run conversion
        blender_convert(input_path, output_path, thumbnail_path)
        
        # Schedule cleanup
        cleanup_paths = [input_path, output_path]
        if thumbnail_path:
            cleanup_paths.append(thumbnail_path)
        background_tasks.add_task(cleanup_files, *cleanup_paths)
        
        # Determine output filename based on input filename
        base_name = os.path.splitext(file.filename)[0] if file.filename else "converted"
        output_filename = f"{base_name}.vrm"
        
        return FileResponse(
            path=output_path,
            filename=output_filename,
            media_type="application/octet-stream"
        )
    except Exception as e:
        # Cleanup on error
        cleanup_files(input_path, output_path)
        if thumbnail_path:
            cleanup_files(thumbnail_path)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    # Check if Blender is available
    blender_available = Path(BLENDER_PATH).exists()
    script_available = CONVERSION_SCRIPT.exists()
    
    status = "online"
    if not blender_available:
        status = "error"
    if not script_available:
        status = "error"
    
    return {
        "status": status,
        "blender": "ready" if blender_available else "not found",
        "script": "ready" if script_available else "not found"
    }


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "service": "GLB to VRM Converter",
        "version": "1.0.0",
        "endpoints": {
            "convert": "/convert",
            "health": "/health"
        }
    }

