"""
Meshy API Service - Backend integration for Meshy API endpoints.
Meshy API client for HeroMaker pipeline
"""

import logging
import os
import threading
import time
import requests
import base64
from typing import Optional, Dict, Any, List
from pathlib import Path
from app.config.settings import MESHY_API_KEY
from app.config import pricing
from app.services import usage as usage_service
from app.services import provider_errors
from app.services.usage import UsageContext

logger = logging.getLogger(__name__)

class MeshyAPIError(Exception):
    """Custom exception for Meshy API errors."""
    pass


class MeshyOutOfCredits(MeshyAPIError, provider_errors.ProviderOutOfCredits):
    """Our Meshy account has no credits left (HTTP 402).
    Still a MeshyAPIError, so every existing handler keeps catching it."""

    def __init__(self, detail: str):
        provider_errors.ProviderOutOfCredits.__init__(self, pricing.PROVIDER_MESHY, detail)


class MeshyQueueFull(MeshyAPIError):
    """Every task slot our plan allows is in use (HTTP 429, a message starting
    NoMorePendingTasks). Not an empty account and not a fault: a slot frees
    when one of our own tasks finishes, so the caller waits for one."""


class MeshyRateLimited(MeshyAPIError):
    """Too many requests per second (HTTP 429, "Rate limit exceeded")."""

    def __init__(self, message: str, retry_after: float):
        super().__init__(message)
        self.retry_after = retry_after


# docs.meshy.ai/en/api/rate-limits, read 2026-11-19: a plan allows a fixed
# number of tasks PENDING or IN_PROGRESS at once (Pro 10, Premium 30, Studio
# 60, Ultra and Enterprise 100). Over it, creating a task answers 429
# "NoMorePendingTasks ..." with no Retry-After: "Wait for one of your tasks to
# finish, then create the next one." A hero's model takes about five minutes,
# so the eleventh hero inside five minutes meets this on Pro.
#
# How long a new task waits for a slot before the step gives up, and how often
# it asks again. The wait sits inside the step's own timeout (30 minutes).
QUEUE_WAIT_SECONDS = int(os.getenv("MESHY_QUEUE_WAIT_SECONDS", "600"))
QUEUE_RETRY_SECONDS = 15
# Requests per second: wait what Retry-After says, a few times.
RATE_LIMIT_RETRIES = 5
RATE_LIMIT_MAX_WAIT_SECONDS = 30
# One ERROR line an alert can match when the wait runs out: the plan is too
# small for the traffic.
QUEUE_ALERT_MARKER = "PROVIDER_QUEUE_FULL"


def raise_if_out_of_credits(status_code, message: str) -> None:
    """Raise MeshyOutOfCredits, and the ops alert, if Meshy says we are out."""
    if provider_errors.is_meshy_out_of_credits(status_code, message):
        provider_errors.alert_out_of_credits(pricing.PROVIDER_MESHY, message)
        raise MeshyOutOfCredits(message)

def _retry_after_seconds(response) -> float:
    """Retry-After as seconds, between 1 and RATE_LIMIT_MAX_WAIT_SECONDS."""
    try:
        value = float((getattr(response, "headers", None) or {}).get("Retry-After", 1))
    except (TypeError, ValueError):
        value = 1.0
    return max(1.0, min(value, float(RATE_LIMIT_MAX_WAIT_SECONDS)))


class MeshyClient:
    """Client for interacting with Meshy API."""
    
    BASE_URL = "https://api.meshy.ai"
    
    def __init__(self, api_key: Optional[str] = None, queue_wait_seconds: Optional[int] = None):
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
        # Set when the step this client works for is cancelled or timed out,
        # so a request waiting for a task slot stops instead of creating (and
        # paying for) a task nobody will collect.
        self._abandoned = threading.Event()
        # How long a new task waits for a free slot. The pipeline's steps run
        # in the background and wait (QUEUE_WAIT_SECONDS); a caller inside a
        # web request passes 0 and is told "busy" at once.
        self.queue_wait_seconds = QUEUE_WAIT_SECONDS if queue_wait_seconds is None else queue_wait_seconds

    def abandon(self) -> None:
        """Stop waiting: whoever asked is gone."""
        self._abandoned.set()

    def _request(self, method: str, endpoint: str, **kwargs) -> Dict[str, Any]:
        """
        Make an HTTP request to the Meshy API, waiting out its two limits.

        A full task queue (MeshyQueueFull) is waited for up to
        QUEUE_WAIT_SECONDS; a requests-per-second limit (MeshyRateLimited) for
        what Retry-After says, RATE_LIMIT_RETRIES times. Everything else is
        raised as it comes.

        Returns:
            JSON response as dictionary

        Raises:
            MeshyAPIError: If request fails
        """
        waited_from = None
        rate_retries = 0
        while True:
            try:
                return self._request_once(method, endpoint, **kwargs)
            except MeshyQueueFull as full:
                now = time.monotonic()
                if waited_from is None:
                    waited_from = now
                    logger.warning("Meshy has no free task slot for %s; waiting up to %ss (%s)",
                                   endpoint, self.queue_wait_seconds, full)
                waited = now - waited_from
                if self._abandoned.is_set():
                    raise MeshyAPIError("Meshy request abandoned while waiting for a task slot") from full
                if waited + QUEUE_RETRY_SECONDS > self.queue_wait_seconds:
                    logger.error("%s meshy: waited %ds for a task slot on %s: %s",
                                 QUEUE_ALERT_MARKER, int(waited), endpoint, full)
                    how_long = f" stayed in use for {int(waited)} seconds" if waited else " is in use"
                    raise MeshyAPIError(
                        f"Meshy is busy: every task slot on our plan{how_long}. "
                        f"Try again later. Provider said: {full}"
                    ) from full
                time.sleep(QUEUE_RETRY_SECONDS)
            except MeshyRateLimited as limited:
                rate_retries += 1
                if rate_retries > RATE_LIMIT_RETRIES or self._abandoned.is_set():
                    raise
                time.sleep(limited.retry_after)

    def _request_once(self, method: str, endpoint: str, **kwargs) -> Dict[str, Any]:
        """One HTTP request to the Meshy API, its error turned into ours."""
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

            try:
                raise_if_out_of_credits(response.status_code, str(error_msg))
            except MeshyOutOfCredits as out:
                raise out from e
            if provider_errors.is_meshy_queue_full(str(error_msg)):
                raise MeshyQueueFull(str(error_msg)) from e
            if response.status_code == 429:
                raise MeshyRateLimited(str(error_msg), _retry_after_seconds(response)) from e
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
        moderation: bool = False,
        usage: Optional[UsageContext] = None
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
        
        # COST CAPTURE. This is the expensive one: 20 Meshy credits, ~$0.40 at
        # the Pro rate, roughly 70% of the cost of a hero. The cost is incurred
        # the moment Meshy accepts the task, so the row is written here - not
        # when the model finally downloads, which may be five minutes and one
        # server restart later.
        #
        # finalize_on_success=False: acceptance is not success. The event stays
        # "submitted" with the full price booked until the pipeline's poller
        # learns whether the task SUCCEEDED or FAILED and calls
        # usage_service.finalize_usage_by_provider_ref().
        with usage_service.track(
            usage,
            pricing.PROVIDER_MESHY,
            pricing.OP_MESHY_IMAGE_TO_3D,
            quantity=1,
            metadata={
                "should_texture": should_texture,
                "should_remesh": should_remesh,
                "enable_pbr": enable_pbr,
                "ai_model": ai_model,
                "pose_mode": pose_mode,
            },
            finalize_on_success=False,
        ) as call:
            response = self._request("POST", "/openapi/v1/image-to-3d", json=data)
            task_id = response.get("result")
            call.provider_ref = task_id
        return task_id
    
    def get_image_to_3d_status(self, task_id: str) -> Dict[str, Any]:
        """Get status of image-to-3D task."""
        # Try v2 first, fallback to v1 if needed
        try:
            return self._request("GET", f"/openapi/v2/image-to-3d/{task_id}")
        except MeshyAPIError:
            # Fallback to v1 if v2 doesn't exist
            return self._request("GET", f"/openapi/v1/image-to-3d/{task_id}")
    
    # Remesh Methods
    
    # Auto Split (3D printing)

    def create_print_split_task(
        self,
        input_task_id: str,
        mode: str = "auto",
        prompt: Optional[str] = None,
        target_formats: Optional[List[str]] = None,
        layout: str = "assembled",
        keep_texture: bool = True,
        connectors: bool = False,
        usage: Optional[UsageContext] = None,
    ) -> str:
        """
        Cut a finished model into printable parts (docs.meshy.ai/api/auto-split).

        Args:
            input_task_id: a SUCCEEDED image-to-3D task (meshy-6 or later)
            mode: "auto", or "by_parts" with a prompt naming 1 to 10 parts
            prompt: the parts to cut along (by_parts only)
            target_formats: on top of glb, which is always made ("3mf" keeps
                the parts separate in a slicer)
            layout: "assembled" (parts where they were) or "on_plate"
            keep_texture: keep the hero's texture on every part
            connectors: pegs and sockets at each cut, to glue the parts

        Returns:
            Task ID
        """
        data: Dict[str, Any] = {
            "input_task_id": input_task_id,
            "mode": mode,
            "target_formats": target_formats or ["glb", "3mf"],
            "layout": layout,
            "keep_texture": keep_texture,
            "connectors": connectors,
        }
        if prompt:
            data["prompt"] = prompt

        # Charged when Meshy accepts the task; refunded by Meshy if it fails,
        # which the poller records via finalize_usage_by_provider_ref().
        with usage_service.track(
            usage,
            pricing.PROVIDER_MESHY,
            pricing.OP_MESHY_PRINT_SPLIT,
            quantity=1,
            metadata={"mode": mode, "layout": layout, "keep_texture": keep_texture, "connectors": connectors},
            finalize_on_success=False,
        ) as call:
            response = self._request("POST", "/openapi/v1/print/split", json=data)
            task_id = response.get("result")
            call.provider_ref = task_id
        return task_id

    def get_print_split_status(self, task_id: str) -> Dict[str, Any]:
        """Get status of an Auto Split task."""
        return self._request("GET", f"/openapi/v1/print/split/{task_id}")
    
    # Retexture Methods
    
    # Rigging Methods
    
    def create_rigging_task(
        self,
        input_task_id: str,
        usage: Optional[UsageContext] = None
    ) -> str:
        """
        Create a rigging task.
        
        Args:
            input_task_id: Task ID from previous step
            usage: Optional cost-attribution context.
        
        Returns:
            Task ID (this is a rig_task_id, different from regular task_id)
        """
        data = {"input_task_id": input_task_id}
        # Auto-rigging is free today (pricing.MESHY_RIG_CREDITS == 0). It is
        # recorded anyway, at zero, because free is a price and prices change:
        # the day Meshy starts charging for rigging, this becomes a one-line
        # edit in pricing.py and every historical call is already counted.
        with usage_service.track(
            usage, pricing.PROVIDER_MESHY, pricing.OP_MESHY_RIGGING,
            metadata={"input_task_id": input_task_id},
            finalize_on_success=False,
        ) as call:
            response = self._request("POST", "/openapi/v1/rigging", json=data)
            task_id = response.get("result")
            call.provider_ref = task_id
        return task_id
    
    def get_rigging_status(self, task_id: str) -> Dict[str, Any]:
        """Get status of rigging task."""
        return self._request("GET", f"/openapi/v1/rigging/{task_id}")
    
    # Animation Methods
    
    # Utility Methods
    
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
