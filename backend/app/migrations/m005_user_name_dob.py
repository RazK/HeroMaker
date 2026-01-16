"""Migration: Add name and date_of_birth columns to users table."""
from sqlalchemy import text, inspect
from sqlalchemy.orm import Session
from app.migrations.runner import logger


def migrate(db: Session):
    """Add name and date_of_birth columns to users table."""

    # Check existing columns
    inspector = inspect(db.bind)
    columns = [col['name'] for col in inspector.get_columns('users')]

    # Add name column
    if 'name' not in columns:
        db.execute(text("ALTER TABLE users ADD COLUMN name VARCHAR"))
        logger.info("Added name column to users table")

    # Add date_of_birth column
    if 'date_of_birth' not in columns:
        db.execute(text("ALTER TABLE users ADD COLUMN date_of_birth DATE"))
        logger.info("Added date_of_birth column to users table")

    db.commit()
