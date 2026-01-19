#!/usr/bin/env python3
"""
Sync Railway creations (database + files) to local environment.

This script:
1. Pulls database records from Railway PostgreSQL → local SQLite
2. Downloads files from Railway S3 → local filesystem

Usage:
    # Requires .env.railway with Railway credentials
    python scripts/sync_railway_to_local.py

    # Dry run (show what would be synced)
    python scripts/sync_railway_to_local.py --dry-run

    # Sync only database (skip files)
    python scripts/sync_railway_to_local.py --db-only

    # Sync only files (skip database)
    python scripts/sync_railway_to_local.py --files-only

Prerequisites:
- .env.railway file with Railway PostgreSQL and S3 credentials
- Local SQLite database will be created if it doesn't exist
"""

import os
import sys
import argparse
from pathlib import Path
from dotenv import load_dotenv

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Get project root
PROJECT_ROOT = Path(__file__).parent.parent.parent

# Load Railway credentials from .env.railway
railway_env = PROJECT_ROOT / ".env.railway"
if not railway_env.exists():
    print("ERROR: .env.railway not found!")
    print(f"Expected at: {railway_env}")
    print("\nCreate .env.railway with:")
    print("  DATABASE_URL=postgresql://...")
    print("  S3_BUCKET=...")
    print("  S3_ENDPOINT=...")
    print("  S3_ACCESS_KEY_ID=...")
    print("  S3_SECRET_ACCESS_KEY=...")
    sys.exit(1)

# Load Railway env vars
load_dotenv(railway_env, override=True)
print(f"✓ Loaded Railway credentials from: {railway_env}")

# Now import after loading env
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import User, Creation, CreationStep, CouponUsage, Coupon
from app.utils.storage import LocalFileStorage, S3FileStorage


def get_railway_db():
    """Get Railway PostgreSQL connection."""
    db_url = os.getenv("DATABASE_URL")
    if not db_url or not db_url.startswith("postgresql"):
        print("ERROR: DATABASE_URL not set or not PostgreSQL")
        return None, None
    
    engine = create_engine(db_url)
    Session = sessionmaker(bind=engine)
    return engine, Session()


def get_local_db():
    """Get local SQLite connection."""
    sqlite_path = PROJECT_ROOT / "data" / "db" / "heromaker.db"
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    
    sqlite_url = f"sqlite:///{sqlite_path.absolute()}"
    engine = create_engine(sqlite_url, connect_args={"check_same_thread": False})
    
    # Create tables if they don't exist
    Base.metadata.create_all(bind=engine)
    
    Session = sessionmaker(bind=engine)
    return engine, Session()


def sync_database(dry_run: bool = False):
    """Sync database from Railway PostgreSQL to local SQLite."""
    print("\n" + "=" * 60)
    print("DATABASE SYNC: Railway PostgreSQL → Local SQLite")
    print("=" * 60)
    
    _, railway_session = get_railway_db()
    _, local_session = get_local_db()
    
    if not railway_session:
        return False
    
    try:
        # Get counts from Railway
        railway_users = railway_session.query(User).count()
        railway_creations = railway_session.query(Creation).count()
        railway_steps = railway_session.query(CreationStep).count()
        railway_coupons = railway_session.query(Coupon).count()
        
        print(f"\nRailway has:")
        print(f"  Users: {railway_users}")
        print(f"  Creations: {railway_creations}")
        print(f"  Steps: {railway_steps}")
        print(f"  Coupons: {railway_coupons}")
        
        if dry_run:
            print("\n[DRY RUN] Would sync all records to local SQLite")
            return True
        
        # Sync Users
        print("\nSyncing users...")
        users = railway_session.query(User).all()
        synced_users = 0
        for user in users:
            existing = local_session.query(User).filter(User.id == user.id).first()
            if existing:
                # Update existing
                for col in ['email', 'google_id', 'username', 'name', 'date_of_birth',
                           'password_hash', 'is_admin', 'credits', 'subscription_tier',
                           'created_at', 'updated_at']:
                    setattr(existing, col, getattr(user, col, None))
            else:
                # Create new
                new_user = User(
                    id=user.id,
                    email=user.email,
                    google_id=getattr(user, 'google_id', None),
                    username=user.username,
                    name=getattr(user, 'name', None),
                    date_of_birth=getattr(user, 'date_of_birth', None),
                    password_hash=user.password_hash,
                    is_admin=user.is_admin,
                    credits=getattr(user, 'credits', 0),
                    subscription_tier=user.subscription_tier,
                    created_at=user.created_at,
                    updated_at=user.updated_at
                )
                local_session.add(new_user)
            synced_users += 1
        local_session.commit()
        print(f"  ✓ Synced {synced_users} users")
        
        # Sync Coupons (before CouponUsage due to FK)
        print("\nSyncing coupons...")
        coupons = railway_session.query(Coupon).all()
        synced_coupons = 0
        for coupon in coupons:
            existing = local_session.query(Coupon).filter(Coupon.id == coupon.id).first()
            if existing:
                for col in ['code', 'credits', 'max_uses', 'current_uses', 
                           'expires_at', 'is_active', 'created_at']:
                    setattr(existing, col, getattr(coupon, col, None))
            else:
                new_coupon = Coupon(
                    id=coupon.id,
                    code=coupon.code,
                    credits=coupon.credits,
                    max_uses=getattr(coupon, 'max_uses', None),
                    current_uses=getattr(coupon, 'current_uses', 0),
                    expires_at=coupon.expires_at,
                    is_active=coupon.is_active,
                    created_at=coupon.created_at
                )
                local_session.add(new_coupon)
            synced_coupons += 1
        local_session.commit()
        print(f"  ✓ Synced {synced_coupons} coupons")
        
        # Sync Creations
        print("\nSyncing creations...")
        creations = railway_session.query(Creation).all()
        synced_creations = 0
        for creation in creations:
            existing = local_session.query(Creation).filter(Creation.id == creation.id).first()
            if existing:
                for col in ['user_id', 'character_name', 'name', 'age', 'is_public',
                           'metadata_json', 'created_at', 'updated_at']:
                    setattr(existing, col, getattr(creation, col, None))
            else:
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
                local_session.add(new_creation)
            synced_creations += 1
        local_session.commit()
        print(f"  ✓ Synced {synced_creations} creations")
        
        # Sync CreationSteps
        print("\nSyncing creation steps...")
        steps = railway_session.query(CreationStep).all()
        synced_steps = 0
        for step in steps:
            existing = local_session.query(CreationStep).filter(
                CreationStep.creation_id == step.creation_id,
                CreationStep.step_name == step.step_name
            ).first()
            if existing:
                for col in ['status', 'started_at', 'completed_at', 'error_message',
                           'estimated_duration', 'estimated_progress', 
                           'estimated_completion_time', 'metadata_json',
                           'created_at', 'updated_at']:
                    setattr(existing, col, getattr(step, col, None))
            else:
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
                local_session.add(new_step)
            synced_steps += 1
        local_session.commit()
        print(f"  ✓ Synced {synced_steps} creation steps")
        
        # Verify
        print("\nVerifying local database...")
        local_users = local_session.query(User).count()
        local_creations = local_session.query(Creation).count()
        local_steps = local_session.query(CreationStep).count()
        local_coupons = local_session.query(Coupon).count()
        
        print(f"  Local now has:")
        print(f"    Users: {local_users}")
        print(f"    Creations: {local_creations}")
        print(f"    Steps: {local_steps}")
        print(f"    Coupons: {local_coupons}")
        
        print("\n✓ Database sync completed!")
        return True
        
    except Exception as e:
        local_session.rollback()
        print(f"\n✗ Database sync failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        railway_session.close()
        local_session.close()


def sync_files(dry_run: bool = False):
    """Sync files from Railway S3 to local filesystem."""
    print("\n" + "=" * 60)
    print("FILE SYNC: Railway S3 → Local Filesystem")
    print("=" * 60)
    
    # Check S3 config
    if not os.getenv("S3_BUCKET"):
        print("ERROR: S3_BUCKET not set in .env.railway")
        return False
    
    try:
        s3_storage = S3FileStorage()
        local_storage = LocalFileStorage()
    except Exception as e:
        print(f"ERROR: Failed to initialize storage: {e}")
        return False
    
    print(f"Source: S3 bucket {s3_storage.bucket_name}")
    print(f"Destination: {local_storage.files_root}")
    
    # Get creations from local database (should be synced first)
    _, local_session = get_local_db()
    
    try:
        creations = local_session.query(Creation).all()
        print(f"\nProcessing {len(creations)} creations...")
        
        total_files = 0
        synced_files = 0
        skipped_files = 0
        error_files = 0
        
        for creation in creations:
            user_id = creation.user_id
            creation_id = creation.id
            
            # List files in S3
            try:
                s3_files = s3_storage.list_files(user_id, creation_id)
            except Exception as e:
                print(f"  [{creation_id[:8]}] Failed to list S3 files: {e}")
                continue
            
            if not s3_files:
                continue
            
            for filename in s3_files:
                total_files += 1
                
                # Check if already exists locally
                if local_storage.file_exists(user_id, creation_id, filename):
                    skipped_files += 1
                    continue
                
                if dry_run:
                    print(f"  [DRY RUN] Would download: {user_id[:8]}/{creation_id[:8]}/{filename}")
                    synced_files += 1
                    continue
                
                try:
                    # Download from S3
                    file_data = s3_storage.download_file(user_id, creation_id, filename)
                    
                    # Save locally
                    local_storage.upload_file(user_id, creation_id, filename, file_data)
                    
                    size_kb = len(file_data) / 1024
                    print(f"  ✓ {creation_id[:8]}/{filename} ({size_kb:.1f} KB)")
                    synced_files += 1
                    
                except Exception as e:
                    print(f"  ✗ {creation_id[:8]}/{filename}: {e}")
                    error_files += 1
        
        print(f"\nFile sync summary:")
        print(f"  Total files: {total_files}")
        print(f"  Downloaded: {synced_files}")
        print(f"  Skipped (already exist): {skipped_files}")
        print(f"  Errors: {error_files}")
        
        if error_files == 0:
            print("\n✓ File sync completed!")
            return True
        else:
            print(f"\n⚠ File sync completed with {error_files} errors")
            return False
            
    finally:
        local_session.close()


def main():
    parser = argparse.ArgumentParser(
        description="Sync Railway creations to local environment",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument('--dry-run', action='store_true',
                       help='Show what would be synced without copying')
    parser.add_argument('--db-only', action='store_true',
                       help='Sync only database, skip files')
    parser.add_argument('--files-only', action='store_true',
                       help='Sync only files, skip database')
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("SYNC RAILWAY → LOCAL")
    print("=" * 60)
    
    db_success = True
    files_success = True
    
    if not args.files_only:
        db_success = sync_database(args.dry_run)
    
    if not args.db_only:
        files_success = sync_files(args.dry_run)
    
    # Summary
    print("\n" + "=" * 60)
    print("SYNC SUMMARY")
    print("=" * 60)
    
    if not args.files_only:
        status = "✓ SUCCESS" if db_success else "✗ FAILED"
        print(f"Database sync: {status}")
    
    if not args.db_only:
        status = "✓ SUCCESS" if files_success else "✗ FAILED"
        print(f"File sync: {status}")
    
    if db_success and files_success:
        print("\n✅ All syncs completed!")
        sys.exit(0)
    else:
        print("\n⚠ Some syncs failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
