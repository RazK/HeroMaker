#!/usr/bin/env python3
"""
Migration script to rename chatgpt_render step to openai_render in the database.

Usage:
    python backend/scripts/migrate_chatgpt_to_openai.py
"""
import sys
from pathlib import Path

# Add backend to path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from app.database import SessionLocal, engine
from sqlalchemy import text

def migrate():
    """Update all chatgpt_render step names to openai_render."""
    db = SessionLocal()
    try:
        # Use raw SQL for direct update
        result = db.execute(
            text("UPDATE creation_steps SET step_name = 'openai_render' WHERE step_name = 'chatgpt_render'")
        )
        db.commit()
        
        count = result.rowcount
        print(f"✅ Migrated {count} records from 'chatgpt_render' to 'openai_render'")
        
        # Verify
        result = db.execute(
            text("SELECT COUNT(*) FROM creation_steps WHERE step_name = 'chatgpt_render'")
        )
        remaining = result.scalar()
        if remaining > 0:
            print(f"⚠️  Warning: {remaining} records still have 'chatgpt_render'")
        else:
            print("✅ Migration complete - no remaining 'chatgpt_render' records")
            
    except Exception as e:
        db.rollback()
        print(f"❌ Migration failed: {e}")
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    migrate()

