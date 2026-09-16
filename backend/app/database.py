import logging
import os
from pathlib import Path
from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.config.settings import DATABASE_URL

# Ensure database directory exists (for Railway volume setup)
if "sqlite" in DATABASE_URL:
    # Extract path from sqlite:///path/to/db.db
    # sqlite:///Users/path -> Users/path (needs leading /)
    # sqlite:////Users/path -> /Users/path (already has /)
    if DATABASE_URL.startswith("sqlite:////"):
        # sqlite://// is 11 characters, so [10:] preserves the leading / of the absolute path
        db_path = DATABASE_URL[10:]  # Remove "sqlite:////" (11 chars) -> "/Users/..."
    else:
        db_path = DATABASE_URL.replace("sqlite:///", "")
        if not db_path.startswith("/") and "/" in db_path:
            db_path = "/" + db_path  # Add leading / for absolute paths
    
    # Handle absolute paths (starting with /)
    if db_path.startswith("/"):
        db_dir = Path(db_path).parent
        db_dir.mkdir(parents=True, exist_ok=True)
        # Fix DATABASE_URL to use 4 slashes for absolute paths (SQLAlchemy requirement)
        DATABASE_URL = f"sqlite:///{db_path}"  # 4 slashes: sqlite:////absolute/path

engine = create_engine(
    DATABASE_URL, connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

_logger = logging.getLogger(__name__)

if engine.dialect.name == "sqlite":
    @event.listens_for(engine, "connect")
    def _sqlite_connection_pragmas(dbapi_connection, connection_record):
        """
        Make SQLite survive concurrent writers.

        The credit ledger (app/services/ledger.py) performs conditional UPDATEs
        that several requests can attempt at once. SQLite serialises writers,
        but by default a writer that loses the race fails INSTANTLY with
        "database is locked" rather than waiting.

        - busy_timeout: wait up to 10s for a lock instead of failing at once.
        - WAL: readers no longer block the writer, which removes most of the
          contention in the first place.

        Neither changes any query's semantics; both are no-ops on Postgres,
        which is what production runs. Failures here are logged and ignored -
        a filesystem that cannot do WAL (some network mounts) must not stop the
        app from starting.
        """
        try:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA busy_timeout = 10000")
            cursor.execute("PRAGMA journal_mode = WAL")
            cursor.close()
        except Exception as exc:  # pragma: no cover - environment dependent
            _logger.warning("Could not apply SQLite pragmas: %s", exc)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

