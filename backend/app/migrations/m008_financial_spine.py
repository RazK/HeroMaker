"""Migration: Create credit_transactions, usage_events and payments tables,
and backfill every existing user.credits value as an opening-balance row.

NAMING NOTE
-----------
The brief asked for this to be `m006_*`. `m006_tokens_to_credits` and
`m007_coupon_multiple_per_user` already exist on this branch, so it lands as
`m008_*` to keep the runner's ordering honest. Nothing else about the style
changes - it follows m003-m005 exactly: idempotent, dialect-aware, one
`migrate(db)` entry point, registered in app/migrations/registry.py.

WHAT IT DOES
------------
1. Creates the three financial tables if they do not exist.
2. Creates the indexes the margin report actually reads on.
3. Backfills the ledger: every user whose `credits` is non-zero gets ONE
   `opening_balance` transaction for exactly that amount, so
   `SUM(credit_transactions.delta) == users.credits` holds from the first
   moment the ledger exists.

WHY "opening_balance" AND NOT "signup_grant"
--------------------------------------------
We do not know where a pre-ledger balance came from - coupon, admin gift,
purchase that never happened. Labelling it `signup_grant` would be inventing
history. `opening_balance` says exactly what is known: this much existed when
the ledger was created. Nothing is lost and nothing is fabricated.

Note also that the backfill writes NO row for a user with 0 credits: a ledger
row with delta=0 is noise, and their balance already agrees with an empty
ledger.
"""
import uuid
from datetime import datetime

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.config.settings import DATABASE_URL
from app.migrations.runner import logger


def migrate(db: Session):
    """Create the financial tables and backfill the credit ledger."""
    is_postgres = DATABASE_URL.startswith("postgresql")

    inspector = inspect(db.bind)
    existing_tables = inspector.get_table_names()

    # Postgres gets JSONB (binary, indexable); SQLite has no JSONB and stores
    # JSON as TEXT. app/models.py declares the same split via
    # JSON().with_variant(postgresql.JSONB, "postgresql"), so the ORM and these
    # DDL statements agree on both databases.
    json_type = "JSONB" if is_postgres else "JSON"
    id_type = "VARCHAR(36)" if is_postgres else "TEXT"
    str_type = "VARCHAR(255)" if is_postgres else "TEXT"

    # ---------------------------------------------------------------- ledger
    if "credit_transactions" not in existing_tables:
        db.execute(text(f"""
            CREATE TABLE credit_transactions (
                id {id_type} PRIMARY KEY,
                user_id {id_type} NOT NULL REFERENCES users(id),
                delta INTEGER NOT NULL,
                reason {str_type} NOT NULL,
                external_ref {str_type},
                creation_id {id_type} REFERENCES creations(id),
                balance_after INTEGER NOT NULL,
                metadata {json_type},
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """))
        logger.info("Created credit_transactions table")

    # UNIQUE on external_ref is what makes a replayed payment webhook a no-op.
    # Both SQLite and Postgres treat NULLs as distinct in a unique index, so
    # the many rows with no external ref (spends, opening balances) coexist
    # happily; only a repeated non-NULL ref is rejected.
    _create_index(db, "ux_credit_transactions_external_ref",
                  "credit_transactions", "(external_ref)", unique=True)
    _create_index(db, "ix_credit_transactions_user_id", "credit_transactions", "(user_id)")
    _create_index(db, "ix_credit_transactions_creation_id", "credit_transactions", "(creation_id)")
    _create_index(db, "ix_credit_transactions_reason", "credit_transactions", "(reason)")
    _create_index(db, "ix_credit_transactions_created_at", "credit_transactions", "(created_at)")

    # ----------------------------------------------------------- usage events
    if "usage_events" not in existing_tables:
        db.execute(text(f"""
            CREATE TABLE usage_events (
                id {id_type} PRIMARY KEY,
                user_id {id_type} REFERENCES users(id),
                creation_id {id_type} REFERENCES creations(id),
                step_name {str_type},
                provider {str_type} NOT NULL,
                operation {str_type} NOT NULL,
                units INTEGER NOT NULL DEFAULT 1,
                cost_usd_micros INTEGER NOT NULL DEFAULT 0,
                provider_ref {str_type},
                status {str_type} NOT NULL DEFAULT 'submitted',
                metadata {json_type},
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """))
        logger.info("Created usage_events table")

    _create_index(db, "ix_usage_events_user_id", "usage_events", "(user_id)")
    _create_index(db, "ix_usage_events_creation_id", "usage_events", "(creation_id)")
    _create_index(db, "ix_usage_events_created_at", "usage_events", "(created_at)")
    _create_index(db, "ix_usage_events_provider", "usage_events", "(provider)")
    _create_index(db, "ix_usage_events_provider_ref", "usage_events", "(provider_ref)")
    _create_index(db, "ix_usage_events_status", "usage_events", "(status)")
    _create_index(db, "ix_usage_events_step_name", "usage_events", "(step_name)")

    # --------------------------------------------------------------- payments
    if "payments" not in existing_tables:
        db.execute(text(f"""
            CREATE TABLE payments (
                id {id_type} PRIMARY KEY,
                user_id {id_type} NOT NULL REFERENCES users(id),
                provider {str_type} NOT NULL,
                provider_ref {str_type} NOT NULL UNIQUE,
                gross_usd_micros INTEGER NOT NULL DEFAULT 0,
                fee_usd_micros INTEGER NOT NULL DEFAULT 0,
                net_usd_micros INTEGER NOT NULL DEFAULT 0,
                status {str_type} NOT NULL DEFAULT 'pending',
                metadata {json_type},
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """))
        logger.info("Created payments table")

    _create_index(db, "ix_payments_user_id", "payments", "(user_id)")
    _create_index(db, "ix_payments_status", "payments", "(status)")
    _create_index(db, "ix_payments_created_at", "payments", "(created_at)")
    _create_index(db, "ix_payments_provider", "payments", "(provider)")

    db.commit()

    # -------------------------------------------------------------- backfill
    backfilled = _backfill_opening_balances(db)
    if backfilled:
        logger.info("Backfilled %d opening-balance ledger rows", backfilled)
    else:
        logger.info("No opening balances to backfill")

    db.commit()


def _create_index(db: Session, name: str, table: str, columns: str, unique: bool = False):
    """CREATE INDEX IF NOT EXISTS - supported by both SQLite and Postgres."""
    kind = "UNIQUE INDEX" if unique else "INDEX"
    try:
        db.execute(text(f"CREATE {kind} IF NOT EXISTS {name} ON {table} {columns}"))
    except Exception as exc:
        # An index that already exists under a different name (SQLAlchemy's
        # create_all may have made one) is not a reason to fail a migration.
        db.rollback()
        logger.warning("Could not create index %s on %s: %s", name, table, exc)


def _backfill_opening_balances(db: Session) -> int:
    """
    Turn every existing users.credits value into an opening-balance ledger row.

    Idempotent twice over: it skips any user who already has ANY ledger row
    (so re-running cannot double-count, and a user who has since transacted is
    left alone), and the migration runner itself only runs this once.
    """
    rows = db.execute(text("""
        SELECT u.id, COALESCE(u.credits, 0) AS credits
          FROM users u
         WHERE COALESCE(u.credits, 0) <> 0
           AND NOT EXISTS (
               SELECT 1 FROM credit_transactions ct WHERE ct.user_id = u.id
           )
    """)).fetchall()

    now = datetime.utcnow()
    inserted = 0
    for user_id, credits in rows:
        credits = int(credits or 0)
        db.execute(
            text("""
                INSERT INTO credit_transactions
                    (id, user_id, delta, reason, external_ref, creation_id,
                     balance_after, metadata, created_at)
                VALUES
                    (:id, :user_id, :delta, 'opening_balance', NULL, NULL,
                     :balance_after, :metadata, :created_at)
            """),
            {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "delta": credits,
                "balance_after": credits,
                # Stored as a JSON string: correct for SQLite's JSON (TEXT) and
                # accepted by Postgres' JSONB input parser.
                "metadata": '{"source": "m008_financial_spine backfill", '
                            '"note": "pre-ledger balance; true provenance unknown"}',
                "created_at": now,
            },
        )
        inserted += 1

    return inserted
