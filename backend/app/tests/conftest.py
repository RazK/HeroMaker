"""Pytest fixtures for HeroMaker API tests."""
import pytest
import requests
from pathlib import Path
import os
import sys

BASE_URL = "http://localhost:8000"
TEST_IMAGE_PATH = Path(__file__).parent.parent.parent.parent / "assets" / "permanent" / "debug-user-uuid" / "d7683421-f26a-4f02-afee-7140f139cb0d" / "original.jpg"

# Test-specific user ID to isolate test data
TEST_USER_ID = "test-user-uuid"


@pytest.fixture(scope="session")
def api_base_url():
    """Base URL for API (configurable via environment variable)."""
    return os.getenv("API_BASE_URL", BASE_URL)


@pytest.fixture
def test_image_path():
    """Path to test image file."""
    if not TEST_IMAGE_PATH.exists():
        pytest.skip(f"Test image not found: {TEST_IMAGE_PATH}")
    return TEST_IMAGE_PATH


@pytest.fixture
def test_client(api_base_url):
    """Requests session for API calls."""
    session = requests.Session()
    session.base_url = api_base_url
    return session


@pytest.fixture(scope="function", autouse=True)
def cleanup_test_creations(test_client, api_base_url):
    """
    Auto-cleanup fixture that runs after each test.
    Tracks creation IDs created during test and cleans them up.
    """
    created_ids = []
    
    yield created_ids
    
    # Cleanup: Delete all tracked creations and their temp folders
    try:
        # Add backend to path for imports
        backend_path = Path(__file__).parent.parent.parent
        if str(backend_path) not in sys.path:
            sys.path.insert(0, str(backend_path))
        
        from app.database import SessionLocal
        from app.models import Creation
        from app.utils.file_utils import get_creation_path
        import shutil
        
        db = SessionLocal()
        try:
            for creation_id in created_ids:
                # Delete via API (removes DB record and files)
                try:
                    test_client.delete(f"{api_base_url}/api/creations/{creation_id}")
                except:
                    pass
                
                # Also remove temp folder if it exists (for debug-user-uuid)
                for user_id in ["debug-user-uuid", TEST_USER_ID]:
                    temp_path = get_creation_path(creation_id, user_id)
                    if temp_path.exists():
                        shutil.rmtree(temp_path, ignore_errors=True)
            
            db.close()
        except Exception as e:
            print(f"Warning: Failed to cleanup test creations: {e}")
            if db:
                db.close()
    except Exception as e:
        # Don't fail tests if cleanup fails
        print(f"Warning: Cleanup fixture error: {e}")


@pytest.fixture
def created_creation(test_client, test_image_path, api_base_url, cleanup_test_creations):
    """Fixture that creates a creation with uploaded image, yields creation_id, cleans up after."""
    # Upload image to create creation
    with open(test_image_path, "rb") as f:
        files = {"file": ("original.jpg", f, "image/jpeg")}
        response = test_client.post(f"{api_base_url}/api/creations/upload", files=files)
        assert response.status_code == 200, f"Failed to create creation: {response.text}"
        creation = response.json()
        creation_id = creation["id"]
    
    # Track for cleanup
    cleanup_test_creations.append(creation_id)
    
    yield creation_id

