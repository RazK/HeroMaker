"""
One-time migration script to migrate files from local filesystem to S3 (Railway Storage Buckets).

Usage:
    python scripts/migrate_files_to_s3.py

This script:
1. Reads all files from local FILES_ROOT directory
2. Uploads them to S3 maintaining the same structure: {user_id}/{creation_id}/{filename}
3. Verifies all files were uploaded correctly

Note: This is a one-time migration. After migration, the application will use S3 automatically
if S3_BUCKET environment variable is set.
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).parent.parent))

load_dotenv()

from app.config.settings import FILES_ROOT
from app.utils.storage import get_storage, LocalFileStorage, S3FileStorage

def migrate_files_to_s3():
    """Migrate all files from local filesystem to S3."""
    # Check if S3 is configured
    if not os.getenv("S3_BUCKET"):
        print("ERROR: S3_BUCKET environment variable not set. Cannot migrate to S3.")
        print("Please set S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY before running migration.")
        sys.exit(1)
    
    # Get storage instances
    local_storage = LocalFileStorage()
    s3_storage = S3FileStorage()
    
    files_root = Path(FILES_ROOT)
    if not files_root.exists():
        print(f"ERROR: Local files directory not found: {files_root}")
        sys.exit(1)
    
    print(f"Starting migration from {files_root} to S3 bucket: {s3_storage.bucket_name}")
    print("-" * 60)
    
    # Walk through all files
    total_files = 0
    migrated_files = 0
    failed_files = []
    
    for user_dir in files_root.iterdir():
        if not user_dir.is_dir():
            continue
        
        user_id = user_dir.name
        print(f"\nProcessing user: {user_id}")
        
        for creation_dir in user_dir.iterdir():
            if not creation_dir.is_dir():
                continue
            
            creation_id = creation_dir.name
            print(f"  Processing creation: {creation_id}")
            
            for file_path in creation_dir.iterdir():
                if not file_path.is_file():
                    continue
                
                filename = file_path.name
                total_files += 1
                
                try:
                    # Check if file already exists in S3
                    if s3_storage.file_exists(user_id, creation_id, filename):
                        print(f"    ✓ {filename} (already in S3, skipping)")
                        continue
                    
                    # Read file from local storage
                    file_data = file_path.read_bytes()
                    
                    # Upload to S3
                    s3_storage.upload_file(user_id, creation_id, filename, file_data)
                    
                    # Verify upload
                    if s3_storage.file_exists(user_id, creation_id, filename):
                        migrated_files += 1
                        print(f"    ✓ {filename} ({len(file_data)}:,} bytes)")
                    else:
                        failed_files.append(f"{user_id}/{creation_id}/{filename}")
                        print(f"    ✗ {filename} (verification failed)")
                
                except Exception as e:
                    failed_files.append(f"{user_id}/{creation_id}/{filename}")
                    print(f"    ✗ {filename} (error: {e})")
    
    print("\n" + "=" * 60)
    print("Migration Summary:")
    print(f"  Total files: {total_files}")
    print(f"  Migrated: {migrated_files}")
    print(f"  Failed: {len(failed_files)}")
    
    if failed_files:
        print("\nFailed files:")
        for failed_file in failed_files:
            print(f"  - {failed_file}")
        sys.exit(1)
    else:
        print("\n✓ All files migrated successfully!")
        print("\nNext steps:")
        print("1. Verify files in Railway Storage Bucket dashboard")
        print("2. Set S3_BUCKET environment variable in Railway")
        print("3. Deploy updated backend code")
        print("4. Test file access via presigned URLs")

if __name__ == "__main__":
    migrate_files_to_s3()

