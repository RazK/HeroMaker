#!/usr/bin/env python3
"""
Test Meshy API Image-to-3D endpoint.
Tests converting PNG images to 3D models using base64 data URIs.
"""

import sys
import time
import base64
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from research.scripts.meshy_client import MeshyClient, MeshyAPIError
from research.scripts.test_utils import (
    get_input_images_dir,
    get_intermediate_outputs_dir,
    find_image_files,
    save_task_info,
    print_task_summary,
    format_duration,
    get_file_size_mb,
    validate_glb_file
)

def image_to_data_uri(image_path: Path) -> str:
    """
    Convert local image file to base64 data URI.
    Meshy API accepts data URIs instead of requiring public URLs.
    """
    # Read image file
    with open(image_path, "rb") as f:
        image_data = f.read()
    
    # Determine MIME type from extension
    ext = image_path.suffix.lower()
    mime_types = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg"
    }
    mime_type = mime_types.get(ext, "image/png")
    
    # Encode to base64
    base64_data = base64.b64encode(image_data).decode("utf-8")
    
    # Return data URI
    return f"data:{mime_type};base64,{base64_data}"

def test_image_to_3d(image_path: Path, client: MeshyClient, test_name: str):
    """Test image-to-3D conversion for a single image."""
    print(f"\n{'='*60}")
    print(f"Testing: {image_path.name}")
    print(f"{'='*60}")
    
    # Convert image to data URI
    print("📸 Converting image to base64 data URI...")
    image_data_uri = image_to_data_uri(image_path)
    data_uri_size = len(image_data_uri) / (1024 * 1024)  # Size in MB
    print(f"✓ Data URI created ({data_uri_size:.2f} MB)")
    print(f"Image size: {get_file_size_mb(image_path):.2f} MB")
    
    # Create task
    print("\n📤 Submitting image-to-3D task...")
    start_time = time.time()
    
    try:
        task_id = client.create_image_to_3d_task(
            image_url=image_data_uri,  # Using data URI instead of URL
            ai_model="meshy-5",  # Using meshy-5 model
            pose_mode="t-pose",  # Images are in T-pose from ChatGPT
            should_texture=True,  # Get textures in same call (skip texture step)
            should_remesh=True,  # Remesh in same call (skip remesh step)
            target_polycount=30000,  # Set desired polycount directly
            topology="triangle",  # or "quad"
            enable_pbr=False,
            save_pre_remeshed_model=False
        )
        print(f"✓ Task created: {task_id}")
    except MeshyAPIError as e:
        print(f"❌ Failed to create task: {e}")
        return None
    
    # Save task info
    task_info = {
        "test_name": test_name,
        "image_path": str(image_path),
        "image_size_mb": get_file_size_mb(image_path),
        "data_uri_size_mb": data_uri_size,
        "task_id": task_id,
        "created_at": datetime.now().isoformat()
    }
    save_task_info(task_id, "image_to_3d", task_info)
    
    # Poll for completion
    print("\n⏳ Polling for task completion...")
    try:
        final_status = client.wait_for_task(
            client.get_image_to_3d_status,
            task_id,
            poll_interval=10,  # Check every 10 seconds
            max_wait=1800,  # 30 minutes max
            verbose=True
        )
        
        elapsed = time.time() - start_time
        print(f"\n✓ Task completed in {format_duration(elapsed)}")
        
        # Print summary
        print_task_summary(task_id, "Image-to-3D", final_status)
        
        # Download GLB file
        if "model_urls" in final_status and "glb" in final_status["model_urls"]:
            glb_url = final_status["model_urls"]["glb"]
            print(f"\n📥 Downloading GLB file...")
            print(f"   URL: {glb_url}")
            
            output_dir = get_intermediate_outputs_dir()
            glb_filename = f"{test_name}_model.glb"
            glb_path = output_dir / glb_filename
            
            try:
                client.download_file(glb_url, glb_path)
                glb_size = get_file_size_mb(glb_path)
                print(f"✓ Downloaded: {glb_filename} ({glb_size:.2f} MB)")
                
                # Validate GLB
                if validate_glb_file(glb_path):
                    print("✓ GLB file validation: PASSED")
                else:
                    print("⚠️  GLB file validation: WARNING (file may be invalid)")
                
                # Update task info with results
                task_info.update({
                    "status": "SUCCEEDED",
                    "elapsed_seconds": elapsed,
                    "glb_path": str(glb_path),
                    "glb_size_mb": glb_size,
                    "completed_at": datetime.now().isoformat()
                })
                save_task_info(task_id, "image_to_3d", task_info)
                
                return {
                    "task_id": task_id,
                    "glb_path": glb_path,
                    "elapsed": elapsed,
                    "status": final_status
                }
            except Exception as e:
                print(f"❌ Failed to download GLB: {e}")
                return None
        else:
            print("⚠️  No GLB URL in response")
            return None
            
    except MeshyAPIError as e:
        elapsed = time.time() - start_time
        print(f"\n❌ Task failed after {format_duration(elapsed)}: {e}")
        task_info.update({
            "status": "FAILED",
            "error": str(e),
            "elapsed_seconds": elapsed
        })
        save_task_info(task_id, "image_to_3d", task_info)
        return None

def main():
    """Main test function."""
    print("=" * 60)
    print("Meshy API - Image-to-3D Model Testing")
    print("=" * 60)
    print()
    
    # Initialize client
    try:
        client = MeshyClient()
        print("✓ MeshyClient initialized")
    except Exception as e:
        print(f"❌ Failed to initialize client: {e}")
        return 1
    
    # Find test images
    image_files = find_image_files()
    if not image_files:
        print("❌ No test images found!")
        print(f"   Expected location: {get_input_images_dir()}")
        return 1
    
    print(f"\n📁 Found {len(image_files)} test image(s):")
    for img in image_files:
        print(f"   - {img.name} ({get_file_size_mb(img):.2f} MB)")
    
    print("\nℹ️  Using base64 data URIs (no public URL needed)")
    
    results = []
    
    # Test each image
    for i, image_path in enumerate(image_files, 1):
        test_name = image_path.stem.lower().replace(" ", "_")
        
        result = test_image_to_3d(image_path, client, test_name)
        if result:
            results.append(result)
        
        # Wait a bit between tests to avoid rate limits
        if i < len(image_files):
            print("\n⏸️  Waiting 5 seconds before next test...")
            time.sleep(5)
    
    # Summary
    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)
    print(f"Total images tested: {len(image_files)}")
    print(f"Successful conversions: {len(results)}")
    
    if results:
        print("\n✓ Successful conversions:")
        for result in results:
            print(f"   - Task ID: {result['task_id']}")
            print(f"     GLB: {result['glb_path'].name}")
            print(f"     Time: {format_duration(result['elapsed'])}")
    
    if len(results) < len(image_files):
        print(f"\n⚠️  {len(image_files) - len(results)} conversion(s) failed")
    
    print("=" * 60)
    
    return 0 if len(results) == len(image_files) else 1

if __name__ == "__main__":
    sys.exit(main())
