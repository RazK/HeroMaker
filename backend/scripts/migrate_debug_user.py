"""
One-time migration script to convert debug user to a real authenticated account.

Usage:
    python scripts/migrate_debug_user.py

This script:
1. Finds or creates the debug user (debug-user-uuid)
2. Sets password hash for the debug user (password: HeroMaker1337!)
3. Sets username to "debug" if not set
4. Sets email to debug@heromaker.local if not set
5. Sets credits to 1000 for testing
6. Ensures all creations belong to this user

Prerequisites:
- Database must be accessible
- Migrations must have been run (credits column must exist)
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).parent.parent))

# Load .env from project root (2 levels up from scripts/)
project_root = Path(__file__).parent.parent.parent
# Don't override DATABASE_URL from .env - use the absolute path from settings
load_dotenv(dotenv_path=project_root / ".env", override=False)

from app.database import SessionLocal, engine, Base
from app.models import User, Creation
from app.services.auth import hash_password
from sqlalchemy import text
from app.config.settings import DATABASE_URL

# Ensure tables exist
Base.metadata.create_all(bind=engine)

DEBUG_USER_ID = "debug-user-uuid"
DEBUG_USER_EMAIL = "debug@heromaker.local"
DEBUG_USERNAME = "debug"
DEBUG_PASSWORD = "HeroMaker1337!"
DEBUG_CREDITS = 1000


def migrate_debug_user():
    """Convert debug user to real authenticated account."""
    db = SessionLocal()
    
    try:
        # Find or create debug user
        user = db.query(User).filter(User.id == DEBUG_USER_ID).first()
        
        if not user:
            print(f"Creating debug user: {DEBUG_USER_ID}")
            password_hash = hash_password(DEBUG_PASSWORD)
            user = User(
                id=DEBUG_USER_ID,
                email=DEBUG_USER_EMAIL,
                username=DEBUG_USERNAME,
                password_hash=password_hash,
                credits=DEBUG_CREDITS,
                is_admin=True
            )
            db.add(user)
        else:
            print(f"Updating existing debug user: {DEBUG_USER_ID}")
            # Always update all properties to ensure they're correct
            password_hash = hash_password(DEBUG_PASSWORD)
            user.username = DEBUG_USERNAME
            user.email = DEBUG_USER_EMAIL
            user.password_hash = password_hash
            user.credits = DEBUG_CREDITS
            user.is_admin = True
        
        db.commit()
        # Use direct SQL update to ensure persistence
        password_hash_sql = hash_password(DEBUG_PASSWORD)
        db.execute(
            text("UPDATE users SET username = :username, email = :email, password_hash = :password_hash, credits = :credits, is_admin = :is_admin WHERE id = :id"),
            {
                "id": DEBUG_USER_ID,
                "username": DEBUG_USERNAME,
                "email": DEBUG_USER_EMAIL,
                "password_hash": password_hash_sql,
                "credits": DEBUG_CREDITS,
                "is_admin": True
            }
        )
        db.commit()
        db.refresh(user)
        # Verify the update persisted by querying fresh from database
        db.expire_all()  # Expire all objects to force fresh query
        verified_user = db.query(User).filter(User.id == DEBUG_USER_ID).first()
        
        print(f"✅ Debug user configured:")
        print(f"   ID: {user.id}")
        print(f"   Username: {user.username}")
        print(f"   Email: {user.email}")
        print(f"   Credits: {user.credits}")
        print(f"   Password: {DEBUG_PASSWORD}")
        
        # Check for creations without user_id or with invalid user_id
        # SQLAlchemy uses is_(None) for None comparison
        from sqlalchemy import or_
        orphan_creations = db.query(Creation).filter(
            or_(Creation.user_id.is_(None), Creation.user_id != DEBUG_USER_ID)
        ).all()
        
        if orphan_creations:
            print(f"\n📦 Found {len(orphan_creations)} creations to migrate...")
            for creation in orphan_creations:
                print(f"   Migrating creation {creation.id} (user_id: {creation.user_id}) -> {DEBUG_USER_ID}")
                creation.user_id = DEBUG_USER_ID
            db.commit()
            print(f"✅ Migrated {len(orphan_creations)} creations to debug user")
        else:
            print("\n✅ No orphan creations found - all creations already belong to debug user")
        
        # Verify all creations belong to debug user
        all_creations = db.query(Creation).all()
        debug_creations = db.query(Creation).filter(Creation.user_id == DEBUG_USER_ID).all()
        
        print(f"\n📊 Verification:")
        print(f"   Total creations: {len(all_creations)}")
        print(f"   Debug user creations: {len(debug_creations)}")
        
        if len(all_creations) == len(debug_creations):
            print("✅ All creations belong to debug user")
        else:
            print(f"⚠️  Warning: {len(all_creations) - len(debug_creations)} creations don't belong to debug user")
        
        print("\n✅ Migration completed successfully!")
        
    except Exception as e:
        db.rollback()
        print(f"❌ Migration failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    migrate_debug_user()

