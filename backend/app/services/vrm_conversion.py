"""
VRM Conversion Service - Convert GLB files to VRM format using Blender.

TODO: Dockerize Blender conversion for production deployment
- Create Docker image with Blender + VRM addon
- Container orchestration
- Resource limits
- Scaling strategy

For now, uses local Blender installation.
"""

import subprocess
import shutil
from pathlib import Path
from typing import Optional
import os


def find_blender_executable() -> Path:
    """
    Find Blender executable in common locations.
    
    Returns:
        Path to Blender executable
    
    Raises:
        FileNotFoundError: If Blender not found
    """
    # Common Blender locations
    possible_paths = [
        Path("/Applications/Blender.app/Contents/MacOS/Blender"),  # macOS
        Path.home() / "Applications/Blender.app/Contents/MacOS/Blender",  # macOS user
        Path("/usr/bin/blender"),  # Linux
        Path("/usr/local/bin/blender"),  # Linux local
        Path("C:/Program Files/Blender Foundation/Blender/blender.exe"),  # Windows
        Path("C:/Program Files (x86)/Blender Foundation/Blender/blender.exe"),  # Windows 32-bit
    ]
    
    # Also check PATH
    blender_from_path = shutil.which("blender")
    if blender_from_path:
        possible_paths.insert(0, Path(blender_from_path))
    
    for path in possible_paths:
        if path.exists() and path.is_file():
            return path
    
    raise FileNotFoundError(
        "Blender executable not found. Please install Blender or set BLENDER_PATH environment variable."
    )


def convert_glb_to_vrm(glb_path: Path, vrm_path: Path, blender_path: Optional[Path] = None) -> Path:
    """
    Convert GLB file to VRM format using Blender.
    
    Args:
        glb_path: Path to input GLB file
        vrm_path: Path where VRM file should be saved
        blender_path: Optional path to Blender executable (auto-detected if not provided)
    
    Returns:
        Path to output VRM file
    
    Raises:
        FileNotFoundError: If Blender or input file not found
        subprocess.CalledProcessError: If conversion fails
    """
    if not glb_path.exists():
        raise FileNotFoundError(f"Input GLB file not found: {glb_path}")
    
    # Find Blender executable
    if blender_path:
        blender_exe = blender_path
    elif os.getenv("BLENDER_PATH"):
        blender_exe = Path(os.getenv("BLENDER_PATH"))
    else:
        blender_exe = find_blender_executable()
    
    if not blender_exe.exists():
        raise FileNotFoundError(f"Blender executable not found: {blender_exe}")
    
    # Ensure output directory exists
    vrm_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Get path to conversion script
    # The script is in backend/scripts/
    backend_dir = Path(__file__).parent.parent.parent
    conversion_script = backend_dir / "scripts" / "convert_glb_to_vrm.py"
    
    if not conversion_script.exists():
        raise FileNotFoundError(f"Conversion script not found: {conversion_script}")
    
    # Run Blender with the conversion script
    # Format: blender --background --python script.py -- input.glb output.vrm
    cmd = [
        str(blender_exe),
        "--background",
        "--python",
        str(conversion_script),
        "--",
        str(glb_path),
        str(vrm_path)
    ]
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True,
            timeout=300  # 5 minute timeout
        )
        
        if not vrm_path.exists():
            raise RuntimeError(
                f"VRM conversion reported success but output file not found.\n"
                f"Blender output: {result.stdout}\n"
                f"Blender errors: {result.stderr}"
            )
        
        return vrm_path
        
    except subprocess.TimeoutExpired:
        raise RuntimeError("VRM conversion timed out after 5 minutes")
    except subprocess.CalledProcessError as e:
        raise RuntimeError(
            f"VRM conversion failed:\n"
            f"Return code: {e.returncode}\n"
            f"Stdout: {e.stdout}\n"
            f"Stderr: {e.stderr}"
        ) from e

