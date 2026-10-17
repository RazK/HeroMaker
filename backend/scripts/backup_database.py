#!/usr/bin/env python3
"""
Simple database backup script.
Backs up PostgreSQL database to storage (local or S3 based on config).

After a successful upload to S3 it expires old backups: the privacy policy
promises that deleted data's backup copies are erased within 30 days. See
expire_old_backups for exactly what is and is not deleted.
"""

import os
import sys
import subprocess
from datetime import datetime, timedelta, timezone
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

# Where backups live in the bucket, and the only prefix expiry may ever touch.
BACKUP_PREFIX = "_backups/database/"
# How long a backup is kept. The privacy policy promises 30 days.
DEFAULT_RETENTION_DAYS = 30
# Never fall below this many backups, however old: a run of failed nights must
# not expire the last good copy. Nightly runs keep producing new backups, so in
# practice this never holds one past the retention window.
MIN_BACKUPS_KEPT = 7


def retention_days() -> int:
    raw = os.getenv("BACKUP_RETENTION_DAYS", "").strip()
    if not raw:
        return DEFAULT_RETENTION_DAYS
    days = int(raw)
    if days < 1:
        raise ValueError(f"BACKUP_RETENTION_DAYS must be at least 1, got {days}")
    return days


def expire_old_backups(s3_client, bucket, keep_key, *, now=None,
                       days=None, min_keep=MIN_BACKUPS_KEPT):
    """Delete backups under BACKUP_PREFIX older than ``days``.

    Never deletes ``keep_key`` (the backup just made), never deletes the newest
    ``min_keep`` backups, and never deletes anything outside BACKUP_PREFIX.
    Returns [(key, last_modified)] of what was deleted, oldest first.
    """
    now = now or datetime.now(timezone.utc)
    days = retention_days() if days is None else days
    cutoff = now - timedelta(days=days)

    backups = []
    paginator = s3_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=BACKUP_PREFIX):
        for obj in page.get("Contents", []):
            # Belt and braces: the listing is already prefixed, but a deletion
            # outside the backup folder must be impossible, not just unlikely.
            if obj["Key"].startswith(BACKUP_PREFIX) and obj["Key"] != BACKUP_PREFIX:
                backups.append((obj["Key"], obj["LastModified"]))

    backups.sort(key=lambda b: b[1], reverse=True)
    protected = {key for key, _ in backups[:min_keep]} | {keep_key}

    expired = sorted(
        ((key, modified) for key, modified in backups
         if key not in protected and modified < cutoff),
        key=lambda b: b[1],
    )
    for key, _ in expired:
        s3_client.delete_object(Bucket=bucket, Key=key)
    return expired


def write_job_summary(lines):
    """Append to the GitHub Actions job summary, when running in one."""
    path = os.getenv("GITHUB_STEP_SUMMARY")
    if not path:
        return
    with open(path, "a") as f:
        f.write("\n".join(lines) + "\n")


def report_expiry(expired, days):
    lines = [f"### Backup expiry ({days}-day retention, newest {MIN_BACKUPS_KEPT} always kept)"]
    if expired:
        lines.append(f"Deleted {len(expired)} backup(s):")
        lines += [f"- `{key}` (last modified {modified:%Y-%m-%d %H:%M UTC})"
                  for key, modified in expired]
    else:
        lines.append("Nothing old enough to delete.")
    for line in lines:
        print(f"   {line}")
    write_job_summary(lines)


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
        backup_key = storage.upload_file("_backups", "database", backup_filename, backup_data)
        
        print(f"✅ Backup saved: _backups/database/{backup_filename}")
        
    except Exception as e:
        # Upload failed: expire nothing, so the existing backups stay put.
        print(f"❌ Storage upload failed: {e}")
        sys.exit(1)
    
    finally:
        # Clean up local backup file
        if os.path.exists(backup_path):
            os.remove(backup_path)
    
    if isinstance(storage, S3FileStorage):
        print("🧹 Expiring old backups...")
        try:
            days = retention_days()
            expired = expire_old_backups(
                storage.s3_client, storage.bucket_name, backup_key, days=days
            )
            report_expiry(expired, days)
        except Exception as e:
            # The backup itself is safe, but the retention promise is not being
            # kept: go red so someone looks.
            print(f"❌ Backup saved, but expiring old backups failed: {e}")
            write_job_summary([f"❌ Backup saved, but expiring old backups failed: {e}"])
            sys.exit(1)
    else:
        print("   Local storage: backup expiry applies to S3 only, skipped")
    
    print("✅ Database backup completed successfully!")


if __name__ == '__main__':
    backup_database()
