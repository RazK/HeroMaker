"""Migration: Add tokens column and username uniqueness constraint for multi-user auth."""
from sqlalchemy import text, inspect
from sqlalchemy.orm import Session


def migrate(db: Session):
    """Add tokens column to users table and ensure username uniqueness."""
    from app.config.settings import DATABASE_URL
    is_postgres = DATABASE_URL.startswith("postgresql")
    
    # Check if tokens column already exists
    inspector = inspect(db.bind)
    columns = [col['name'] for col in inspector.get_columns('users')]
    
    if 'tokens' not in columns:
        if is_postgres:
            db.execute(text("ALTER TABLE users ADD COLUMN tokens INTEGER DEFAULT 0"))
        else:
            db.execute(text("ALTER TABLE users ADD COLUMN tokens INTEGER DEFAULT 0"))
        from app.migrations.runner import logger
        logger.info("Added tokens column to users table")
    
    # Check if username unique constraint exists
    # For SQLite, we need to check indexes
    # For PostgreSQL, we check constraints
    if is_postgres:
        # Check for unique constraint on username
        result = db.execute(text("""
            SELECT COUNT(*) FROM pg_constraint 
            WHERE conrelid = 'users'::regclass 
            AND conname LIKE '%username%' 
            AND contype = 'u'
        """))
        if result.scalar() == 0:
            # Check if there are duplicate usernames first
            result = db.execute(text("""
                SELECT username, COUNT(*) as count 
                FROM users 
                WHERE username IS NOT NULL 
                GROUP BY username 
                HAVING COUNT(*) > 1
            """))
            duplicates = result.fetchall()
            if duplicates:
                from app.migrations.runner import logger
                logger.warning(f"Found duplicate usernames: {duplicates}. Please resolve before adding unique constraint.")
            else:
                db.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users(username)"))
                from app.migrations.runner import logger
                logger.info("Added unique constraint on username column")
    else:
        # SQLite: Check if unique index exists
        result = db.execute(text("""
            SELECT COUNT(*) FROM sqlite_master 
            WHERE type='index' 
            AND name='ix_users_username'
        """))
        if result.scalar() == 0:
            # Check for duplicate usernames
            result = db.execute(text("""
                SELECT username, COUNT(*) as count 
                FROM users 
                WHERE username IS NOT NULL 
                GROUP BY username 
                HAVING COUNT(*) > 1
            """))
            duplicates = result.fetchall()
            if duplicates:
                from app.migrations.runner import logger
                logger.warning(f"Found duplicate usernames: {duplicates}. Please resolve before adding unique constraint.")
            else:
                db.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users(username)"))
                from app.migrations.runner import logger
                logger.info("Added unique index on username column")
    
    db.commit()

