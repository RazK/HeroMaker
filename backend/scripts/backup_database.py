#!/usr/bin/env python3
"""
Backup SQLite database to timestamped file.
This script can be run manually or via a scheduled task.
"""
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

# Add parent directory to path to import app config
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config.settings import DATABASE_URL

# Extract database path from DATABASE_URL
# For SQLite: sqlite:///./heromaker.db -> ./heromaker.db
# For absolute paths: sqlite:////app/heromaker.db -> /app/heromaker.db
def get_database_path():
    """Extract database file path from DATABASE_URL."""
    if DATABASE_URL.startswith("sqlite:///"):
        # Remove sqlite:/// prefix
        db_path = DATABASE_URL.replace("sqlite:///", "", 1)
        # Handle absolute paths (sqlite://// -> /)
        if db_path.startswith("/"):
            return db_path
        else:
            # Relative path - resolve from script location
            script_dir = Path(__file__).parent.parent
            return str(script_dir / db_path)
    else:
        raise ValueError(f"Unsupported database URL format: {DATABASE_URL}")

DATABASE_PATH = os.getenv("DATABASE_PATH") or get_database_path()
BACKUP_DIR = os.getenv("BACKUP_DIR", "/app/data/backups")
RETENTION_DAYS = int(os.getenv("BACKUP_RETENTION_DAYS", "7"))


def backup_database():
    """Create a timestamped backup of the database."""
    db_path = Path(DATABASE_PATH)
    backup_dir = Path(BACKUP_DIR)
    
    # Verify database file exists
    if not db_path.exists():
        print(f"ERROR: Database file not found at {db_path}", file=sys.stderr)
        sys.exit(1)
    
    # Create backup directory if it doesn't exist
    backup_dir.mkdir(parents=True, exist_ok=True)
    
    # Generate timestamped backup filename
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_filename = f"heromaker_backup_{timestamp}.db"
    backup_path = backup_dir / backup_filename
    
    try:
        # Copy database file
        shutil.copy2(db_path, backup_path)
        file_size = backup_path.stat().st_size
        print(f"✅ Backup created: {backup_path} ({file_size:,} bytes)")
        
        # Clean up old backups
        cleanup_old_backups(backup_dir)
        
        return backup_path
    except Exception as e:
        print(f"ERROR: Failed to create backup: {e}", file=sys.stderr)
        sys.exit(1)


def cleanup_old_backups(backup_dir: Path):
    """Remove backup files older than retention period."""
    if RETENTION_DAYS <= 0:
        return  # Retention disabled
    
    cutoff_time = datetime.now().timestamp() - (RETENTION_DAYS * 24 * 60 * 60)
    removed_count = 0
    
    for backup_file in backup_dir.glob("heromaker_backup_*.db"):
        if backup_file.stat().st_mtime < cutoff_time:
            try:
                backup_file.unlink()
                removed_count += 1
                print(f"🗑️  Removed old backup: {backup_file.name}")
            except Exception as e:
                print(f"WARNING: Failed to remove old backup {backup_file.name}: {e}")
    
    if removed_count > 0:
        print(f"🧹 Cleaned up {removed_count} old backup(s)")


if __name__ == "__main__":
    backup_database()

