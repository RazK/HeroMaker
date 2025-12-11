"""Initial schema creation: users and creations tables."""

from typing import Optional

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "001_initial_schema"
down_revision: Optional[str] = None
branch_labels = None
depends_on = None


def _uuid_column(name: str, *, primary_key: bool = False, nullable: bool = True, server_default=None):
    """Helper to create UUID columns with cross-dialect compatibility."""
    uuid_type = sa.types.UUID(as_uuid=True) if hasattr(sa.types, "UUID") else sa.String(length=36)
    return sa.Column(name, uuid_type, primary_key=primary_key, nullable=nullable, server_default=server_default)


def _jsonb_column(name: str):
    json_type = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")
    return sa.Column(name, json_type, nullable=True)


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    uuid_default = sa.text("gen_random_uuid()") if is_postgres else None

    op.create_table(
        "users",
        _uuid_column("id", primary_key=True, nullable=False, server_default=uuid_default),
        sa.Column("email", sa.String(length=255), unique=True, nullable=True),
        sa.Column("google_id", sa.String(length=255), unique=True, nullable=True),
        sa.Column("username", sa.String(length=255), nullable=True),
        sa.Column("password_hash", sa.String(length=255), nullable=True),
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("subscription_tier", sa.String(length=50), nullable=False, server_default="free"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            server_onupdate=sa.func.now(),
        ),
    )

    op.create_table(
        "creations",
        _uuid_column("id", primary_key=True, nullable=False, server_default=uuid_default),
        sa.Column("character_name", sa.String(length=255), nullable=True),
        _uuid_column("user_id", nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="pending"),
        sa.Column("current_task", sa.String(length=100), nullable=True),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            server_onupdate=sa.func.now(),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        _jsonb_column("metadata"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_creations_user_id", ondelete="SET NULL"),
    )

    op.create_index("idx_users_email", "users", ["email"], unique=False)
    op.create_index("idx_users_google_id", "users", ["google_id"], unique=False)

    op.create_index("idx_creations_status", "creations", ["status"], unique=False)
    op.create_index("idx_creations_user_id", "creations", ["user_id"], unique=False)

    status_completed = sa.text("status = 'completed'")
    op.create_index(
        "idx_creations_public_completed",
        "creations",
        ["is_public", "status"],
        unique=False,
        postgresql_where=status_completed,
        sqlite_where=status_completed,
    )

    op.create_index(
        "idx_creations_created_at",
        "creations",
        [sa.text("created_at DESC")],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_creations_created_at", table_name="creations")
    op.drop_index("idx_creations_public_completed", table_name="creations")
    op.drop_index("idx_creations_user_id", table_name="creations")
    op.drop_index("idx_creations_status", table_name="creations")
    op.drop_table("creations")

    op.drop_index("idx_users_google_id", table_name="users")
    op.drop_index("idx_users_email", table_name="users")
    op.drop_table("users")
