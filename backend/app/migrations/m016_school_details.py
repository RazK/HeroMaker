"""Migration: a teacher's school, and a class's age range.

Adds:
  users.school_name, users.school_city, users.school_country, users.school_type
  classes.ages

Asked once, on one screen, before a teacher's first class; shown in the admin
console's Schools list. See app/services/classes.py (set_school).

Columns only: `Base.metadata.create_all` never adds a column to a table that
already exists. Idempotent, and each statement goes through run_ddl, which
commits it on its own and retries while the backend being replaced still holds
a lock on the table (the m015 pattern).
"""
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.migrations.runner import logger, run_ddl


def _add_column(db: Session, table: str, column: str, ddl: str) -> None:
    columns = {c["name"] for c in inspect(db.bind).get_columns(table)}
    if column not in columns:
        run_ddl(db, f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
        logger.info("Added %s.%s", table, column)


def migrate(db: Session):
    _add_column(db, "users", "school_name", "VARCHAR(80)")
    _add_column(db, "users", "school_city", "VARCHAR(60)")
    _add_column(db, "users", "school_country", "VARCHAR(60)")
    _add_column(db, "users", "school_type", "VARCHAR(20)")
    _add_column(db, "classes", "ages", "VARCHAR(8)")
