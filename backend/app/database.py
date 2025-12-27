import os
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.config.settings import DATABASE_URL

# Ensure database directory exists (for Railway volume setup)
if "sqlite" in DATABASE_URL:
    # Extract path from sqlite:///path/to/db.db
    db_path = DATABASE_URL.replace("sqlite:///", "").replace("sqlite:////", "/")
    # Handle absolute paths (starting with /)
    if db_path.startswith("/"):
        db_dir = Path(db_path).parent
        db_dir.mkdir(parents=True, exist_ok=True)

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

