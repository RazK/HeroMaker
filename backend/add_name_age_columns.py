#!/usr/bin/env python3
"""
Migration script to add name and age columns to the creations table.
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
    # Check if columns already exist
    cursor.execute("PRAGMA table_info(creations)")
    columns = [row[1] for row in cursor.fetchall()]
    
    if 'name' not in columns:
        print("Adding 'name' column...")
        cursor.execute("ALTER TABLE creations ADD COLUMN name VARCHAR")
        print("✓ Added 'name' column")
    else:
        print("✓ 'name' column already exists")
    
    if 'age' not in columns:
        print("Adding 'age' column...")
        cursor.execute("ALTER TABLE creations ADD COLUMN age INTEGER")
        print("✓ Added 'age' column")
    else:
        print("✓ 'age' column already exists")
    
    conn.commit()
    print("\nMigration completed successfully!")
    
except sqlite3.Error as e:
    print(f"Error: {e}")
    conn.rollback()
    sys.exit(1)
finally:
    conn.close()





