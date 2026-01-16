#!/usr/bin/env python3
"""
Sync files between S3 storage and local filesystem storage.

Usage:
    # Sync from S3 to local (default)
    python scripts/sync_storage.py

    # Sync from local to S3
    python scripts/sync_storage.py --direction local-to-s3

    # Sync from S3 to local (explicit)
    python scripts/sync_storage.py --direction s3-to-local

    # Dry run (show what would be synced without actually copying)
    python scripts/sync_storage.py --dry-run
"""

import sys
import argparse
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import SessionLocal
from app.models import Creation
from app.config.settings import FILES_ROOT, S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION
from app.utils.storage import LocalFileStorage, S3FileStorage
import os
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def get_s3_storage():
    """Get S3 storage instance (if configured)."""
    if not all([S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY]):
        return None
    
    try:
        return S3FileStorage()
    except Exception as e:
        logger.error(f"Failed to initialize S3 storage: {e}")
        return None


def get_local_storage():
    """Get local filesystem storage instance."""
    return LocalFileStorage()


def sync_files(source_storage, dest_storage, direction: str, dry_run: bool = False):
    """
    Sync files from source_storage to dest_storage.
    
    Args:
        source_storage: Source storage backend (LocalFileStorage or S3FileStorage)
        dest_storage: Destination storage backend
        direction: "s3-to-local" or "local-to-s3" (for logging)
        dry_run: If True, only show what would be synced without copying
    """
    db = SessionLocal()
    
    try:
        # Get all creations from database
        creations = db.query(Creation).all()
        logger.info(f"Found {len(creations)} creations in database")
        
        total_files = 0
        synced_files = 0
        skipped_files = 0
        error_files = 0
        
        for creation in creations:
            user_id = creation.user_id
            creation_id = creation.id
            
            # List files in source storage
            try:
                source_files = source_storage.list_files(user_id, creation_id)
            except Exception as e:
                logger.warning(f"[{creation_id}] Failed to list files in source: {e}")
                continue
            
            if not source_files:
                continue
            
            logger.info(f"[{creation_id}] Found {len(source_files)} files in source storage")
            
            for filename in source_files:
                total_files += 1
                source_key = f"{user_id}/{creation_id}/{filename}"
                
                # Check if file already exists in destination
                if dest_storage.file_exists(user_id, creation_id, filename):
                    if dry_run:
                        logger.info(f"  [DRY RUN] Would skip (exists): {source_key}")
                    else:
                        logger.debug(f"  Skipping (exists): {source_key}")
                    skipped_files += 1
                    continue
                
                # Copy file from source to destination
                try:
                    if dry_run:
                        logger.info(f"  [DRY RUN] Would sync: {source_key}")
                        synced_files += 1
                    else:
                        # Download from source
                        file_data = source_storage.download_file(user_id, creation_id, filename)
                        
                        # Upload to destination
                        dest_storage.upload_file(user_id, creation_id, filename, file_data)
                        
                        logger.info(f"  Synced: {source_key} ({len(file_data)} bytes)")
                        synced_files += 1
                except Exception as e:
                    logger.error(f"  Error syncing {source_key}: {e}")
                    error_files += 1
        
        logger.info(f"\nSync summary ({direction}):")
        logger.info(f"  Total files: {total_files}")
        logger.info(f"  Synced: {synced_files}")
        logger.info(f"  Skipped (already exist): {skipped_files}")
        logger.info(f"  Errors: {error_files}")
        
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(
        description="Sync files between S3 and local storage",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument(
        '--direction',
        choices=['s3-to-local', 'local-to-s3'],
        default='s3-to-local',
        help='Sync direction (default: s3-to-local)'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be synced without actually copying files'
    )
    
    args = parser.parse_args()
    
    # Validate S3 configuration if needed
    if args.direction == 's3-to-local':
        s3_storage = get_s3_storage()
        if not s3_storage:
            logger.error("S3 storage not configured. Set S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY")
            sys.exit(1)
        local_storage = get_local_storage()
        logger.info(f"Syncing from S3 ({S3_BUCKET}) to local ({FILES_ROOT})")
        sync_files(s3_storage, local_storage, args.direction, args.dry_run)
    
    elif args.direction == 'local-to-s3':
        s3_storage = get_s3_storage()
        if not s3_storage:
            logger.error("S3 storage not configured. Set S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY")
            sys.exit(1)
        local_storage = get_local_storage()
        logger.info(f"Syncing from local ({FILES_ROOT}) to S3 ({S3_BUCKET})")
        sync_files(local_storage, s3_storage, args.direction, args.dry_run)


if __name__ == "__main__":
    main()
