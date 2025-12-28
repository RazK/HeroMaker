"""
One-time migration script to migrate data from SQLite to PostgreSQL.

Usage:
    python scripts/migrate_to_postgres.py

This script:
1. Connects to local SQLite database
2. Connects to Railway PostgreSQL database
3. Exports all data from SQLite
4. Imports data into PostgreSQL
5. Verifies data integrity

Prerequisites:
- Local SQLite database must exist
- DATABASE_URL environment variable must point to PostgreSQL connection string
- PostgreSQL database must be accessible

Note: This is a one-time migration. After migration, the application will use PostgreSQL
automatically if DATABASE_URL points to a PostgreSQL connection string.
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).parent.parent))

load_dotenv()

from app.config.settings import DATABASE_URL
from app.database import Base
from app.models import User, Creation, CreationStep

def migrate_to_postgres():
    """Migrate data from SQLite to PostgreSQL."""
    # Check if DATABASE_URL points to PostgreSQL
    if not DATABASE_URL.startswith("postgresql"):
        print("ERROR: DATABASE_URL does not point to PostgreSQL.")
        print(f"Current DATABASE_URL: {DATABASE_URL}")
        print("Please set DATABASE_URL to a PostgreSQL connection string (e.g., postgresql://user:pass@host:port/dbname)")
        sys.exit(1)
    
    # Get SQLite database path from original settings
    sqlite_url = os.getenv("SQLITE_DATABASE_URL", "sqlite:///./data/db/heromaker.db")
    
    if not sqlite_url.startswith("sqlite"):
        print("ERROR: SQLITE_DATABASE_URL not set or not a SQLite URL.")
        print("Please set SQLITE_DATABASE_URL to your local SQLite database path.")
        sys.exit(1)
    
    print("Starting migration from SQLite to PostgreSQL")
    print("-" * 60)
    print(f"Source (SQLite): {sqlite_url}")
    print(f"Destination (PostgreSQL): {DATABASE_URL.split('@')[1] if '@' in DATABASE_URL else 'hidden'}")
    print("-" * 60)
    
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
        for user in users:
            # Check if user already exists
            existing = postgres_session.query(User).filter(User.id == user.id).first()
            if existing:
                print(f"  User {user.id} already exists, skipping")
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
        print(f"✓ Migrated {user_count} users")
        
        # Migrate Creations
        print("\nMigrating creations...")
        creations = sqlite_session.query(Creation).all()
        creation_count = 0
        for creation in creations:
            # Check if creation already exists
            existing = postgres_session.query(Creation).filter(Creation.id == creation.id).first()
            if existing:
                print(f"  Creation {creation.id} already exists, skipping")
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
        
        postgres_session.commit()
        print(f"✓ Migrated {creation_count} creations")
        
        # Migrate CreationSteps
        print("\nMigrating creation steps...")
        steps = sqlite_session.query(CreationStep).all()
        step_count = 0
        for step in steps:
            # Check if step already exists
            existing = postgres_session.query(CreationStep).filter(
                CreationStep.creation_id == step.creation_id,
                CreationStep.step_name == step.step_name
            ).first()
            if existing:
                print(f"  Step {step.creation_id}/{step.step_name} already exists, skipping")
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
        
        postgres_session.commit()
        print(f"✓ Migrated {step_count} creation steps")
        
        # Verify data integrity
        print("\n" + "=" * 60)
        print("Verifying data integrity...")
        
        sqlite_user_count = sqlite_session.query(User).count()
        postgres_user_count = postgres_session.query(User).count()
        
        sqlite_creation_count = sqlite_session.query(Creation).count()
        postgres_creation_count = postgres_session.query(Creation).count()
        
        sqlite_step_count = sqlite_session.query(CreationStep).count()
        postgres_step_count = postgres_session.query(CreationStep).count()
        
        print(f"Users: SQLite={sqlite_user_count}, PostgreSQL={postgres_user_count}")
        print(f"Creations: SQLite={sqlite_creation_count}, PostgreSQL={postgres_creation_count}")
        print(f"Steps: SQLite={sqlite_step_count}, PostgreSQL={postgres_step_count}")
        
        if (sqlite_user_count == postgres_user_count and
            sqlite_creation_count == postgres_creation_count and
            sqlite_step_count == postgres_step_count):
            print("\n✓ Data integrity verified!")
            print("\nMigration completed successfully!")
            print("\nNext steps:")
            print("1. Verify data in Railway PostgreSQL dashboard")
            print("2. Set DATABASE_URL environment variable in Railway to PostgreSQL connection string")
            print("3. Deploy updated backend code")
            print("4. Test application with PostgreSQL")
        else:
            print("\n⚠ WARNING: Record counts don't match!")
            print("Please review the migration and verify data manually.")
            sys.exit(1)
    
    except Exception as e:
        postgres_session.rollback()
        print(f"\n✗ Migration failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    
    finally:
        sqlite_session.close()
        postgres_session.close()

if __name__ == "__main__":
    migrate_to_postgres()

