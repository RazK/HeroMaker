#!/usr/bin/env python3
"""
Migration script to add metadata column to creation_steps table.
Run this once to update the database schema.
"""
import sqlite3
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
    # Check if column already exists
    cursor.execute("PRAGMA table_info(creation_steps)")
    columns = [row[1] for row in cursor.fetchall()]
    
    if 'metadata' not in columns:
        print("Adding 'metadata' column...")
        cursor.execute("ALTER TABLE creation_steps ADD COLUMN metadata JSON DEFAULT '{}'")
        print("✓ Added 'metadata' column")
    else:
        print("✓ 'metadata' column already exists")
    
    conn.commit()
    print("\nMigration completed successfully!")
    
except sqlite3.Error as e:
    print(f"Error: {e}")
    conn.rollback()
    sys.exit(1)
finally:
    conn.close()

