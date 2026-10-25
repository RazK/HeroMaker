"""Helper functions for HeroMaker API tests (the API is /api/v1: app/api/v1.py)."""
import time
from typing import Optional, Dict, Any

# Pipeline step -> the API's stage name (app/services/api_heroes.py STAGES).
STAGE_OF_STEP = {
    "image_processing": "cleanup",
    "openai_render": "painting",
    "meshy_3d": "model",
    "meshy_rig": "rig",
    "convert_vrm": "avatar",
}


def poll_until_complete(test_client, creation_id: str, api_base_url: str, timeout: int = 3600, poll_interval: int = 3) -> Dict[str, Any]:
    """
    Poll creation status until completed or failed.
    
    Args:
        test_client: Requests session
        creation_id: Creation ID to poll
        api_base_url: Base URL for API
        timeout: Maximum time to wait in seconds (default 3600 = 1 hour)
        poll_interval: Time between polls in seconds (default 3)
    
    Returns:
        Final creation status dict
    
    Raises:
        TimeoutError: If creation doesn't complete within timeout
        AssertionError: If creation fails
    """
    start_time = time.time()
    
    while True:
        response = test_client.get(f"{api_base_url}/api/v1/heroes/{creation_id}")
        assert response.status_code == 200, f"Failed to get creation status: {response.text}"
        creation = response.json()
        
        status = creation.get("status")
        
        if status == "completed":
            return creation
        elif status == "failed":
            error_msg = (creation.get("error") or {}).get("message", "Unknown error")
            raise AssertionError(f"Creation failed: {error_msg}")
        
        elapsed = time.time() - start_time
        if elapsed > timeout:
            raise TimeoutError(f"Creation {creation_id} did not complete within {timeout} seconds. Current status: {status}")
        
        time.sleep(poll_interval)


def wait_for_step_status(
    test_client, 
    creation_id: str, 
    step_name: str, 
    expected_status: str, 
    api_base_url: str, 
    timeout: int = 300
) -> Dict[str, Any]:
    """
    Wait for a specific step to reach expected status.
    
    Args:
        test_client: Requests session
        creation_id: Creation ID
        step_name: Name of step to check
        expected_status: Expected status ("pending", "processing", "completed", "failed")
        api_base_url: Base URL for API
        timeout: Maximum time to wait in seconds (default 300 = 5 minutes)
    
    Returns:
        Creation status dict
    
    Raises:
        TimeoutError: If step doesn't reach expected status within timeout
    """
    start_time = time.time()
    
    while True:
        response = test_client.get(f"{api_base_url}/api/v1/heroes/{creation_id}")
        assert response.status_code == 200, f"Failed to get creation status: {response.text}"
        creation = response.json()
        
        # Find the step
        step = next((s for s in creation.get("stages", []) if s.get("step") == step_name), None)
        if not step:
            raise ValueError(f"Step {step_name} not found in creation {creation_id}")
        
        if step.get("status") == expected_status:
            return creation
        
        elapsed = time.time() - start_time
        if elapsed > timeout:
            raise TimeoutError(
                f"Step {step_name} did not reach status {expected_status} within {timeout} seconds. "
                f"Current status: {step.get('status')}"
            )
        
        time.sleep(2)  # Poll every 2 seconds for step status


def get_creation_status(test_client, creation_id: str, api_base_url: str) -> Dict[str, Any]:
    """
    Get creation status and return parsed response.
    
    Args:
        test_client: Requests session
        creation_id: Creation ID
        api_base_url: Base URL for API
    
    Returns:
        Creation status dict
    """
    response = test_client.get(f"{api_base_url}/api/v1/heroes/{creation_id}")
    assert response.status_code == 200, f"Failed to get creation status: {response.text}"
    return response.json()


def run_pipeline(test_client, creation_id: str, from_stage: Optional[str] = None, api_base_url: str = None) -> Dict[str, Any]:
    """
    Start the hero (POST /api/v1/heroes/{id}/start) and return it.
    
    Args:
        test_client: Requests session
        creation_id: Creation ID
        from_stage: Start again from this stage (a retry); None: from the beginning
        api_base_url: Base URL for API (uses test_client.base_url if not provided)
    
    Returns:
        Response dict
    """
    if api_base_url is None:
        api_base_url = getattr(test_client, "base_url", "http://localhost:8000")
    
    response = test_client.post(
        f"{api_base_url}/api/v1/heroes/{creation_id}/start",
        json={"from_stage": from_stage} if from_stage else {},
    )
    assert response.status_code == 202, f"Failed to run pipeline: {response.text}"
    return response.json()


def run_step(test_client, creation_id: str, step_name: str, api_base_url: str = None) -> Dict[str, Any]:
    """
    Run individual step and return response.
    
    Args:
        test_client: Requests session
        creation_id: Creation ID
        step_name: Name of step to run
        api_base_url: Base URL for API (uses test_client.base_url if not provided)
    
    Returns:
        Response dict
    """
    if api_base_url is None:
        api_base_url = getattr(test_client, "base_url", "http://localhost:8000")
    
    response = test_client.post(
        f"{api_base_url}/api/v1/heroes/{creation_id}/stages/{STAGE_OF_STEP[step_name]}/run"
    )
    assert response.status_code == 202, f"Failed to run step: {response.text}"
    return response.json()

