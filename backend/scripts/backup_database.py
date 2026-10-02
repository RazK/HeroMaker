#!/usr/bin/env python3
"""
Simple database backup script.
Backs up PostgreSQL database to storage (local or S3 based on config).
"""

import os
import sys
import subprocess
from datetime import datetime
from urllib.parse import unquote, urlparse

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config.settings import DATABASE_URL, with_explicit_postgres_driver
from app.utils.storage import S3FileStorage, get_storage

# The app's DATABASE_URL on Railway names postgres.railway.internal, which only
# resolves inside Railway. A backup run from elsewhere (the GitHub workflow)
# passes the database's public URL here instead.
DATABASE_URL = with_explicit_postgres_driver(
    os.getenv("BACKUP_DATABASE_URL") or DATABASE_URL
)


def backup_database():
    """Create a database backup and upload to storage."""
    
    # Check if we have PostgreSQL
    if not DATABASE_URL or not DATABASE_URL.startswith('postgresql'):
        # A failure, not a skip: a backup job that "succeeds" without backing
        # anything up is worse than one that goes red.
        print("❌ DATABASE_URL is not PostgreSQL, nothing to back up")
        print(f"   DATABASE_URL scheme: {DATABASE_URL.split(':', 1)[0] if DATABASE_URL else 'not set'}")
        sys.exit(1)
    
    print("🗄️  Starting database backup...")
    
    # Parse database URL
    parsed = urlparse(DATABASE_URL)
    db_host = parsed.hostname
    db_port = parsed.port or 5432
    db_name = parsed.path.lstrip('/')
    db_user = parsed.username
    db_password = unquote(parsed.password or "")
    
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
        # get_storage() quietly falls back to the local disk when S3 fails to
        # initialise. On a CI runner that disk is thrown away with the job.
        if os.getenv("S3_BUCKET") and not isinstance(storage, S3FileStorage):
            raise RuntimeError("S3_BUCKET is set but S3 storage failed to initialise")
        
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
