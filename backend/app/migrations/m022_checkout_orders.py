"""Migration: checkout_orders, the checkouts we opened (app/models.py CheckoutOrder).

Written when a checkout is opened through a provider that does not carry the
order's facts back to us (grow_sandbox now, Grow next). The callback names the
row; what was bought and what it must cost are read from here.

On a normal start `Base.metadata.create_all` in app/main.py has already made
the table from the model, so this is usually a no-op; it is here so the table
and its indexes are created the same explicit, dialect-aware way on a database
that predates it. Idempotent, each statement through run_ddl (the m020
pattern).
"""
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.migrations.runner import logger, run_ddl


def migrate(db: Session):
    is_postgres = db.get_bind().dialect.name == "postgresql"
    json_type = "JSONB" if is_postgres else "JSON"

    if "checkout_orders" not in set(inspect(db.bind).get_table_names()):
        run_ddl(db, f"""
            CREATE TABLE checkout_orders (
                id VARCHAR PRIMARY KEY,
                provider VARCHAR(20) NOT NULL,
                user_id VARCHAR NOT NULL,
                kind VARCHAR(20) NOT NULL,
                product VARCHAR(40) NOT NULL,
                class_id VARCHAR,
                seats INTEGER,
                credits INTEGER NOT NULL,
                amount_minor INTEGER NOT NULL,
                currency VARCHAR(3) NOT NULL,
                status VARCHAR(10) NOT NULL DEFAULT 'pending',
                transaction_id VARCHAR UNIQUE,
                redirect_url TEXT,
                metadata {json_type},
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        logger.info("Created checkout_orders table")

    for column in ("provider", "user_id", "class_id", "status", "created_at"):
        run_ddl(db, f"CREATE INDEX IF NOT EXISTS ix_checkout_orders_{column} ON checkout_orders ({column})")
