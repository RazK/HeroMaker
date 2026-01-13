"""Migration: Add tokens column and username uniqueness constraint for multi-user auth."""
from sqlalchemy import text, inspect
from sqlalchemy.orm import Session
from app.config.settings import DATABASE_URL
from app.migrations.runner import logger


def migrate(db: Session):
    """Add tokens column to users table and ensure username uniqueness."""
    is_postgres = DATABASE_URL.startswith("postgresql")

    # Check if tokens column already exists
    inspector = inspect(db.bind)
    columns = [col['name'] for col in inspector.get_columns('users')]

    if 'tokens' not in columns:
        db.execute(text("ALTER TABLE users ADD COLUMN tokens INTEGER DEFAULT 0"))
        logger.info("Added tokens column to users table")

    # Check if username unique constraint exists
    if is_postgres:
        result = db.execute(text("""
            SELECT COUNT(*) FROM pg_constraint
            WHERE conrelid = 'users'::regclass
            AND conname LIKE '%username%'
            AND contype = 'u'
        """))
        if result.scalar() == 0:
            result = db.execute(text("""
                SELECT username, COUNT(*) as count
                FROM users
                WHERE username IS NOT NULL
                GROUP BY username
                HAVING COUNT(*) > 1
            """))
            duplicates = result.fetchall()
            if duplicates:
                logger.warning(f"Found duplicate usernames: {duplicates}. Please resolve before adding unique constraint.")
            else:
                db.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users(username)"))
                logger.info("Added unique constraint on username column")
    else:
        # SQLite
        result = db.execute(text("""
            SELECT COUNT(*) FROM sqlite_master
            WHERE type='index'
            AND name='ix_users_username'
        """))
        if result.scalar() == 0:
            result = db.execute(text("""
                SELECT username, COUNT(*) as count
                FROM users
                WHERE username IS NOT NULL
                GROUP BY username
                HAVING COUNT(*) > 1
            """))
            duplicates = result.fetchall()
            if duplicates:
                logger.warning(f"Found duplicate usernames: {duplicates}. Please resolve before adding unique constraint.")
            else:
                db.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users(username)"))
                logger.info("Added unique index on username column")

    db.commit()

