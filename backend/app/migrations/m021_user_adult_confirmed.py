"""Migration: users.adult_confirmed_at, when a grown-up said they were there.

Before the sign-in sheet opens the first time in a browser, the app asks "Is a
grown-up with you?" (frontend/src/components/tb/GrownUpSheet.tsx). The time of
the "Yes" is kept with the account once it signs in (POST
/api/v1/me/adult-confirmed): the first one, never moved later.

A column only: `Base.metadata.create_all` never adds a column to a table that
already exists. Idempotent, through run_ddl (the m015/m016/m019 pattern).
"""
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.migrations.runner import logger, run_ddl


def migrate(db: Session):
    columns = {c["name"] for c in inspect(db.bind).get_columns("users")}
    if "adult_confirmed_at" not in columns:
        run_ddl(db, "ALTER TABLE users ADD COLUMN adult_confirmed_at TIMESTAMP")
        logger.info("Added users.adult_confirmed_at")
