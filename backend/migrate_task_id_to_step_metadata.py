#!/usr/bin/env python3
"""
Migration script to migrate meshy_3d_task_id from creation metadata to step metadata.
Run this once to migrate existing data.
"""
import sqlite3
import json
import sys
from pathlib import Path

# Get database path - it's relative to backend directory
db_path = Path(__file__).parent / "heromaker.db"
if not db_path.exists():
    print(f"Database not found at {db_path}")
    print(f"Looking for database in: {Path(__file__).parent}")
    sys.exit(1)

print(f"Connecting to database: {db_path}")
conn = sqlite3.connect(str(db_path))
cursor = conn.cursor()

try:
    # Get all creations that have meshy_3d_task_id in metadata
    cursor.execute("SELECT id, metadata FROM creations WHERE metadata IS NOT NULL")
    creations = cursor.fetchall()
    
    migrated_count = 0
    skipped_count = 0
    
    for creation_id, metadata_json in creations:
        if not metadata_json:
            continue
            
        try:
            metadata = json.loads(metadata_json) if isinstance(metadata_json, str) else metadata_json
            task_id = metadata.get("meshy_3d_task_id")
            
            if not task_id:
                continue
            
            # Find the meshy_3d step for this creation
            cursor.execute(
                "SELECT id, metadata FROM creation_steps WHERE creation_id = ? AND step_name = 'meshy_3d'",
                (creation_id,)
            )
            step = cursor.fetchone()
            
            if not step:
                print(f"⚠ Creation {creation_id}: meshy_3d step not found, skipping")
                skipped_count += 1
                continue
            
            step_id, step_metadata_json = step
            
            # Check if step already has the task_id
            step_metadata = {}
            if step_metadata_json:
                try:
                    step_metadata = json.loads(step_metadata_json) if isinstance(step_metadata_json, str) else step_metadata_json
                except:
                    step_metadata = {}
            
            if step_metadata.get("meshy_3d_task_id"):
                print(f"✓ Creation {creation_id}: step already has task_id, skipping")
                skipped_count += 1
                continue
            
            # Migrate task_id to step metadata
            step_metadata["meshy_3d_task_id"] = task_id
            cursor.execute(
                "UPDATE creation_steps SET metadata = ? WHERE id = ?",
                (json.dumps(step_metadata), step_id)
            )
            
            print(f"✓ Creation {creation_id}: migrated task_id {task_id} to meshy_3d step")
            migrated_count += 1
            
        except Exception as e:
            print(f"✗ Creation {creation_id}: Error - {e}")
            continue
    
    conn.commit()
    print(f"\nMigration completed!")
    print(f"  Migrated: {migrated_count} creations")
    print(f"  Skipped: {skipped_count} creations")
    
except sqlite3.Error as e:
    print(f"Error: {e}")
    conn.rollback()
    sys.exit(1)
finally:
    conn.close()


