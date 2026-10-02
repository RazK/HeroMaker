"""Migration: create password_reset_tokens, for "Forgot password?".

On a normal start `Base.metadata.create_all` in app/main.py has already made
this table from the model, so this is usually a no-op. It is here so the table
is created the same explicit, dialect-aware way as the financial tables in
m008, whatever happens at startup. Idempotent: it only creates what is missing.

Only the sha256 of a reset token is stored (token_hash), never the token. See
app/services/password_reset.py.
"""
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.config.settings import DATABASE_URL
from app.migrations.runner import logger


def migrate(db: Session):
    is_postgres = DATABASE_URL.startswith("postgresql")
    id_type = "VARCHAR(36)" if is_postgres else "TEXT"

    if "password_reset_tokens" not in inspect(db.bind).get_table_names():
        db.execute(text(f"""
            CREATE TABLE password_reset_tokens (
                id {id_type} PRIMARY KEY,
                user_id {id_type} NOT NULL REFERENCES users(id),
                token_hash VARCHAR(64) NOT NULL UNIQUE,
                expires_at TIMESTAMP NOT NULL,
                used_at TIMESTAMP,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """))
        logger.info("Created password_reset_tokens table")

    db.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_password_reset_tokens_user_id "
        "ON password_reset_tokens (user_id)"
    ))
    db.commit()
