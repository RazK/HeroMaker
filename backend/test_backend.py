import requests
import json
import os

BASE_URL = "http://localhost:8000"

def test_api():
    print("--- 1. Health Check ---")
    try:
        res = requests.get(f"{BASE_URL}/")
        print(f"Status: {res.status_code}")
        print(f"Response: {res.json()}")
    except Exception as e:
        print(f"Failed to connect: {e}")
        return

    print("\n--- 2. Create Creation ---")
    res = requests.post(f"{BASE_URL}/api/creations", json={})
    if res.status_code != 200:
        print(f"Failed: {res.text}")
        return
    
    creation = res.json()
    creation_id = creation["id"]
    print(f"Created ID: {creation_id}")
    print(f"Current Task: {creation['current_task']}")
    print(f"Status: {creation['status']}")

    print("\n--- 3. Check Progress ---")
    res = requests.get(f"{BASE_URL}/api/creations/{creation_id}/progress")
    print(f"Progress: {res.json()['overall_progress']}%")

    print("\n--- 4. Execute Task (image_capture) ---")
    # Create a dummy image file
    with open("test_scan.jpg", "wb") as f:
        f.write(b"dummy image content")
        
    with open("test_scan.jpg", "rb") as f:
        files = {"file": ("scan.jpg", f, "image/jpeg")}
        res = requests.post(
            f"{BASE_URL}/api/creations/{creation_id}/tasks/image_capture",
            files=files
        )
    
    print(f"Status: {res.status_code}")
    if res.status_code == 200:
        print(f"Response: {res.json()}")
    else:
        print(f"Error: {res.text}")

    print("\n--- 5. Verify Status Update ---")
    res = requests.get(f"{BASE_URL}/api/creations/{creation_id}")
    data = res.json()
    print(f"Status: {data['status']}")
    print(f"Current Task: {data['current_task']}") # Should still be image_capture or updated if logic auto-advances (it doesn't yet without external worker)
    
    # Check if file exists in task list
    tasks = data['tasks']
    capture_task = next(t for t in tasks if t['name'] == 'image_capture')
    print(f"Image Capture Status: {capture_task['status']}")
    print(f"File URL: {capture_task['file_url']}")

    print("\n--- 6. List Characters (Gallery) ---")
    res = requests.get(f"{BASE_URL}/api/characters")
    print(f"Characters found: {len(res.json()['characters'])}")
    
    # Clean up
    if os.path.exists("test_scan.jpg"):
        os.remove("test_scan.jpg")

if __name__ == "__main__":
    test_api()
