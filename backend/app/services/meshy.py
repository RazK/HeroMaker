"""
Meshy API Service - Backend integration for Meshy API endpoints.
Adapted from research/scripts/meshy_client.py
"""

import os
import time
import requests
import base64
from typing import Optional, Dict, Any, List
from pathlib import Path
from app.config.settings import MESHY_API_KEY

class MeshyAPIError(Exception):
    """Custom exception for Meshy API errors."""
    pass

class MeshyClient:
    """Client for interacting with Meshy API."""
    
    BASE_URL = "https://api.meshy.ai"
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize Meshy API client.
        
        Args:
            api_key: Meshy API key. If not provided, reads from settings.
        """
        self.api_key = api_key or MESHY_API_KEY
        if not self.api_key:
            raise ValueError("MESHY_API_KEY not found. Set it in .env file or pass as parameter.")
        
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
    
    def _request(self, method: str, endpoint: str, **kwargs) -> Dict[str, Any]:
        """
        Make HTTP request to Meshy API.
        
        Args:
            method: HTTP method (GET, POST, etc.)
            endpoint: API endpoint (e.g., "/openapi/v1/image-to-3d")
            **kwargs: Additional arguments for requests.request()
        
        Returns:
            JSON response as dictionary
        
        Raises:
            MeshyAPIError: If request fails
        """
        url = f"{self.BASE_URL}{endpoint}"
        
        try:
            response = requests.request(method, url, headers=self.headers, **kwargs)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.HTTPError as e:
            # Try to extract the actual error message from Meshy API response
            error_msg = None
            try:
                error_data = response.json()
                # Meshy API returns error in different formats
                if isinstance(error_data, dict):
                    # Try 'message' field first (most common)
                    if 'message' in error_data:
                        error_msg = error_data['message']
                    # Try 'error' object with 'message'
                    elif 'error' in error_data and isinstance(error_data['error'], dict):
                        error_msg = error_data['error'].get('message')
                    # Try 'detail' field
                    elif 'detail' in error_data:
                        error_msg = error_data['detail']
            except Exception:
                # If JSON parsing fails, try raw response text
                error_msg = response.text[:200] if response.text else None
            
            # Fallback to HTTP status if we couldn't extract a message
            if not error_msg:
                error_msg = f"HTTP {response.status_code}: {str(e)}"
            
            raise MeshyAPIError(error_msg) from e
        except requests.exceptions.RequestException as e:
            raise MeshyAPIError(f"Request failed: {str(e)}") from e
    
    def _path_to_data_uri(self, image_path: Path) -> str:
        """Convert local image file to base64 data URI."""
        with open(image_path, "rb") as f:
            image_data = f.read()
            base64_data = base64.b64encode(image_data).decode("utf-8")
            # Detect MIME type from extension
            ext = image_path.suffix.lower()
            mime_types = {
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".png": "image/png",
                ".gif": "image/gif",
                ".webp": "image/webp"
            }
            mime_type = mime_types.get(ext, "image/jpeg")
            return f"data:{mime_type};base64,{base64_data}"
    
    # Image-to-3D Methods
    
    def create_image_to_3d_task(
        self,
        image_path: Path,
        ai_model: Optional[str] = None,
        should_texture: bool = True,  # Do texturing in same step
        enable_pbr: bool = False,
        should_remesh: bool = True,  # Do remeshing in same step
        save_pre_remeshed_model: bool = False,
        topology: Optional[str] = None,
        target_polycount: Optional[int] = None,
        symmetry_mode: Optional[str] = None,
        pose_mode: Optional[str] = None,
        texture_prompt: Optional[str] = None,
        texture_image_url: Optional[str] = None,
        moderation: bool = False
    ) -> str:
        """
        Create an image-to-3D model generation task.
        By default, includes texturing and remeshing in the same step.
        
        Args:
            image_path: Path to local image file
            ai_model: AI model to use (e.g., "meshy-4", "meshy-5", "latest")
            should_texture: Generate textures (default: True - done in same step)
            enable_pbr: Generate PBR maps (default: False)
            should_remesh: Enable remeshing (default: True - done in same step)
            save_pre_remeshed_model: Save model before remeshing (default: False)
            topology: "quad" or "triangle" (default: "triangle")
            target_polycount: Target polygon count 100-300,000 (default: 30,000)
            symmetry_mode: "off", "auto", or "on" (default: "auto")
            pose_mode: "t-pose", "a-pose", or "" (empty string)
            texture_prompt: Text prompt for texturing (up to 600 chars)
            texture_image_url: Image URL to guide texturing
            moderation: Enable content moderation (default: False)
        
        Returns:
            Task ID
        """
        # Convert local path to data URI
        image_url = self._path_to_data_uri(image_path)
        
        data = {
            "image_url": image_url,
            "should_texture": should_texture,
            "enable_pbr": enable_pbr,
            "should_remesh": should_remesh,
            "save_pre_remeshed_model": save_pre_remeshed_model
        }
        
        # Add optional parameters if provided
        if ai_model:
            data["ai_model"] = ai_model
        if topology:
            data["topology"] = topology
        if target_polycount:
            data["target_polycount"] = target_polycount
        if symmetry_mode:
            data["symmetry_mode"] = symmetry_mode
        if pose_mode:
            data["pose_mode"] = pose_mode
        if texture_prompt:
            data["texture_prompt"] = texture_prompt
        if texture_image_url:
            data["texture_image_url"] = texture_image_url
        if moderation:
            data["moderation"] = moderation
        
        response = self._request("POST", "/openapi/v1/image-to-3d", json=data)
        return response.get("result")
    
    def get_image_to_3d_status(self, task_id: str) -> Dict[str, Any]:
        """Get status of image-to-3D task."""
        # Try v2 first, fallback to v1 if needed
        try:
            return self._request("GET", f"/openapi/v2/image-to-3d/{task_id}")
        except MeshyAPIError:
            # Fallback to v1 if v2 doesn't exist
            return self._request("GET", f"/openapi/v1/image-to-3d/{task_id}")
    
    # Remesh Methods
    
    def create_remesh_task(
        self,
        input_task_id: str,
        target_formats: Optional[List[str]] = None,
        topology: Optional[str] = None,
        target_polycount: Optional[int] = None,
        resize_height: Optional[float] = None,
        origin_at: Optional[str] = None
    ) -> str:
        """
        Create a remesh task.
        
        Args:
            input_task_id: Task ID from previous step
            target_formats: Output formats (e.g., ["glb", "fbx"])
            topology: "quad" or "triangle"
            target_polycount: Target polygon count
            resize_height: Height in meters
            origin_at: "bottom" or "center"
        
        Returns:
            Task ID
        """
        data = {"input_task_id": input_task_id}
        
        if target_formats:
            data["target_formats"] = target_formats
        if topology:
            data["topology"] = topology
        if target_polycount:
            data["target_polycount"] = target_polycount
        if resize_height:
            data["resize_height"] = resize_height
        if origin_at:
            data["origin_at"] = origin_at
        
        response = self._request("POST", "/openapi/v1/remesh", json=data)
        return response.get("result")
    
    def get_remesh_status(self, task_id: str) -> Dict[str, Any]:
        """Get status of remesh task."""
        return self._request("GET", f"/openapi/v1/remesh/{task_id}")
    
    # Retexture Methods
    
    def create_retexture_task(
        self,
        input_task_id: str,
        text_style_prompt: Optional[str] = None,
        image_style_url: Optional[str] = None,
        ai_model: Optional[str] = None,
        enable_original_uv: bool = False,
        enable_pbr: bool = False
    ) -> str:
        """
        Create a retexture task.
        
        Args:
            input_task_id: Task ID from previous step
            text_style_prompt: Text description of texture style
            image_style_url: URL to reference image for texture style
            ai_model: AI model to use
            enable_original_uv: Use original UV mapping
            enable_pbr: Generate PBR maps
        
        Returns:
            Task ID
        
        Raises:
            ValueError: If neither text_style_prompt nor image_style_url provided
        """
        if not text_style_prompt and not image_style_url:
            raise ValueError("Either text_style_prompt or image_style_url must be provided")
        
        data = {"input_task_id": input_task_id}
        
        if text_style_prompt:
            data["text_style_prompt"] = text_style_prompt
        if image_style_url:
            data["image_style_url"] = image_style_url
        if ai_model:
            data["ai_model"] = ai_model
        if enable_original_uv:
            data["enable_original_uv"] = enable_original_uv
        if enable_pbr:
            data["enable_pbr"] = enable_pbr
        
        response = self._request("POST", "/openapi/v1/retexture", json=data)
        return response.get("result")
    
    def get_retexture_status(self, task_id: str) -> Dict[str, Any]:
        """Get status of retexture task."""
        return self._request("GET", f"/openapi/v1/retexture/{task_id}")
    
    # Rigging Methods
    
    def create_rigging_task(self, input_task_id: str) -> str:
        """
        Create a rigging task.
        
        Args:
            input_task_id: Task ID from previous step
        
        Returns:
            Task ID (this is a rig_task_id, different from regular task_id)
        """
        data = {"input_task_id": input_task_id}
        response = self._request("POST", "/openapi/v1/rigging", json=data)
        return response.get("result")
    
    def get_rigging_status(self, task_id: str) -> Dict[str, Any]:
        """Get status of rigging task."""
        return self._request("GET", f"/openapi/v1/rigging/{task_id}")
    
    # Animation Methods
    
    def create_animation_task(self, rig_task_id: str, action_id: str = "idle") -> str:
        """
        Create an animation task.
        
        Args:
            rig_task_id: Rig task ID from rigging step
            action_id: Animation preset identifier (default: "idle")
        
        Returns:
            Task ID
        """
        data = {
            "rig_task_id": rig_task_id,
            "action_id": action_id
        }
        response = self._request("POST", "/openapi/v1/animations", json=data)
        return response.get("result")
    
    def get_animation_status(self, task_id: str) -> Dict[str, Any]:
        """Get status of animation task."""
        return self._request("GET", f"/openapi/v1/animations/{task_id}")
    
    # Utility Methods
    
    def wait_for_task(
        self,
        status_func,
        task_id: str,
        poll_interval: int = 5,
        max_wait: int = 3600,
        verbose: bool = True
    ) -> Dict[str, Any]:
        """
        Poll for task completion.
        
        Args:
            status_func: Function to call to get task status (e.g., self.get_remesh_status)
            task_id: Task ID to poll
            poll_interval: Seconds between polls
            max_wait: Maximum seconds to wait
            verbose: Print status updates
        
        Returns:
            Final task status dictionary
        
        Raises:
            MeshyAPIError: If task fails or times out
        """
        start_time = time.time()
        
        while True:
            status = status_func(task_id)
            current_status = status.get("status", "UNKNOWN")
            progress = status.get("progress", 0)
            
            if verbose:
                print(f"  Status: {current_status} | Progress: {progress}%")
            
            if current_status == "SUCCEEDED":
                if progress >= 100:
                    return status
                else:
                    if verbose:
                        print(f"  Waiting for progress to reach 100% (currently {progress}%)...")
            
            elif current_status == "FAILED":
                error_msg = status.get("error", {}).get("message", "Unknown error")
                raise MeshyAPIError(f"Task {task_id} failed: {error_msg}")
            
            elapsed = time.time() - start_time
            if elapsed > max_wait:
                raise MeshyAPIError(f"Task {task_id} timed out after {max_wait} seconds")
            
            time.sleep(poll_interval)
    
    def download_file(self, url: str, output_path: Path) -> Path:
        """
        Download file from URL.
        
        Args:
            url: URL to download
            output_path: Path to save file
        
        Returns:
            Path to downloaded file
        """
        response = requests.get(url, stream=True)
        response.raise_for_status()
        
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(output_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        return output_path


# Convenience functions for pipeline tasks

def create_image_to_3d_task(image_path: Path, pose_mode: str = "t-pose") -> str:
    """Wrapper for creating image-to-3D task."""
    client = MeshyClient()
    return client.create_image_to_3d_task(image_path, pose_mode=pose_mode)

def create_remesh_task(input_task_id: str) -> str:
    """Wrapper for creating remesh task."""
    client = MeshyClient()
    return client.create_remesh_task(input_task_id)

def create_retexture_task(input_task_id: str, text_style_prompt: Optional[str] = None) -> str:
    """Wrapper for creating retexture task."""
    client = MeshyClient()
    return client.create_retexture_task(input_task_id, text_style_prompt=text_style_prompt)

def create_rigging_task(input_task_id: str) -> str:
    """Wrapper for creating rigging task."""
    client = MeshyClient()
    return client.create_rigging_task(input_task_id)

def create_animation_task(rig_task_id: str, action_id: str = "idle") -> str:
    """Wrapper for creating animation task."""
    client = MeshyClient()
    return client.create_animation_task(rig_task_id, action_id)

def poll_and_download_task(task_id: str, output_path: Path, status_func, poll_interval: int = 10) -> Path:
    """
    Poll Meshy task and download result when complete.
    
    Args:
        task_id: Meshy task ID
        output_path: Where to save the downloaded file
        status_func: Function to get task status (e.g., client.get_image_to_3d_status)
        poll_interval: Seconds between polls
    
    Returns:
        Path to downloaded file
    """
    client = MeshyClient()
    status = client.wait_for_task(status_func, task_id, poll_interval=poll_interval, verbose=False)
    
    # Get download URL from status
    result_url = status.get("model_urls", {}).get("glb") or status.get("result", {}).get("model_urls", {}).get("glb")
    if not result_url:
        # Try alternative response structure
        result_url = status.get("result", {}).get("glb") or status.get("glb")
    
    if not result_url:
        raise MeshyAPIError(f"No download URL found in task {task_id} response: {status}")
    
    return client.download_file(result_url, output_path)

