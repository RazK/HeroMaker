"""
VRM Conversion Service - Convert GLB files to VRM format using containerized Blender service.
"""

import requests
from pathlib import Path
from typing import Optional
import os

from app.config.settings import VRM_CONVERTER_SERVICE_URL, VRM_CONVERTER_TIMEOUT


def convert_glb_to_vrm(glb_path: Path, vrm_path: Path, blender_path: Optional[Path] = None, thumbnail_path: Optional[Path] = None) -> Path:
    """
    Convert GLB file to VRM format using the containerized VRM converter service.
    
    Args:
        glb_path: Path to input GLB file
        vrm_path: Path where VRM file should be saved
        blender_path: Deprecated - kept for backward compatibility, ignored
        thumbnail_path: Optional path to thumbnail/preview image (PNG/JPG)
    
    Returns:
        Path to output VRM file
    
    Raises:
        FileNotFoundError: If input file not found
        RuntimeError: If conversion fails
        requests.RequestException: If HTTP request fails
    """
    if not glb_path.exists():
        raise FileNotFoundError(f"Input GLB file not found: {glb_path}")
    
    if thumbnail_path and not thumbnail_path.exists():
        raise FileNotFoundError(f"Thumbnail file not found: {thumbnail_path}")
    
    # Ensure output directory exists
    vrm_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Prepare the conversion request
    service_url = f"{VRM_CONVERTER_SERVICE_URL.rstrip('/')}/convert"
    
    try:
        # Prepare files for upload - need both files open simultaneously
        files = {}
        file_handles = []
        
        # Open the GLB file
        glb_file = open(glb_path, 'rb')
        file_handles.append(glb_file)
        files['file'] = (glb_path.name, glb_file, 'model/gltf-binary')
        
        # Add thumbnail if provided
        if thumbnail_path:
            thumb_file = open(thumbnail_path, 'rb')
            file_handles.append(thumb_file)
            thumb_ext = thumbnail_path.suffix.lower()
            thumb_mime = 'image/png' if thumb_ext == '.png' else 'image/jpeg'
            files['thumbnail'] = (thumbnail_path.name, thumb_file, thumb_mime)
        
        try:
            response = requests.post(
                service_url,
                files=files,
                timeout=VRM_CONVERTER_TIMEOUT,
                stream=True
            )
            
            # Check for HTTP errors
            response.raise_for_status()
            
            # Save the VRM file
            with open(vrm_path, 'wb') as vrm_file:
                for chunk in response.iter_content(chunk_size=8192):
                    vrm_file.write(chunk)
        finally:
            # Close all file handles
            for fh in file_handles:
                fh.close()
        
        # Verify the output file was created
        if not vrm_path.exists() or vrm_path.stat().st_size == 0:
            raise RuntimeError(
                f"VRM conversion reported success but output file not found or empty.\n"
                f"Service URL: {service_url}\n"
                f"Response status: {response.status_code}"
            )
        
        return vrm_path
        
    except requests.exceptions.Timeout:
        raise RuntimeError(f"VRM conversion timed out after {VRM_CONVERTER_TIMEOUT} seconds")
    except requests.exceptions.ConnectionError as e:
        raise RuntimeError(
            f"Failed to connect to VRM converter service at {service_url}.\n"
            f"Make sure the service is running and accessible.\n"
            f"Error: {str(e)}"
        )
    except requests.exceptions.HTTPError as e:
        error_detail = "Unknown error"
        try:
            error_detail = e.response.text
        except:
            pass
        raise RuntimeError(
            f"VRM conversion failed with HTTP error:\n"
            f"Status code: {e.response.status_code}\n"
            f"Error: {error_detail}"
        )
    except requests.RequestException as e:
        raise RuntimeError(f"VRM conversion request failed: {str(e)}")
