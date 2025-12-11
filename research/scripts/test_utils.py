"""
Utility functions for Meshy API testing.
"""

import os
import json
from pathlib import Path
from typing import Dict, Any, Optional, List
from datetime import datetime

def get_project_root() -> Path:
    """Get the project root directory."""
    return Path(__file__).parent.parent.parent

def get_test_data_dir() -> Path:
    """Get the test data directory."""
    return get_project_root() / "assets" / "research" / "test_data"

def get_input_images_dir() -> Path:
    """Get the input images directory."""
    return get_test_data_dir() / "input_images"

def get_intermediate_outputs_dir() -> Path:
    """Get the intermediate outputs directory."""
    return get_test_data_dir() / "intermediate_outputs"

def get_final_outputs_dir() -> Path:
    """Get the final outputs directory."""
    return get_test_data_dir() / "final_outputs"

def ensure_directory(path: Path) -> Path:
    """Ensure directory exists, create if it doesn't."""
    path.mkdir(parents=True, exist_ok=True)
    return path

def save_task_info(task_id: str, step_name: str, data: Dict[str, Any], output_dir: Optional[Path] = None):
    """
    Save task information to JSON file for tracking.
    
    Args:
        task_id: Task ID
        step_name: Name of the pipeline step
        data: Task data to save
        output_dir: Directory to save to (defaults to intermediate_outputs)
    """
    if output_dir is None:
        output_dir = get_intermediate_outputs_dir()
    
    ensure_directory(output_dir)
    
    filename = f"{step_name}_{task_id}.json"
    filepath = output_dir / filename
    
    task_info = {
        "task_id": task_id,
        "step_name": step_name,
        "timestamp": datetime.now().isoformat(),
        "data": data
    }
    
    with open(filepath, "w") as f:
        json.dump(task_info, f, indent=2)
    
    return filepath

def load_task_info(task_id: str, step_name: str, output_dir: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    """
    Load task information from JSON file.
    
    Args:
        task_id: Task ID
        step_name: Name of the pipeline step
        output_dir: Directory to load from (defaults to intermediate_outputs)
    
    Returns:
        Task info dictionary or None if not found
    """
    if output_dir is None:
        output_dir = get_intermediate_outputs_dir()
    
    filename = f"{step_name}_{task_id}.json"
    filepath = output_dir / filename
    
    if not filepath.exists():
        return None
    
    with open(filepath, "r") as f:
        return json.load(f)

def find_image_files(directory: Optional[Path] = None) -> List[Path]:
    """
    Find all image files in directory.
    
    Args:
        directory: Directory to search (defaults to input_images)
    
    Returns:
        List of image file paths
    """
    if directory is None:
        directory = get_input_images_dir()
    
    if not directory.exists():
        return []
    
    image_extensions = {".png", ".jpg", ".jpeg", ".PNG", ".JPG", ".JPEG"}
    image_files = []
    
    for ext in image_extensions:
        image_files.extend(directory.glob(f"*{ext}"))
    
    return sorted(image_files)

def get_file_size_mb(filepath: Path) -> float:
    """Get file size in megabytes."""
    if not filepath.exists():
        return 0.0
    return filepath.stat().st_size / (1024 * 1024)

def format_duration(seconds: float) -> str:
    """Format duration in seconds to human-readable string."""
    if seconds < 60:
        return f"{seconds:.1f}s"
    elif seconds < 3600:
        minutes = int(seconds // 60)
        secs = seconds % 60
        return f"{minutes}m {secs:.1f}s"
    else:
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = seconds % 60
        return f"{hours}h {minutes}m {secs:.1f}s"

def print_task_summary(task_id: str, step_name: str, status: Dict[str, Any]):
    """
    Print a formatted summary of task status.
    
    Args:
        task_id: Task ID
        step_name: Name of the pipeline step
        status: Status dictionary from API
    """
    print("\n" + "=" * 60)
    print(f"Task Summary: {step_name}")
    print("=" * 60)
    print(f"Task ID: {task_id}")
    print(f"Status: {status.get('status', 'UNKNOWN')}")
    print(f"Progress: {status.get('progress', 0)}%")
    
    if "model_urls" in status:
        print("\nModel URLs:")
        for format_type, url in status["model_urls"].items():
            print(f"  {format_type.upper()}: {url}")
    
    if "error" in status:
        error = status["error"]
        print(f"\nError: {error.get('message', 'Unknown error')}")
        if "code" in error:
            print(f"Error Code: {error['code']}")
    
    print("=" * 60 + "\n")

def validate_glb_file(filepath: Path) -> bool:
    """
    Basic validation that file is a GLB file.
    
    Args:
        filepath: Path to file
    
    Returns:
        True if file appears to be valid GLB
    """
    if not filepath.exists():
        return False
    
    # GLB files start with "glTF" magic number
    try:
        with open(filepath, "rb") as f:
            header = f.read(4)
            # GLB files have "glTF" at offset 0
            return header == b"glTF" or filepath.suffix.lower() == ".glb"
    except:
        return False

def check_glb_rigging(filepath: Path) -> Dict[str, Any]:
    """
    Check if GLB file contains rigging/skeleton data.
    
    Args:
        filepath: Path to GLB file
    
    Returns:
        Dictionary with rigging information:
        {
            "has_rigging": bool,
            "skin_count": int,
            "joint_count": int,
            "joint_names": List[str],
            "error": Optional[str]
        }
    """
    result = {
        "has_rigging": False,
        "skin_count": 0,
        "joint_count": 0,
        "joint_names": [],
        "error": None
    }
    
    if not filepath.exists():
        result["error"] = "File does not exist"
        return result
    
    try:
        from pygltflib import GLTF2
        
        # Load GLB file
        glb = GLTF2.load(str(filepath))
        
        # Check for skins (rigging data)
        if glb.skins and len(glb.skins) > 0:
            result["has_rigging"] = True
            result["skin_count"] = len(glb.skins)
            
            # Collect all unique joints
            all_joints = set()
            for skin in glb.skins:
                if skin.joints:
                    all_joints.update(skin.joints)
            
            result["joint_count"] = len(all_joints)
            
            # Get joint names
            if glb.nodes:
                joint_names = []
                for joint_idx in sorted(all_joints):
                    if joint_idx < len(glb.nodes):
                        node = glb.nodes[joint_idx]
                        name = node.name if node.name else f"Joint_{joint_idx}"
                        joint_names.append(name)
                result["joint_names"] = joint_names
        
        return result
        
    except ImportError:
        result["error"] = "pygltflib not installed. Run: pip install pygltflib"
        return result
    except Exception as e:
        result["error"] = f"Error reading GLB file: {str(e)}"
        return result

def create_test_log(log_name: str) -> Path:
    """
    Create a log file for test run.
    
    Args:
        log_name: Name of the log file
    
    Returns:
        Path to log file
    """
    log_dir = get_project_root() / "research" / "logs"
    ensure_directory(log_dir)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = log_dir / f"{log_name}_{timestamp}.log"
    
    return log_file
