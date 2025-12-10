"""
Meshy API Client - Reusable wrapper for all Meshy API endpoints.
"""

import os
import time
import requests
from typing import Optional, Dict, Any, List
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
env_file = Path(__file__).parent / ".env"
if env_file.exists():
    load_dotenv(env_file)
else:
    # Try project root
    root_env = Path(__file__).parent.parent.parent / ".env"
    if root_env.exists():
        load_dotenv(root_env)
    else:
        load_dotenv()

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
            api_key: Meshy API key. If not provided, reads from MESHY_API_KEY env var.
        """
        self.api_key = api_key or os.getenv("MESHY_API_KEY")
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
            endpoint: API endpoint (e.g., "/openapi/v1/multi-image-to-3d")
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
            error_msg = f"HTTP {response.status_code}"
            try:
                error_data = response.json()
                error_msg += f": {error_data.get('error', {}).get('message', str(e))}"
            except:
                error_msg += f": {str(e)}"
            raise MeshyAPIError(error_msg) from e
        except requests.exceptions.RequestException as e:
            raise MeshyAPIError(f"Request failed: {str(e)}") from e
    
    # Image-to-3D Methods
    
    def create_image_to_3d_task(
        self,
        image_urls: List[str],
        ai_model: Optional[str] = None,
        is_a_t_pose: bool = False
    ) -> str:
        """
        Create an image-to-3D model generation task.
        
        Args:
            image_urls: List of 1-4 image URLs
            ai_model: AI model to use (e.g., "meshy-5")
            is_a_t_pose: Generate model in A/T pose
        
        Returns:
            Task ID
        """
        data = {
            "image_urls": image_urls,
            "is_a_t_pose": is_a_t_pose
        }
        if ai_model:
            data["ai_model"] = ai_model
        
        response = self._request("POST", "/openapi/v1/multi-image-to-3d", json=data)
        return response.get("result")
    
    def get_image_to_3d_status(self, task_id: str) -> Dict[str, Any]:
        """Get status of image-to-3D task."""
        return self._request("GET", f"/openapi/v2/multi-image-to-3d/{task_id}")
    
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
    
    def create_animation_task(self, rig_task_id: str, action_id: str) -> str:
        """
        Create an animation task.
        
        Args:
            rig_task_id: Rig task ID from rigging step
            action_id: Animation preset identifier
        
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
