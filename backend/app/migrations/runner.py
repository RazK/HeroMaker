"""Generic migration runner for database migrations."""
import logging
from typing import List, Callable
from sqlalchemy import text, inspect
from sqlalchemy.orm import Session
from app.database import SessionLocal, engine

logger = logging.getLogger(__name__)


def ensure_migrations_table(db: Session):
    """Create migrations tracking table if it doesn't exist."""
    try:
        # Check if we're using PostgreSQL or SQLite
        from app.config.settings import DATABASE_URL
        is_postgres = DATABASE_URL.startswith("postgresql")
        
        if is_postgres:
            # PostgreSQL syntax
            db.execute(text("""
                CREATE TABLE IF NOT EXISTS migrations (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) UNIQUE NOT NULL,
                    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
        else:
            # SQLite syntax
            db.execute(text("""
                CREATE TABLE IF NOT EXISTS migrations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning(f"Could not create migrations table: {e}")


def is_migration_applied(db: Session, migration_name: str) -> bool:
    """Check if a migration has already been applied."""
    try:
        result = db.execute(
            text("SELECT COUNT(*) FROM migrations WHERE name = :name"),
            {"name": migration_name}
        )
        return result.scalar() > 0
    except Exception:
        return False


def mark_migration_applied(db: Session, migration_name: str):
    """Mark a migration as applied."""
    try:
        db.execute(
            text("INSERT INTO migrations (name) VALUES (:name)"),
            {"name": migration_name}
        )
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to mark migration {migration_name} as applied: {e}")


def run_migration(db: Session, name: str, migration_func: Callable[[Session], None]):
    """Run a single migration if it hasn't been applied yet."""
    if is_migration_applied(db, name):
        logger.debug(f"Migration '{name}' already applied, skipping")
        return
    
    try:
        logger.info(f"Running migration: {name}")
        migration_func(db)
        mark_migration_applied(db, name)
        logger.info(f"✅ Migration '{name}' completed successfully")
    except Exception as e:
        db.rollback()
        logger.error(f"❌ Migration '{name}' failed: {e}")
        raise


def run_all_migrations(migrations: List[tuple[str, Callable[[Session], None]]]):
    """
    Run all migrations in order.
    
    Args:
        migrations: List of (migration_name, migration_function) tuples
    """
    try:
        db = SessionLocal()
        try:
            ensure_migrations_table(db)
            
            for name, migration_func in migrations:
                run_migration(db, name, migration_func)
                
        finally:
            db.close()
    except Exception as e:
        # Don't fail startup if migrations fail (e.g., database not accessible)
        logger.warning(f"Migrations skipped: {e}")

