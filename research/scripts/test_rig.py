#!/usr/bin/env python3
"""
Test Meshy API Rigging endpoint.
Tests adding rigging/armature to 3D models from image-to-3d step.

Usage:
    python test_rig.py                    # Create new rigging tasks (default)
    python test_rig.py --download-only    # Only download from existing tasks
    python test_rig.py --force-new        # Force creation of new tasks (ignore existing)
"""

import sys
import time
import json
import argparse
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from research.scripts.meshy_client import MeshyClient, MeshyAPIError
from research.scripts.test_utils import (
    get_intermediate_outputs_dir,
    load_task_info,
    save_task_info,
    print_task_summary,
    format_duration,
    get_file_size_mb,
    validate_glb_file,
    check_glb_rigging,
    find_image_files
)

def find_latest_image_to_3d_tasks():
    """Find the most recent successful image-to-3d tasks."""
    intermediate_dir = get_intermediate_outputs_dir()
    
    # Find all image_to_3d task info files
    task_files = list(intermediate_dir.glob("image_to_3d_*.json"))
    
    tasks = []
    for task_file in task_files:
        # Extract task_id from filename
        task_id = task_file.stem.replace("image_to_3d_", "")
        task_info = load_task_info(task_id, "image_to_3d", intermediate_dir)
        if task_info and task_info.get("data", {}).get("status") == "SUCCEEDED":
            tasks.append(task_info)
    
    # Sort by timestamp, most recent first
    tasks.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    return tasks

def find_existing_rigging_task(input_task_id: str, intermediate_dir):
    """Check if a rigging task already exists for this input_task_id."""
    # Look for rigging task info files
    rig_files = list(intermediate_dir.glob("rigging_*.json"))
    for rig_file in rig_files:
        rig_task_id = rig_file.stem.replace("rigging_", "")
        task_info = load_task_info(rig_task_id, "rigging", intermediate_dir)
        if task_info and task_info.get("data", {}).get("input_task_id") == input_task_id:
            status = task_info.get("data", {}).get("status")
            return rig_task_id, status
    return None, None

def test_rigging(input_task_id: str, client: MeshyClient, test_name: str, use_existing: bool = True, force_new: bool = False):
    """Test rigging for a single model."""
    print(f"\n{'='*60}")
    print(f"Testing Rigging: {test_name}")
    print(f"{'='*60}")
    print(f"Input Task ID: {input_task_id}")
    
    intermediate_dir = get_intermediate_outputs_dir()
    start_time = time.time()
    rig_task_id = None
    elapsed = 0
    
    # Check for existing rigging task
    if use_existing and not force_new:
        existing_rig_id, existing_status = find_existing_rigging_task(input_task_id, intermediate_dir)
        if existing_rig_id:
            print(f"\n✓ Found existing rigging task: {existing_rig_id}")
            if existing_status == "SUCCEEDED":
                print("   Task already completed, fetching status to download files...")
                rig_task_id = existing_rig_id
                elapsed = 0  # Don't count elapsed time for existing tasks
            elif existing_status == "FAILED":
                print("   Previous task failed, creating new task...")
                rig_task_id = None
            else:
                print(f"   Task status: {existing_status}, polling for completion...")
                rig_task_id = existing_rig_id
    
    # Create new rigging task if needed
    if not rig_task_id:
        if use_existing and not force_new:
            # This means we're in download-only mode and no existing task found
            print("\n⚠️  No existing rigging task found and --download-only is set")
            print("   Skipping task creation. Use without --download-only to create new tasks.")
            return None
        
        print("\n📤 Submitting rigging task...")
        try:
            rig_task_id = client.create_rigging_task(input_task_id)
            print(f"✓ Rigging task created: {rig_task_id}")
            start_time = time.time()  # Reset timer for new task
        except MeshyAPIError as e:
            print(f"❌ Failed to create rigging task: {e}")
            return None
    
    # Save/update task info
    task_info = {
        "test_name": test_name,
        "input_task_id": input_task_id,
        "rig_task_id": rig_task_id,
        "created_at": datetime.now().isoformat()
    }
    save_task_info(rig_task_id, "rigging", task_info)
    
    # Poll for completion (or fetch if already completed)
    print("\n⏳ Polling for rigging completion...")
    try:
        if elapsed == 0:  # Already completed, just fetch status
            final_status = client.get_rigging_status(rig_task_id)
            print(f"✓ Task already completed")
        else:
            final_status = client.wait_for_task(
                client.get_rigging_status,
                rig_task_id,
                poll_interval=10,  # Check every 10 seconds
                max_wait=1800,  # 30 minutes max
                verbose=True
            )
            elapsed = time.time() - start_time
            print(f"\n✓ Rigging completed in {format_duration(elapsed)}")
        
        # Print summary
        print_task_summary(rig_task_id, "Rigging", final_status)
        
        # Download GLB file
        # Rigging API returns result.rigged_character_glb_url (not model_urls.glb)
        glb_url = None
        if "result" in final_status:
            result = final_status["result"]
            if isinstance(result, dict):
                if "rigged_character_glb_url" in result:
                    glb_url = result["rigged_character_glb_url"]
                elif "glb" in result:
                    glb_url = result["glb"]
        
        # Fallback to model_urls format (for other endpoints)
        if not glb_url and "model_urls" in final_status and "glb" in final_status["model_urls"]:
            glb_url = final_status["model_urls"]["glb"]
        
        if glb_url:
            print(f"\n📥 Downloading rigged GLB file...")
            print(f"   URL: {glb_url}")
            
            output_dir = get_intermediate_outputs_dir()
            glb_filename = f"{test_name}_rigged.glb"
            glb_path = output_dir / glb_filename
            
            try:
                client.download_file(glb_url, glb_path)
                glb_size = get_file_size_mb(glb_path)
                print(f"✓ Downloaded: {glb_filename} ({glb_size:.2f} MB)")
                
                # Validate GLB
                if validate_glb_file(glb_path):
                    print("✓ GLB file validation: PASSED")
                    
                    # Check for rigging data
                    rigging_info = check_glb_rigging(glb_path)
                    if rigging_info.get("error"):
                        print(f"⚠️  Rigging check error: {rigging_info['error']}")
                    elif rigging_info.get("has_rigging"):
                        print(f"✓ Rigging detected: {rigging_info['skin_count']} skin(s), {rigging_info['joint_count']} joint(s)")
                        if rigging_info.get("joint_names"):
                            print(f"   Joints: {', '.join(rigging_info['joint_names'][:10])}")
                            if len(rigging_info['joint_names']) > 10:
                                print(f"   ... and {len(rigging_info['joint_names']) - 10} more")
                    else:
                        print("⚠️  No rigging data found in GLB file")
                else:
                    print("⚠️  GLB file validation: WARNING (file may be invalid)")
                
                # Update task info with results
                task_info.update({
                    "status": "SUCCEEDED",
                    "elapsed_seconds": elapsed if elapsed > 0 else None,
                    "glb_path": str(glb_path),
                    "glb_size_mb": glb_size,
                    "completed_at": datetime.now().isoformat()
                })
                save_task_info(rig_task_id, "rigging", task_info)
                
                return {
                    "rig_task_id": rig_task_id,
                    "glb_path": glb_path,
                    "elapsed": elapsed,
                    "status": final_status
                }
            except Exception as e:
                print(f"❌ Failed to download GLB: {e}")
                return None
        else:
            print("⚠️  No GLB URL in response")
            print(f"   Response keys: {list(final_status.keys())}")
            if "result" in final_status:
                print(f"   Result keys: {list(final_status['result'].keys())}")
            return None
            
    except MeshyAPIError as e:
        elapsed = time.time() - start_time if start_time else 0
        print(f"\n❌ Rigging failed after {format_duration(elapsed)}: {e}")
        task_info.update({
            "status": "FAILED",
            "error": str(e),
            "elapsed_seconds": elapsed
        })
        save_task_info(rig_task_id, "rigging", task_info)
        return None

def main():
    """Main test function."""
    parser = argparse.ArgumentParser(
        description="Test Meshy API Rigging endpoint",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python test_rig.py                    # Create new rigging tasks (default)
  python test_rig.py --download-only    # Only download from existing tasks
  python test_rig.py --force-new        # Force creation of new tasks
        """
    )
    parser.add_argument(
        "--download-only",
        action="store_true",
        help="Only download from existing completed rigging tasks (skip task creation)"
    )
    parser.add_argument(
        "--force-new",
        action="store_true",
        help="Force creation of new rigging tasks (ignore existing tasks)"
    )
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("Meshy API - Rigging Testing")
    print("=" * 60)
    print()
    
    if args.download_only:
        print("ℹ️  Mode: Download-only (will not create new tasks)")
    elif args.force_new:
        print("ℹ️  Mode: Force new (will create new tasks even if existing)")
    else:
        print("ℹ️  Mode: Default (will use existing tasks if available, create if not)")
    print()
    
    # Initialize client
    try:
        client = MeshyClient()
        print("✓ MeshyClient initialized")
    except Exception as e:
        print(f"❌ Failed to initialize client: {e}")
        return 1
    
    # Find successful image-to-3d tasks
    print("\n🔍 Looking for completed image-to-3d tasks...")
    tasks = find_latest_image_to_3d_tasks()
    
    if not tasks:
        print("❌ No successful image-to-3d tasks found!")
        print("   Run test_image_to_3d.py first to generate models")
        return 1
    
    print(f"✓ Found {len(tasks)} completed image-to-3d task(s):")
    for task in tasks:
        task_id = task.get("task_id")
        test_name = task.get("data", {}).get("test_name", "unknown")
        print(f"   - {test_name}: {task_id}")
    
    results = []
    
    # Test rigging for each model
    for i, task in enumerate(tasks, 1):
        task_id = task.get("task_id")
        test_name = task.get("data", {}).get("test_name", f"model_{i}")
        
        # Determine mode
        if args.download_only:
            use_existing = True
            force_new = False
        elif args.force_new:
            use_existing = False
            force_new = True
        else:
            use_existing = True
            force_new = False
        
        result = test_rigging(task_id, client, test_name, use_existing=use_existing, force_new=force_new)
        if result:
            results.append(result)
        
        # Wait a bit between tests to avoid rate limits
        if i < len(tasks):
            print("\n⏸️  Waiting 5 seconds before next test...")
            time.sleep(5)
    
    # Summary
    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)
    print(f"Total models tested: {len(tasks)}")
    print(f"Successful rigging operations: {len(results)}")
    
    if results:
        print("\n✓ Successful rigging operations:")
        for result in results:
            print(f"   - Rig Task ID: {result['rig_task_id']}")
            print(f"     GLB: {result['glb_path'].name}")
            if result['elapsed'] > 0:
                print(f"     Time: {format_duration(result['elapsed'])}")
            print(f"     ⚠️  Save this rig_task_id for animation step!")
    
    if len(results) < len(tasks):
        print(f"\n⚠️  {len(tasks) - len(results)} rigging operation(s) failed")
    
    print("=" * 60)
    
    return 0 if len(results) == len(tasks) else 1

if __name__ == "__main__":
    sys.exit(main())

