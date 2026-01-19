#!/usr/bin/env python3
"""
Simple database backup script.
Backs up PostgreSQL database to storage (local or S3 based on config).
"""

import os
import sys
import subprocess
from datetime import datetime
from urllib.parse import urlparse

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config.settings import DATABASE_URL
from app.utils.storage import get_storage


def backup_database():
    """Create a database backup and upload to storage."""
    
    # Check if we have PostgreSQL
    if not DATABASE_URL or not DATABASE_URL.startswith('postgresql'):
        print("⚠️  DATABASE_URL is not PostgreSQL, skipping backup")
        print(f"   DATABASE_URL: {DATABASE_URL[:50] if DATABASE_URL else 'not set'}...")
        return
    
    print("🗄️  Starting database backup...")
    
    # Parse database URL
    parsed = urlparse(DATABASE_URL)
    db_host = parsed.hostname
    db_port = parsed.port or 5432
    db_name = parsed.path.lstrip('/')
    db_user = parsed.username
    db_password = parsed.password
    
    # Create backup filename with timestamp
    timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    backup_filename = f"backup_{timestamp}.sql"
    backup_path = f"/tmp/{backup_filename}"
    
    print(f"   Database: {db_name} @ {db_host}")
    print(f"   Backup file: {backup_filename}")
    
    # Set password in environment for pg_dump
    env = os.environ.copy()
    env['PGPASSWORD'] = db_password
    
    # Run pg_dump
    try:
        result = subprocess.run(
            [
                'pg_dump',
                '-h', db_host,
                '-p', str(db_port),
                '-U', db_user,
                '-d', db_name,
                '-f', backup_path,
                '--no-owner',
                '--no-acl',
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=300  # 5 minute timeout
        )
        
        if result.returncode != 0:
            print(f"❌ pg_dump failed: {result.stderr}")
            sys.exit(1)
            
    except FileNotFoundError:
        print("❌ pg_dump not found - is PostgreSQL client installed?")
        sys.exit(1)
    except subprocess.TimeoutExpired:
        print("❌ pg_dump timed out after 5 minutes")
        sys.exit(1)
    
    # Check backup file size
    backup_size = os.path.getsize(backup_path)
    print(f"   Backup size: {backup_size / 1024:.1f} KB")
    
    if backup_size < 100:
        print("⚠️  Backup file suspiciously small, check for errors")
    
    # Upload using storage abstraction (works with local or S3)
    print("☁️  Uploading backup to storage...")
    
    try:
        storage = get_storage()
        
        # Read backup file
        with open(backup_path, 'rb') as f:
            backup_data = f.read()
        
        # Store in "_backups" pseudo-user directory
        storage.upload_file("_backups", "database", backup_filename, backup_data)
        
        print(f"✅ Backup saved: _backups/database/{backup_filename}")
        
    except Exception as e:
        print(f"❌ Storage upload failed: {e}")
        sys.exit(1)
    
    finally:
        # Clean up local backup file
        if os.path.exists(backup_path):
            os.remove(backup_path)
    
    print("✅ Database backup completed successfully!")


if __name__ == '__main__':
    backup_database()
