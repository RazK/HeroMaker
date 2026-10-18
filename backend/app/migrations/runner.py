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


LOCK_TIMEOUT = "2s"
LOCK_ATTEMPTS = 30


def run_ddl(db: Session, sql: str) -> None:
    """Run one DDL statement in its own short transaction, retrying on lock waits.

    During a deploy the previous backend keeps serving, and any of its open
    transactions holds a lock on the tables it read. ALTER TABLE then waits for
    that lock - silently, for as long as it takes - and every query behind it
    queues too, while Railway's health check gives up on the new container.
    That is how 015_classes hung staging on its second statement.

    So each statement waits at most LOCK_TIMEOUT for its lock, gives the old
    backend's transaction a moment to finish, and tries again; it holds the lock
    only for its own statement, never across the whole migration.
    """
    if db.get_bind().dialect.name != "postgresql":
        db.execute(text(sql))
        db.commit()
        return

    from sqlalchemy.exc import OperationalError
    for attempt in range(1, LOCK_ATTEMPTS + 1):
        try:
            db.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
            db.execute(text(sql))
            db.commit()
            return
        except OperationalError as e:
            db.rollback()
            if getattr(e.orig, "pgcode", None) != "55P03":
                raise
            if attempt in (1, LOCK_ATTEMPTS):
                _log_open_transactions(db)
            if attempt == LOCK_ATTEMPTS:
                raise
            logger.warning(
                f"Lock busy (attempt {attempt}/{LOCK_ATTEMPTS}), retrying: {sql.split('(')[0].strip()[:80]}"
            )


def _log_open_transactions(db: Session) -> None:
    """Name the transactions that could be holding the lock, so a failed deploy says who."""
    try:
        rows = db.execute(text("""
            SELECT pid, state, now() - xact_start AS age, left(query, 120)
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> pg_backend_pid()
              AND xact_start IS NOT NULL
            ORDER BY xact_start
            LIMIT 10
        """)).all()
        db.rollback()
        for pid, state, age, query in rows:
            logger.warning(f"Open transaction: pid={pid} state={state} age={age} query={query!r}")
    except Exception as e:
        db.rollback()
        logger.warning(f"Could not list open transactions: {e}")


def run_all_migrations(migrations: List[tuple[str, Callable[[Session], None]]]):
    """
    Run all migrations in order.
    
    Args:
        migrations: List of (migration_name, migration_function) tuples

    A failed migration raises. The models already describe the new schema, so
    a backend that starts without it fails every query touching the missing
    column - and passes /health, so Railway would swap it in. Failing here
    keeps the previous deploy serving instead.
    """
    db = SessionLocal()
    try:
        ensure_migrations_table(db)

        for name, migration_func in migrations:
            run_migration(db, name, migration_func)

    finally:
        db.close()

