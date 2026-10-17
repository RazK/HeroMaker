"""Migration: add users.deleted_at, so a person can delete their account.

The account's heroes, files and personal details are removed outright. The row
itself stays, emptied of anything that identifies the person, because
payments.user_id and credit_transactions.user_id are NOT NULL references to it
and those records are kept for tax. deleted_at marks it, and get_current_user
refuses a token for it. See app/services/account_deletion.py.

Idempotent, like the others: it only adds the column if it is missing.
"""
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session


def migrate(db: Session):
    columns = {c["name"] for c in inspect(db.bind).get_columns("users")}
    if "deleted_at" not in columns:
        db.execute(text("ALTER TABLE users ADD COLUMN deleted_at TIMESTAMP"))
        db.execute(text("CREATE INDEX IF NOT EXISTS ix_users_deleted_at ON users (deleted_at)"))
        db.commit()
