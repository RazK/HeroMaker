import os
from pathlib import Path
from sqlalchemy import create_engine
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

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

