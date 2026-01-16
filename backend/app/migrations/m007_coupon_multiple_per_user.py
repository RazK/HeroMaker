"""Migration: Add allow_multiple_per_user flag to coupons table."""
from sqlalchemy import text, inspect
from sqlalchemy.orm import Session
from app.migrations.runner import logger


def migrate(db: Session):
    """Add allow_multiple_per_user column to coupons table."""
    # Check existing columns
    inspector = inspect(db.bind)
    columns = [col['name'] for col in inspector.get_columns('coupons')]

    # Add allow_multiple_per_user column (default=False)
    if 'allow_multiple_per_user' not in columns:
        if db.bind.url.drivername == 'sqlite':
            db.execute(text("ALTER TABLE coupons ADD COLUMN allow_multiple_per_user BOOLEAN DEFAULT 0"))
        else:
            # PostgreSQL
            db.execute(text("ALTER TABLE coupons ADD COLUMN allow_multiple_per_user BOOLEAN DEFAULT FALSE"))
        logger.info("Added allow_multiple_per_user column to coupons table")

    db.commit()
