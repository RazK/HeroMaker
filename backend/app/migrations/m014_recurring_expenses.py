"""Migration: create recurring_expenses, the admin console's monthly bills.

On a normal start `Base.metadata.create_all` in app/main.py has already made
this table from the model, so this is usually a no-op. It is here so the table
is created the same explicit, dialect-aware way as m010, whatever happens at
startup. Idempotent: it only creates what is missing.
"""
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.config.settings import DATABASE_URL
from app.migrations.runner import logger


def migrate(db: Session):
    is_postgres = DATABASE_URL.startswith("postgresql")
    id_type = "VARCHAR(36)" if is_postgres else "TEXT"
    # A Postgres INTEGER of micros tops out at $2,147; BIGINT keeps any bill exact.
    money_type = "BIGINT" if is_postgres else "INTEGER"
    true_value = "TRUE" if is_postgres else "1"

    if "recurring_expenses" not in inspect(db.bind).get_table_names():
        db.execute(text(f"""
            CREATE TABLE recurring_expenses (
                id {id_type} PRIMARY KEY,
                name VARCHAR(200) NOT NULL,
                amount_usd_micros {money_type} NOT NULL,
                started_on DATE NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT {true_value},
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """))
        logger.info("Created recurring_expenses table")
    db.commit()
