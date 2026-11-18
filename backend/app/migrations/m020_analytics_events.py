"""Migration: analytics_events, what visitors did (docs/analytics/REQUIREMENTS.md).

One row per event: a visit, a hero opened, a photo taken, a purchase, a hero
ready. No personal data in any column (app/services/analytics.py holds the
allow-list). Each environment has its own table in its own database, like
everything else: staging's events never reach production's.

On a normal start `Base.metadata.create_all` in app/main.py has already made
the table from the model, so this is usually a no-op; it is here so the table
and its indexes are created the same explicit, dialect-aware way on a database
that predates it. Idempotent, each statement through run_ddl (the m015/m017
pattern).
"""
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.migrations.runner import logger, run_ddl


def migrate(db: Session):
    is_postgres = db.get_bind().dialect.name == "postgresql"
    id_type = "SERIAL PRIMARY KEY" if is_postgres else "INTEGER PRIMARY KEY AUTOINCREMENT"
    json_type = "JSONB" if is_postgres else "JSON"
    false_value = "FALSE" if is_postgres else "0"

    if "analytics_events" not in set(inspect(db.bind).get_table_names()):
        run_ddl(db, f"""
            CREATE TABLE analytics_events (
                id {id_type},
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                name VARCHAR(40) NOT NULL,
                visitor_id VARCHAR(64),
                user_id VARCHAR,
                door VARCHAR(40),
                device VARCHAR(10),
                is_robot BOOLEAN NOT NULL DEFAULT {false_value},
                source VARCHAR(10) NOT NULL DEFAULT 'browser',
                props {json_type} NOT NULL DEFAULT '{{}}',
                ref VARCHAR(80)
            )
        """)
        logger.info("Created analytics_events table")

    for column in ("created_at", "name", "visitor_id", "user_id", "door", "is_robot", "ref"):
        run_ddl(db, f"CREATE INDEX IF NOT EXISTS ix_analytics_events_{column} ON analytics_events ({column})")
