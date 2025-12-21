"""Helper functions for HeroMaker API tests."""
import time
from typing import Optional, Dict, Any


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
        response = test_client.get(f"{api_base_url}/api/creations/{creation_id}")
        assert response.status_code == 200, f"Failed to get creation status: {response.text}"
        creation = response.json()
        
        status = creation.get("status")
        
        if status == "completed":
            return creation
        elif status == "failed":
            error_msg = creation.get("error_message", "Unknown error")
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
        response = test_client.get(f"{api_base_url}/api/creations/{creation_id}")
        assert response.status_code == 200, f"Failed to get creation status: {response.text}"
        creation = response.json()
        
        # Find the step
        step = next((s for s in creation.get("steps", []) if s.get("step_name") == step_name), None)
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
    response = test_client.get(f"{api_base_url}/api/creations/{creation_id}")
    assert response.status_code == 200, f"Failed to get creation status: {response.text}"
    return response.json()


def run_pipeline(test_client, creation_id: str, restart: bool = False, api_base_url: str = None) -> Dict[str, Any]:
    """
    Trigger pipeline run and return response.
    
    Args:
        test_client: Requests session
        creation_id: Creation ID
        restart: Whether to restart from beginning
        api_base_url: Base URL for API (uses test_client.base_url if not provided)
    
    Returns:
        Response dict
    """
    if api_base_url is None:
        api_base_url = getattr(test_client, "base_url", "http://localhost:8000")
    
    response = test_client.post(
        f"{api_base_url}/api/creations/{creation_id}/run",
        params={"restart": restart}
    )
    assert response.status_code == 200, f"Failed to run pipeline: {response.text}"
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
        f"{api_base_url}/api/creations/{creation_id}/steps/{step_name}/run"
    )
    assert response.status_code == 200, f"Failed to run step: {response.text}"
    return response.json()

