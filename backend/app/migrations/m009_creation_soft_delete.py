"""Migration: add creations.deleted_at, so a hero can be deleted without
breaking the financial record that points at it.

Deleting a hero used to DELETE the row, which Postgres refused for any hero
that had ever spent a credit: credit_transactions.creation_id (and
usage_events.creation_id) reference it. The endpoint answered 500 - after it
had already removed the hero's files, leaving a picture-less hero in the
gallery. Nulling those references instead would make the margin report
("the cost of a hero is the SUM of the rows carrying its creation_id") lose
paid heroes, so the row stays and is marked deleted.

Idempotent, like the others: it only adds the column if it is missing.
"""
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session


def migrate(db: Session):
    columns = {c["name"] for c in inspect(db.bind).get_columns("creations")}
    if "deleted_at" not in columns:
        db.execute(text("ALTER TABLE creations ADD COLUMN deleted_at TIMESTAMP"))
        db.execute(text("CREATE INDEX IF NOT EXISTS ix_creations_deleted_at ON creations (deleted_at)"))
        db.commit()
