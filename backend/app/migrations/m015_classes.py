"""Migration: classes - teachers, prepaid classes, live sessions, student passes.

Adds:
  users.is_teacher, users.kind           (columns on an existing table)
  creations.class_id                     (column on an existing table)
  classes, class_sessions, class_guests  (new tables)

See docs/product/class-sessions.md and app/services/classes.py.

On a normal start `Base.metadata.create_all` in app/main.py has already made
the new tables from the models, so creating them here is usually a no-op. The
COLUMNS are not: create_all never adds a column to a table that already exists.
Idempotent: it only creates what is missing. Each statement goes through
run_ddl, which commits it on its own and retries while the backend being
replaced still holds a lock on the table.
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
    is_postgres = db.get_bind().dialect.name == "postgresql"
    id_type = "VARCHAR(36)" if is_postgres else "TEXT"
    false_value = "FALSE" if is_postgres else "0"

    _add_column(db, "users", "is_teacher", f"BOOLEAN NOT NULL DEFAULT {false_value}")
    _add_column(db, "users", "kind", "VARCHAR(20) NOT NULL DEFAULT 'person'")

    tables = set(inspect(db.bind).get_table_names())
    if "classes" not in tables:
        run_ddl(db, f"""
            CREATE TABLE classes (
                id {id_type} PRIMARY KEY,
                owner_id {id_type} NOT NULL REFERENCES users(id),
                wallet_user_id {id_type} NOT NULL UNIQUE REFERENCES users(id),
                title VARCHAR(60) NOT NULL,
                seats INTEGER NOT NULL DEFAULT 0,
                seats_used INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        logger.info("Created classes table")

    if "class_sessions" not in tables:
        run_ddl(db, f"""
            CREATE TABLE class_sessions (
                id {id_type} PRIMARY KEY,
                class_id {id_type} NOT NULL REFERENCES classes(id),
                pin VARCHAR(6) NOT NULL,
                starts_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                ends_at TIMESTAMP NOT NULL,
                approve_first BOOLEAN NOT NULL DEFAULT {false_value},
                status VARCHAR(16) NOT NULL DEFAULT 'open',
                ended_at TIMESTAMP,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        logger.info("Created class_sessions table")

    if "class_guests" not in tables:
        run_ddl(db, f"""
            CREATE TABLE class_guests (
                id {id_type} PRIMARY KEY,
                class_id {id_type} NOT NULL REFERENCES classes(id),
                session_id {id_type} NOT NULL REFERENCES class_sessions(id),
                first_name VARCHAR(20) NOT NULL,
                age INTEGER,
                token_hash VARCHAR(64) NOT NULL UNIQUE,
                device_hash VARCHAR(64),
                shared_device BOOLEAN NOT NULL DEFAULT {false_value},
                status VARCHAR(16) NOT NULL DEFAULT 'approved',
                hero_started_at TIMESTAMP,
                creation_id {id_type} REFERENCES creations(id),
                claim_hash VARCHAR(64) UNIQUE,
                claimed_by {id_type} REFERENCES users(id),
                claimed_at TIMESTAMP,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        logger.info("Created class_guests table")

    _add_column(db, "creations", "class_id", f"{id_type} REFERENCES classes(id)")

    for index, table, column in (
        ("ix_users_kind", "users", "kind"),
        ("ix_classes_owner_id", "classes", "owner_id"),
        ("ix_class_sessions_class_id", "class_sessions", "class_id"),
        ("ix_class_sessions_pin", "class_sessions", "pin"),
        ("ix_class_sessions_ends_at", "class_sessions", "ends_at"),
        ("ix_class_guests_class_id", "class_guests", "class_id"),
        ("ix_class_guests_session_id", "class_guests", "session_id"),
        ("ix_class_guests_device_hash", "class_guests", "device_hash"),
        ("ix_class_guests_creation_id", "class_guests", "creation_id"),
        ("ix_class_guests_claimed_by", "class_guests", "claimed_by"),
        ("ix_creations_class_id", "creations", "class_id"),
    ):
        run_ddl(db, f"CREATE INDEX IF NOT EXISTS {index} ON {table} ({column})")
