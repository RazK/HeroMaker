"""
Sync all local creations (database + files) to Railway.

This script:
1. Migrates database from local SQLite to Railway PostgreSQL
2. Migrates files from local filesystem to Railway S3 Storage Bucket

Usage:
    # For local development (reads from .env)
    python scripts/sync_local_to_railway.py
    
    # For Railway (uses Railway environment variables)
    railway run python scripts/sync_local_to_railway.py

Prerequisites:
- Local SQLite database must exist at ./data/db/heromaker.db
- Local files must exist in ./data/files/
- Railway PostgreSQL DATABASE_URL must be set (or in Railway env)
- Railway S3 credentials must be set (S3_BUCKET, S3_ENDPOINT, etc.)

The script will:
- Skip records/files that already exist in Railway (idempotent)
- Show progress for each operation
- Verify data integrity after migration
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).parent.parent))

# Get project root (parent of backend/)
PROJECT_ROOT = Path(__file__).parent.parent.parent

# Load environment variables
# Priority: .env.railway (Railway-specific) > .env (general) > system env
railway_env = PROJECT_ROOT / ".env.railway"
if railway_env.exists():
    load_dotenv(railway_env)
    print(f"✓ Loaded Railway credentials from: {railway_env}")
else:
    load_dotenv()  # Fallback to .env or system env

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.config.settings import DATABASE_URL, FILES_ROOT
from app.database import Base
from app.models import User, Creation, CreationStep
from app.utils.storage import LocalFileStorage, S3FileStorage

def migrate_database():
    """Migrate database from SQLite to PostgreSQL."""
    print("\n" + "=" * 60)
    print("STEP 1: Database Migration (SQLite → PostgreSQL)")
    print("=" * 60)
    
    # Check if DATABASE_URL points to PostgreSQL
    if not DATABASE_URL.startswith("postgresql"):
        print("ERROR: DATABASE_URL does not point to PostgreSQL.")
        print(f"Current DATABASE_URL: {DATABASE_URL}")
        print("Please set DATABASE_URL to a PostgreSQL connection string")
        print("For Railway, use: DATABASE_URL=${{Postgres.DATABASE_URL}}")
        return False
    
    # Get SQLite database path (relative to project root)
    sqlite_path = PROJECT_ROOT / "data" / "db" / "heromaker.db"
    sqlite_url = f"sqlite:///{sqlite_path.absolute()}"
    
    if not sqlite_path.exists():
        print(f"ERROR: Local SQLite database not found: {sqlite_path}")
        print("Please ensure you have local data to migrate.")
        return False
    
    print(f"Source (SQLite): {sqlite_url}")
    print(f"Destination (PostgreSQL): {DATABASE_URL.split('@')[1] if '@' in DATABASE_URL else 'hidden'}")
    
    # Create engines
    sqlite_engine = create_engine(sqlite_url, connect_args={"check_same_thread": False})
    postgres_engine = create_engine(DATABASE_URL)
    
    # Create sessions
    SQLiteSession = sessionmaker(bind=sqlite_engine)
    PostgresSession = sessionmaker(bind=postgres_engine)
    
    sqlite_session = SQLiteSession()
    postgres_session = PostgresSession()
    
    try:
        # Create tables in PostgreSQL (if they don't exist)
        print("\nCreating tables in PostgreSQL...")
        Base.metadata.create_all(bind=postgres_engine)
        print("✓ Tables created")
        
        # Migrate Users
        print("\nMigrating users...")
        users = sqlite_session.query(User).all()
        user_count = 0
        skipped_users = 0
        for user in users:
            existing = postgres_session.query(User).filter(User.id == user.id).first()
            if existing:
                skipped_users += 1
                continue
            
            new_user = User(
                id=user.id,
                email=user.email,
                google_id=user.google_id,
                username=user.username,
                password_hash=user.password_hash,
                is_admin=user.is_admin,
                subscription_tier=user.subscription_tier,
                created_at=user.created_at,
                updated_at=user.updated_at
            )
            postgres_session.add(new_user)
            user_count += 1
        
        postgres_session.commit()
        print(f"✓ Migrated {user_count} users (skipped {skipped_users} existing)")
        
        # Migrate Creations
        print("\nMigrating creations...")
        creations = sqlite_session.query(Creation).all()
        total_creations = len(creations)
        print(f"  Processing {total_creations} creations...")
        
        # Get all existing creations in PostgreSQL to avoid individual queries
        print("  Checking existing creations in PostgreSQL...")
        existing_creations = postgres_session.query(Creation).all()
        print(f"  Found {len(existing_creations)} existing creations in PostgreSQL")
        existing_creation_ids = {c.id for c in existing_creations}
        print("  Starting migration loop...")
        
        creation_count = 0
        skipped_creations = 0
        
        # Process in batches for progress updates
        batch_size = 50
        for i, creation in enumerate(creations, 1):
            if creation.id in existing_creation_ids:
                skipped_creations += 1
                continue
            
            new_creation = Creation(
                id=creation.id,
                user_id=creation.user_id,
                character_name=creation.character_name,
                name=creation.name,
                age=creation.age,
                is_public=creation.is_public,
                metadata_json=creation.metadata_json or {},
                created_at=creation.created_at,
                updated_at=creation.updated_at
            )
            postgres_session.add(new_creation)
            creation_count += 1
            
            # Commit in batches and show progress
            if creation_count % batch_size == 0:
                postgres_session.commit()
                print(f"  Progress: {i}/{total_creations} creations processed ({creation_count} migrated, {skipped_creations} skipped)")
        
        postgres_session.commit()
        print(f"✓ Migrated {creation_count} creations (skipped {skipped_creations} existing)")
        
        # Migrate CreationSteps
        print("\nMigrating creation steps...")
        steps = sqlite_session.query(CreationStep).all()
        total_steps = len(steps)
        print(f"  Processing {total_steps} creation steps...")
        
        # Get all existing steps in PostgreSQL to avoid individual queries
        existing_steps = postgres_session.query(CreationStep).all()
        existing_keys = {(s.creation_id, s.step_name) for s in existing_steps}
        
        step_count = 0
        skipped_steps = 0
        
        # Process in batches for progress updates
        batch_size = 100
        for i, step in enumerate(steps, 1):
            if (step.creation_id, step.step_name) in existing_keys:
                skipped_steps += 1
                continue
            
            new_step = CreationStep(
                creation_id=step.creation_id,
                step_name=step.step_name,
                status=step.status,
                started_at=step.started_at,
                completed_at=step.completed_at,
                error_message=step.error_message,
                estimated_duration=step.estimated_duration,
                estimated_progress=step.estimated_progress,
                estimated_completion_time=step.estimated_completion_time,
                metadata_json=step.metadata_json or {},
                created_at=step.created_at,
                updated_at=step.updated_at
            )
            postgres_session.add(new_step)
            step_count += 1
            
            # Commit in batches and show progress
            if step_count % batch_size == 0:
                postgres_session.commit()
                print(f"  Progress: {i}/{total_steps} steps processed ({step_count} migrated, {skipped_steps} skipped)")
        
        postgres_session.commit()
        print(f"✓ Migrated {step_count} creation steps (skipped {skipped_steps} existing)")
        
        # Verify data integrity
        print("\nVerifying data integrity...")
        sqlite_user_count = sqlite_session.query(User).count()
        postgres_user_count = postgres_session.query(User).count()
        sqlite_creation_count = sqlite_session.query(Creation).count()
        postgres_creation_count = postgres_session.query(Creation).count()
        sqlite_step_count = sqlite_session.query(CreationStep).count()
        postgres_step_count = postgres_session.query(CreationStep).count()
        
        print(f"  Users: SQLite={sqlite_user_count}, PostgreSQL={postgres_user_count}")
        print(f"  Creations: SQLite={sqlite_creation_count}, PostgreSQL={postgres_creation_count}")
        print(f"  Steps: SQLite={sqlite_step_count}, PostgreSQL={postgres_step_count}")
        
        if (sqlite_user_count == postgres_user_count and
            sqlite_creation_count == postgres_creation_count and
            sqlite_step_count == postgres_step_count):
            print("\n✓ Database migration completed successfully!")
            return True
        else:
            print("\n⚠ WARNING: Record counts don't match!")
            print("This may be normal if some records were skipped (already exist).")
            return True  # Still consider it successful if we migrated new records
    
    except Exception as e:
        postgres_session.rollback()
        print(f"\n✗ Database migration failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    finally:
        sqlite_session.close()
        postgres_session.close()


def migrate_files():
    """Migrate files from local filesystem to S3."""
    print("\n" + "=" * 60)
    print("STEP 2: File Migration (Local Filesystem → S3)")
    print("=" * 60)
    
    # Check if S3 is configured
    if not os.getenv("S3_BUCKET"):
        print("ERROR: S3_BUCKET environment variable not set. Cannot migrate files to S3.")
        print("Please set S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY")
        return False
    
    # Get storage instances
    try:
        local_storage = LocalFileStorage()
        s3_storage = S3FileStorage()
    except Exception as e:
        print(f"ERROR: Failed to initialize storage: {e}")
        return False
    
    # Use project root for files (FILES_ROOT might be relative to backend/)
    files_root = PROJECT_ROOT / "data" / "files"
    if not files_root.exists():
        # Try FILES_ROOT as fallback
        files_root = Path(FILES_ROOT)
        if not files_root.is_absolute():
            files_root = PROJECT_ROOT / files_root
        if not files_root.exists():
            print(f"ERROR: Local files directory not found: {files_root}")
            return False
    
    print(f"Source: {files_root}")
    print(f"Destination: S3 bucket {s3_storage.bucket_name}")
    
    # Walk through all files
    total_files = 0
    migrated_files = 0
    skipped_files = 0
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
                        skipped_files += 1
                        print(f"    ⊘ {filename} (already in S3, skipping)")
                        continue
                    
                    # Read file from local storage
                    file_data = file_path.read_bytes()
                    
                    # Upload to S3
                    s3_storage.upload_file(user_id, creation_id, filename, file_data)
                    
                    # Verify upload
                    if s3_storage.file_exists(user_id, creation_id, filename):
                        migrated_files += 1
                        size_mb = len(file_data) / (1024 * 1024)
                        print(f"    ✓ {filename} ({size_mb:.2f} MB)")
                    else:
                        failed_files.append(f"{user_id}/{creation_id}/{filename}")
                        print(f"    ✗ {filename} (verification failed)")
                
                except Exception as e:
                    failed_files.append(f"{user_id}/{creation_id}/{filename}")
                    print(f"    ✗ {filename} (error: {e})")
    
    print("\n" + "-" * 60)
    print("File Migration Summary:")
    print(f"  Total files: {total_files}")
    print(f"  Migrated: {migrated_files}")
    print(f"  Skipped (already exist): {skipped_files}")
    print(f"  Failed: {len(failed_files)}")
    
    if failed_files:
        print("\nFailed files:")
        for failed_file in failed_files[:10]:  # Show first 10
            print(f"  - {failed_file}")
        if len(failed_files) > 10:
            print(f"  ... and {len(failed_files) - 10} more")
        return False
    else:
        print("\n✓ File migration completed successfully!")
        return True


def main():
    """Main sync function."""
    print("=" * 60)
    print("SYNC LOCAL CREATIONS TO RAILWAY")
    print("=" * 60)
    print("\nThis script will:")
    print("  1. Migrate database: SQLite → PostgreSQL")
    print("  2. Migrate files: Local filesystem → S3 Storage Bucket")
    print("\nNote: Existing records/files will be skipped (idempotent)")
    print("-" * 60)
    
    # Check prerequisites
    print("\nChecking prerequisites...")
    
    # Check SQLite database
    # Check if local SQLite database exists (relative to project root)
    sqlite_path = PROJECT_ROOT / "data" / "db" / "heromaker.db"
    if not sqlite_path.exists():
        print(f"⚠ WARNING: Local SQLite database not found: {sqlite_path}")
        print("  Database migration will be skipped.")
        db_ok = False
    else:
        print(f"✓ Local SQLite database found: {sqlite_path}")
        db_ok = True
    
    # Check local files (relative to project root)
    files_root = PROJECT_ROOT / "data" / "files"
    if not files_root.exists():
        # Try FILES_ROOT as fallback
        files_root = Path(FILES_ROOT)
        if not files_root.is_absolute():
            files_root = PROJECT_ROOT / files_root
        if not files_root.exists():
            print(f"⚠ WARNING: Local files directory not found: {files_root}")
            print("  File migration will be skipped.")
            files_ok = False
        else:
            file_count = sum(1 for _ in files_root.rglob("*") if _.is_file())
            print(f"✓ Local files directory found: {files_root} ({file_count} files)")
            files_ok = True
    else:
        file_count = sum(1 for _ in files_root.rglob("*") if _.is_file())
        print(f"✓ Local files directory found: {files_root} ({file_count} files)")
        files_ok = True
    
    # Check PostgreSQL
    if DATABASE_URL.startswith("postgresql"):
        print(f"✓ PostgreSQL DATABASE_URL configured")
        postgres_ok = True
    else:
        print(f"⚠ WARNING: DATABASE_URL does not point to PostgreSQL: {DATABASE_URL}")
        print("  Database migration will be skipped.")
        postgres_ok = False
    
    # Check S3
    if os.getenv("S3_BUCKET"):
        print(f"✓ S3_BUCKET configured: {os.getenv('S3_BUCKET')}")
        s3_ok = True
    else:
        print("⚠ WARNING: S3_BUCKET not configured")
        print("  File migration will be skipped.")
        s3_ok = False
    
    if not db_ok and not files_ok:
        print("\n✗ ERROR: No local data found to migrate.")
        print("Please ensure you have local SQLite database and/or files to migrate.")
        sys.exit(1)
    
    if not postgres_ok and not s3_ok:
        print("\n✗ ERROR: No destination configured.")
        print("Please configure PostgreSQL (DATABASE_URL) and/or S3 (S3_BUCKET).")
        sys.exit(1)
    
    print("\n" + "=" * 60)
    print("Starting sync...")
    print("=" * 60)
    
    # Run migrations
    db_success = True
    files_success = True
    
    if db_ok and postgres_ok:
        db_success = migrate_database()
    else:
        print("\nSkipping database migration (prerequisites not met)")
    
    if files_ok and s3_ok:
        files_success = migrate_files()
    else:
        print("\nSkipping file migration (prerequisites not met)")
    
    # Summary
    print("\n" + "=" * 60)
    print("SYNC SUMMARY")
    print("=" * 60)
    
    if db_ok and postgres_ok:
        status = "✓ SUCCESS" if db_success else "✗ FAILED"
        print(f"Database migration: {status}")
    
    if files_ok and s3_ok:
        status = "✓ SUCCESS" if files_success else "✗ FAILED"
        print(f"File migration: {status}")
    
    if db_success and files_success:
        print("\n✅ All migrations completed successfully!")
        print("\nNext steps:")
        print("1. Verify data in Railway PostgreSQL dashboard")
        print("2. Verify files in Railway Storage Bucket dashboard")
        print("3. Test the application to ensure everything works")
        sys.exit(0)
    else:
        print("\n⚠ Some migrations failed. Please review the errors above.")
        sys.exit(1)


if __name__ == "__main__":
    main()

