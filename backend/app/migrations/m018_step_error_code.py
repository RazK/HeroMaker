"""Migration: what a failed step tells its user.

Adds:
  creation_steps.error_code

One of app/services/step_errors.CODES ("safety_blocked", "provider_busy", ...).
The user is shown a line chosen by it; the raw provider text stays in
error_message, for admins only. Rows failed before this have no code and are
classified from their raw text when read, so nothing is backfilled.

A column only: `Base.metadata.create_all` never adds a column to a table that
already exists. Idempotent, through run_ddl (the m015/m016 pattern).
"""
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.migrations.runner import logger, run_ddl


def migrate(db: Session):
    columns = {c["name"] for c in inspect(db.bind).get_columns("creation_steps")}
    if "error_code" not in columns:
        run_ddl(db, "ALTER TABLE creation_steps ADD COLUMN error_code VARCHAR(40)")
        logger.info("Added creation_steps.error_code")
