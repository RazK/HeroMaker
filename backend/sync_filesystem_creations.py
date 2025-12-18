#!/usr/bin/env python3
"""
Sync creations from filesystem to database.
Creates database entries for creations that have files but no DB entry.
"""
import sqlite3
import os
from pathlib import Path
from datetime import datetime
import uuid

# Database path
DB_PATH = Path(__file__).parent / "heromaker.db"
ASSETS_PATH = Path(__file__).parent.parent / "assets" / "permanent" / "debug-user-uuid"

# Debug user ID
DEBUG_USER_ID = "debug-user-uuid"

# Step names (from app.config.steps)
STEP_NAMES = [
    "image_processing",
    "chatgpt_render",
    "meshy_3d",
    "meshy_rig",
    "convert_vrm",
    "complete"
]

def get_creation_files(creation_id: str):
    """Check what files exist for a creation."""
    creation_path = ASSETS_PATH / creation_id
    if not creation_path.exists():
        return {}
    
    files = {}
    expected_files = {
        "original.jpg": "image_processing",
        "processed.jpg": "image_processing",
        "rendered.png": "chatgpt_render",
        "model.glb": "meshy_3d",
        "rigged.glb": "meshy_rig",
        "avatar.vrm": "convert_vrm"
    }
    
    for filename, step_name in expected_files.items():
        file_path = creation_path / filename
        if file_path.exists():
            files[step_name] = filename
    
    # Check if complete step is done (has avatar.vrm)
    if "avatar.vrm" in [f for f in files.values()]:
        files["complete"] = True
    
    return files

def determine_step_status(step_name: str, creation_files: dict, all_steps: list):
    """Determine the status of a step based on files and other steps."""
    # If this step's output file exists, it's completed
    if step_name in creation_files:
        return "completed"
    
    # If any later step is completed, this one must be completed too
    step_index = STEP_NAMES.index(step_name) if step_name in STEP_NAMES else -1
    for later_step in STEP_NAMES[step_index + 1:]:
        if later_step in creation_files or (later_step == "complete" and creation_files.get("complete")):
            return "completed"
    
    # If any previous step failed, this is pending
    for prev_step in STEP_NAMES[:step_index]:
        prev_step_status = next((s[1] for s in all_steps if s[0] == prev_step), None)
        if prev_step_status == "failed":
            return "pending"
    
    # If we have files but not this step's file, check previous steps
    if creation_files and step_index > 0:
        prev_step = STEP_NAMES[step_index - 1]
        prev_step_status = next((s[1] for s in all_steps if s[0] == prev_step), None)
        if prev_step_status == "completed":
            return "pending"
    
    return "pending"

def create_creation_entry(conn, creation_id: str, creation_files: dict):
    """Create a database entry for a creation."""
    cursor = conn.cursor()
    
    # Check if creation already exists
    cursor.execute("SELECT id FROM creations WHERE id = ?", (creation_id,))
    if cursor.fetchone():
        print(f"  Creation {creation_id} already exists in database")
        return False
    
    # Get creation directory to determine created_at
    creation_path = ASSETS_PATH / creation_id
    created_at = datetime.utcnow()
    if creation_path.exists():
        # Use directory modification time as created_at
        try:
            created_at = datetime.fromtimestamp(creation_path.stat().st_mtime)
        except:
            pass
    
    # Insert creation
    cursor.execute("""
        INSERT INTO creations (id, user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?)
    """, (creation_id, DEBUG_USER_ID, created_at, datetime.utcnow()))
    
    # Determine overall status
    has_avatar = creation_files.get("complete") or "avatar.vrm" in [f for f in creation_files.values() if isinstance(f, str) and "vrm" in f]
    
    # Create steps
    all_steps = []
    for step_name in STEP_NAMES:
        step_id = str(uuid.uuid4())
        status = determine_step_status(step_name, creation_files, all_steps)
        
        # If we have the output file, mark as completed with a timestamp
        completed_at = None
        if step_name in creation_files or (step_name == "complete" and has_avatar):
            status = "completed"
            completed_at = created_at
        
        cursor.execute("""
            INSERT INTO creation_steps (id, creation_id, step_name, status, created_at, updated_at, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (step_id, creation_id, step_name, status, created_at, datetime.utcnow(), completed_at))
        
        all_steps.append((step_name, status))
    
    conn.commit()
    print(f"  ✓ Created creation {creation_id} with {len(STEP_NAMES)} steps")
    return True

def main():
    print("Syncing filesystem creations to database...")
    print(f"Assets path: {ASSETS_PATH}")
    print(f"Database: {DB_PATH}")
    
    if not ASSETS_PATH.exists():
        print(f"Error: Assets path does not exist: {ASSETS_PATH}")
        return
    
    if not DB_PATH.exists():
        print(f"Error: Database does not exist: {DB_PATH}")
        return
    
    conn = sqlite3.connect(DB_PATH)
    
    # Get all creation directories
    creation_dirs = [d.name for d in ASSETS_PATH.iterdir() if d.is_dir()]
    print(f"\nFound {len(creation_dirs)} creation directories")
    
    # Get existing creation IDs from database
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM creations")
    existing_ids = set(row[0] for row in cursor.fetchall())
    print(f"Found {len(existing_ids)} existing creations in database")
    
    # Find missing creations
    missing_creations = []
    for creation_id in creation_dirs:
        if creation_id not in existing_ids:
            creation_files = get_creation_files(creation_id)
            if creation_files:  # Only add if it has some files
                missing_creations.append((creation_id, creation_files))
    
    print(f"\nFound {len(missing_creations)} creations with files but no database entry")
    
    if missing_creations:
        print("\nCreating database entries...")
        created_count = 0
        for creation_id, creation_files in missing_creations:
            print(f"\nProcessing {creation_id}:")
            print(f"  Files found: {list(creation_files.keys())}")
            if create_creation_entry(conn, creation_id, creation_files):
                created_count += 1
        
        print(f"\n✓ Created {created_count} new creation entries")
    else:
        print("\n✓ All creations are already in the database")
    
    conn.close()
    print("\nDone!")

if __name__ == "__main__":
    main()

