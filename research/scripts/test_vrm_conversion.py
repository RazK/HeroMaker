#!/usr/bin/env python3
"""
Test GLB to VRM conversion.
Tests converting rigged GLB files to VRM format using the existing convert_glb_to_vrm.py script.

Usage:
    python test_vrm_conversion.py                    # Convert all rigged GLB files
    python test_vrm_conversion.py --glb <file.glb>  # Convert specific GLB file
"""

import sys
import time
import subprocess
import argparse
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from research.scripts.test_utils import (
    get_intermediate_outputs_dir,
    get_final_outputs_dir,
    ensure_directory,
    get_file_size_mb,
    format_duration,
    validate_vrm_file,
    check_glb_rigging,
)

def find_rigged_glb_files():
    """Find all rigged GLB files in intermediate outputs."""
    intermediate_dir = get_intermediate_outputs_dir()
    
    # Find all rigged GLB files
    glb_files = list(intermediate_dir.glob("*_rigged.glb"))
    
    return sorted(glb_files)

def check_required_bones(glb_path: Path) -> dict:
    """
    Check if GLB file has required bones for VRM conversion.
    
    According to VRM spec, only certain bones are required.
    Optional bones (chest, upperChest, shoulders, toes) have fallbacks.
    
    Returns:
        Dictionary with check results
    """
    # Required bones per VRM spec (must exist)
    required_bones = {
        "Hips": "hips",
        "Spine02": "spine",
        "neck": "neck",
        "Head": "head",
        "LeftArm": "leftUpperArm",
        "LeftForeArm": "leftLowerArm",
        "LeftHand": "leftHand",
        "RightArm": "rightUpperArm",
        "RightForeArm": "rightLowerArm",
        "RightHand": "rightHand",
        "LeftUpLeg": "leftUpperLeg",
        "LeftLeg": "leftLowerLeg",
        "LeftFoot": "leftFoot",
        "RightUpLeg": "rightUpperLeg",
        "RightLeg": "rightLowerLeg",
        "RightFoot": "rightFoot"
    }
    
    # Optional bones (have fallbacks in VRM spec)
    optional_bones = {
        "Spine01": "chest",
        "Spine": "upperChest",
        "LeftShoulder": "leftShoulder",
        "RightShoulder": "rightShoulder",
        "LeftToeBase": "leftToes",
        "RightToeBase": "rightToes"
    }
    
    result = {
        "has_required_bones": False,
        "missing_required": [],
        "missing_optional": [],
        "required_bones": list(required_bones.keys()),
        "optional_bones": list(optional_bones.keys())
    }
    
    rigging_info = check_glb_rigging(glb_path)
    
    if not rigging_info.get("has_rigging"):
        result["missing_required"] = result["required_bones"]
        return result
    
    joint_names = set(rigging_info.get("joint_names", []))
    
    # Check required bones
    missing_required = [bone for bone in result["required_bones"] if bone not in joint_names]
    result["missing_required"] = missing_required
    result["has_required_bones"] = len(missing_required) == 0
    
    # Check optional bones (for info only)
    missing_optional = [bone for bone in result["optional_bones"] if bone not in joint_names]
    result["missing_optional"] = missing_optional
    
    return result

def convert_glb_to_vrm(glb_path: Path, output_dir: Path, test_name: str) -> dict:
    """
    Convert GLB file to VRM using Blender script.
    
    Args:
        glb_path: Path to input GLB file
        output_dir: Directory to save VRM file
        test_name: Name for the test (used in output filename)
    
    Returns:
        Dictionary with conversion results
    """
    ensure_directory(output_dir)
    
    vrm_filename = f"{test_name}.vrm"
    vrm_path = output_dir / vrm_filename
    
    print(f"\n📦 Converting: {glb_path.name}")
    print(f"   Input: {glb_path}")
    print(f"   Output: {vrm_path}")
    
    # Check for required bones before attempting conversion
    bone_check = check_required_bones(glb_path)
    if not bone_check["has_required_bones"]:
        missing = bone_check["missing_required"]
        return {
            "success": False,
            "error": f"Missing required bones for VRM conversion: {', '.join(missing)}",
            "missing_required": missing,
            "missing_optional": bone_check.get("missing_optional", []),
            "note": "VRM format requires specific bone hierarchy. This model may need additional rigging."
        }
    
    # Warn about missing optional bones
    # Note: Blender VRM addon requires 'chest' (Spine01) even though VRM spec says it's optional
    if bone_check.get("missing_optional"):
        missing_opt = bone_check["missing_optional"]
        if "Spine01" in missing_opt:
            print(f"   ⚠️  Missing 'Spine01' (chest) - Blender VRM addon requires this bone")
            print(f"      Note: VRM spec allows optional chest, but Blender addon doesn't support fallback")
            print(f"      This conversion may fail. Model needs complete rig (24+ joints) for VRM conversion.")
        else:
            print(f"   ⚠️  Missing optional bones: {', '.join(missing_opt)} (may cause conversion issues)")
    
    # Check if Blender is available
    blender_cmd = None
    
    # Common Blender locations
    possible_paths = [
        "blender",  # In PATH
        "blender.exe",  # Windows
        "/Applications/Blender.app/Contents/MacOS/Blender",  # macOS default
        "/usr/bin/blender",  # Linux
        "/opt/blender/blender",  # Linux alternative
    ]
    
    for cmd in possible_paths:
        try:
            result = subprocess.run(
                [cmd, "--version"],
                capture_output=True,
                timeout=5
            )
            if result.returncode == 0:
                blender_cmd = cmd
                break
        except (FileNotFoundError, subprocess.TimeoutExpired, PermissionError):
            continue
    
    if not blender_cmd:
        return {
            "success": False,
            "error": "Blender not found. Please install Blender and ensure it's in PATH."
        }
    
    # Get the conversion script path
    project_root = Path(__file__).parent.parent.parent
    conversion_script = project_root / "convert_glb_to_vrm.py"
    
    if not conversion_script.exists():
        return {
            "success": False,
            "error": f"Conversion script not found: {conversion_script}"
        }
    
    start_time = time.time()
    
    # Run Blender in background mode with the conversion script
    # Format: blender --background --python script.py -- input.glb output.vrm
    try:
        cmd = [
            blender_cmd,
            "--background",
            "--python",
            str(conversion_script),
            "--",
            str(glb_path),
            str(vrm_path)
        ]
        
        print(f"   Running: {' '.join(cmd[:4])} ... -- {glb_path.name} {vrm_filename}")
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300  # 5 minute timeout
        )
        
        elapsed = time.time() - start_time
        
        # Small delay to ensure file system sync
        time.sleep(0.5)
        
        if result.returncode != 0:
            error_msg = result.stderr or result.stdout or "Unknown error"
            return {
                "success": False,
                "error": error_msg,
                "elapsed": elapsed
            }
        
        # Check if VRM file was created
        if not vrm_path.exists():
            # Show Blender output for debugging
            output_lines = result.stdout.split('\n') if result.stdout else []
            error_lines = result.stderr.split('\n') if result.stderr else []
            
            # Look for error messages in output
            error_msg = "VRM file was not created"
            if error_lines:
                # Get last few error lines
                relevant_errors = [line for line in error_lines[-10:] if line.strip() and 'Error' in line]
                if relevant_errors:
                    error_msg = relevant_errors[-1]
            
            return {
                "success": False,
                "error": error_msg,
                "elapsed": elapsed,
                "blender_stdout": result.stdout,
                "blender_stderr": result.stderr
            }
        
        # Validate VRM file
        vrm_size = get_file_size_mb(vrm_path)
        validation_result = validate_vrm_file(vrm_path)
        
        return {
            "success": True,
            "vrm_path": vrm_path,
            "vrm_size_mb": vrm_size,
            "elapsed": elapsed,
            "validation": validation_result,
            "blender_output": result.stdout
        }
        
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "error": "Conversion timed out after 5 minutes",
            "elapsed": time.time() - start_time
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Conversion failed: {str(e)}",
            "elapsed": time.time() - start_time
        }

def main():
    """Main test function."""
    parser = argparse.ArgumentParser(
        description="Test GLB to VRM conversion",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python test_vrm_conversion.py                    # Convert all rigged GLB files
  python test_vrm_conversion.py --glb file.glb    # Convert specific file
        """
    )
    parser.add_argument(
        "--glb",
        type=str,
        help="Specific GLB file to convert (relative to intermediate_outputs)"
    )
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("GLB to VRM Conversion Testing")
    print("=" * 60)
    print()
    
    intermediate_dir = get_intermediate_outputs_dir()
    final_dir = get_final_outputs_dir()
    
    # Find GLB files to convert
    if args.glb:
        glb_path = intermediate_dir / args.glb
        if not glb_path.exists():
            print(f"❌ Error: GLB file not found: {glb_path}")
            return 1
        glb_files = [glb_path]
    else:
        glb_files = find_rigged_glb_files()
        if not glb_files:
            print("❌ No rigged GLB files found in intermediate outputs")
            print(f"   Looking in: {intermediate_dir}")
            return 1
    
    print(f"✓ Found {len(glb_files)} rigged GLB file(s) to convert")
    print()
    
    results = []
    
    for i, glb_path in enumerate(glb_files, 1):
        # Extract test name from filename (e.g., "girl_superhero_rigged.glb" -> "girl_superhero")
        test_name = glb_path.stem.replace("_rigged", "")
        
        print("=" * 60)
        print(f"Testing VRM Conversion: {test_name} ({i}/{len(glb_files)})")
        print("=" * 60)
        
        result = convert_glb_to_vrm(glb_path, final_dir, test_name)
        results.append({
            "test_name": test_name,
            "glb_path": glb_path,
            **result
        })
        
        if result.get("success"):
            print(f"\n✓ Conversion successful!")
            print(f"   VRM file: {result['vrm_path'].name} ({result['vrm_size_mb']:.2f} MB)")
            print(f"   Time: {format_duration(result['elapsed'])}")
            
            if result.get("validation"):
                validation = result["validation"]
                if validation.get("is_valid"):
                    print(f"   Validation: ✓ Valid VRM file")
                else:
                    print(f"   Validation: ⚠️  {validation.get('error', 'Unknown validation issue')}")
        else:
            print(f"\n❌ Conversion failed: {result.get('error', 'Unknown error')}")
            # Show Blender output for debugging
            if result.get('blender_stdout'):
                print("\n   Blender stdout:")
                for line in result['blender_stdout'].split('\n')[-20:]:  # Last 20 lines
                    if line.strip():
                        print(f"     {line}")
            if result.get('blender_stderr'):
                print("\n   Blender stderr:")
                for line in result['blender_stderr'].split('\n')[-20:]:  # Last 20 lines
                    if line.strip():
                        print(f"     {line}")
        
        # Wait between conversions
        if i < len(glb_files):
            print("\n⏸️  Waiting 3 seconds before next conversion...")
            time.sleep(3)
    
    # Summary
    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)
    print(f"Total files tested: {len(glb_files)}")
    print(f"Successful conversions: {sum(1 for r in results if r.get('success'))}")
    print(f"Failed conversions: {sum(1 for r in results if not r.get('success'))}")
    
    if results:
        print("\n✓ Successful conversions:")
        for result in results:
            if result.get("success"):
                print(f"   - {result['test_name']}: {result['vrm_path'].name}")
                if result.get("elapsed"):
                    print(f"     Time: {format_duration(result['elapsed'])}")
        
        failed = [r for r in results if not r.get("success")]
        if failed:
            print("\n❌ Failed conversions:")
            for result in failed:
                print(f"   - {result['test_name']}: {result.get('error', 'Unknown error')}")
    
    print("=" * 60)
    
    return 0 if all(r.get("success") for r in results) else 1

if __name__ == "__main__":
    sys.exit(main())

