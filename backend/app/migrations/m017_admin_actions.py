"""Migration: admin_actions, the admin console's audit log.

One row per thing an admin did to an account or a hero: who, what, when and
why (remove or restore a hero, give or take back credits, ...). Shown on a
user's page in the admin console. See app/services/moderation.py.

On a normal start `Base.metadata.create_all` in app/main.py has already made
the table from the model, so this is usually a no-op; it is here so the table
and its indexes are created the same explicit, dialect-aware way on a database
that predates it. Idempotent, and each statement goes through run_ddl, which
commits it on its own and retries while the backend being replaced still holds
a lock (the m015/m016 pattern).

`creation_id` has no foreign key on purpose: deleting an account deletes its
heroes' rows, and the record of what an admin did to one must outlive it.
"""
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.migrations.runner import logger, run_ddl


def migrate(db: Session):
    is_postgres = db.get_bind().dialect.name == "postgresql"
    id_type = "VARCHAR(36)" if is_postgres else "TEXT"
    json_type = "JSONB" if is_postgres else "JSON"

    if "admin_actions" not in set(inspect(db.bind).get_table_names()):
        run_ddl(db, f"""
            CREATE TABLE admin_actions (
                id {id_type} PRIMARY KEY,
                admin_id {id_type} NOT NULL REFERENCES users(id),
                target_user_id {id_type} REFERENCES users(id),
                creation_id {id_type},
                action VARCHAR(32) NOT NULL,
                reason VARCHAR(32),
                note TEXT,
                amount INTEGER,
                details {json_type} NOT NULL DEFAULT '{{}}',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        logger.info("Created admin_actions table")

    for index, column in (
        ("ix_admin_actions_admin_id", "admin_id"),
        ("ix_admin_actions_target_user_id", "target_user_id"),
        ("ix_admin_actions_creation_id", "creation_id"),
        ("ix_admin_actions_created_at", "created_at"),
    ):
        run_ddl(db, f"CREATE INDEX IF NOT EXISTS {index} ON admin_actions ({column})")
