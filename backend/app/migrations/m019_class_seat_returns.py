"""Migration: a failed class hero gives its seat back.

Adds:
  class_guests.seat_returned_at

Set when a student's hero failed (not cancelled) and its seat went back to the
class, so the next child can use it (app/services/classes.py,
release_failed_seats). The guarded UPDATE on this column is what makes a seat
come back once per failed attempt, never twice. Rows from before have none:
a hero that had already failed is found by the next sweep and gives its seat
back then.

A column only: `Base.metadata.create_all` never adds a column to a table that
already exists. Idempotent, through run_ddl (the m015/m016 pattern).
"""
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.migrations.runner import logger, run_ddl


def migrate(db: Session):
    columns = {c["name"] for c in inspect(db.bind).get_columns("class_guests")}
    if "seat_returned_at" not in columns:
        run_ddl(db, "ALTER TABLE class_guests ADD COLUMN seat_returned_at TIMESTAMP")
        logger.info("Added class_guests.seat_returned_at")
