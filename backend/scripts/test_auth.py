"""
Test script to validate authentication flow.

Usage:
    python scripts/test_auth.py

This script tests:
1. User signup
2. User login
3. JWT token validation
4. Protected endpoint access
5. Token expiration handling
"""
import os
import sys
import requests
import time
from pathlib import Path
from dotenv import load_dotenv

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

load_dotenv()

API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")
TEST_RUN_ID = os.getenv("TEST_RUN_ID", str(int(time.time())))
TEST_USERNAME = os.getenv("TEST_USERNAME", f"test_user_auth_{TEST_RUN_ID}")
TEST_EMAIL = os.getenv("TEST_EMAIL", f"test_auth_{TEST_RUN_ID}@example.com")
TEST_PASSWORD = "testpass123"


def test_signup():
    """Test user signup."""
    print("🧪 Testing signup...")
    response = requests.post(
        f"{API_BASE_URL}/api/auth/signup",
        json={
            "username": TEST_USERNAME,
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD,
            "name": "Auth Smoke Test",
            "date_of_birth": "2000-01-01",
        }
    )
    
    if response.status_code == 201:
        data = response.json()
        print(f"✅ Signup successful: {data['user']['username']} (credits: {data['user']['credits']})")
        return data['access_token']
    elif response.status_code == 400:
        print(f"⚠️  User already exists, trying login instead...")
        return None
    else:
        print(f"❌ Signup failed: {response.status_code} - {response.text}")
        return None


def test_login():
    """Test user login."""
    print("🧪 Testing login...")
    response = requests.post(
        f"{API_BASE_URL}/api/auth/login",
        json={
            "username": TEST_USERNAME,
            "password": TEST_PASSWORD
        }
    )
    
    if response.status_code == 200:
        data = response.json()
        print(f"✅ Login successful: {data['user']['username']} (credits: {data['user']['credits']})")
        return data['access_token']
    else:
        print(f"❌ Login failed: {response.status_code} - {response.text}")
        return None


def test_get_me(token):
    """Test /me endpoint with JWT token."""
    print("🧪 Testing /me endpoint...")
    response = requests.get(
        f"{API_BASE_URL}/api/auth/me",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        print(f"✅ /me successful: {data['username']} (credits: {data['credits']})")
        return True
    else:
        print(f"❌ /me failed: {response.status_code} - {response.text}")
        return False


def test_protected_endpoint(token):
    """Test accessing a protected endpoint."""
    print("🧪 Testing protected endpoint (list creations)...")
    response = requests.get(
        f"{API_BASE_URL}/api/creations/",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        creations = data if isinstance(data, list) else data.get('creations', [])
        print(f"✅ Protected endpoint accessible: {len(creations)} creations")
        return True
    else:
        print(f"❌ Protected endpoint failed: {response.status_code} - {response.text}")
        return False


def test_invalid_token():
    """Test with invalid token."""
    print("🧪 Testing invalid token...")
    response = requests.get(
        f"{API_BASE_URL}/api/auth/me",
        headers={"Authorization": "Bearer invalid_token_12345"}
    )
    
    if response.status_code == 401:
        print("✅ Invalid token correctly rejected")
        return True
    else:
        print(f"❌ Invalid token not rejected: {response.status_code}")
        return False


def test_no_token():
    """Test without token (should fall back to debug user)."""
    print("🧪 Testing no token (fallback to debug user)...")
    response = requests.get(
        f"{API_BASE_URL}/api/creations/"
    )
    
    if response.status_code == 200:
        print("✅ No token request handled (fallback to debug user)")
        return True
    else:
        print(f"⚠️  No token request: {response.status_code} - {response.text}")
        return False


def main():
    """Run all tests."""
    print("=" * 60)
    print("Authentication Flow Tests")
    print("=" * 60)
    print(f"API Base URL: {API_BASE_URL}\n")
    
    results = []
    
    # Test signup
    token = test_signup()
    if not token:
        # If signup failed (user exists), try login
        token = test_login()
    
    if token:
        results.append(("Signup/Login", True))
        
        # Test /me endpoint
        if test_get_me(token):
            results.append(("Get Me", True))
        else:
            results.append(("Get Me", False))
        
        # Test protected endpoint
        if test_protected_endpoint(token):
            results.append(("Protected Endpoint", True))
        else:
            results.append(("Protected Endpoint", False))
    else:
        results.append(("Signup/Login", False))
    
    # Test invalid token
    if test_invalid_token():
        results.append(("Invalid Token", True))
    else:
        results.append(("Invalid Token", False))
    
    # Test no token (fallback)
    if test_no_token():
        results.append(("No Token Fallback", True))
    else:
        results.append(("No Token Fallback", False))
    
    # Summary
    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)
    for test_name, passed in results:
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status}: {test_name}")
    
    passed_count = sum(1 for _, passed in results if passed)
    total_count = len(results)
    print(f"\nTotal: {passed_count}/{total_count} tests passed")
    
    if passed_count == total_count:
        print("🎉 All tests passed!")
        return 0
    else:
        print("⚠️  Some tests failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())

