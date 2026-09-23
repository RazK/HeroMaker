"""
The code must work on SQLite (local) and Postgres (Railway).

Production is Postgres and this session has no credentials for it, so the
differences that bite cannot be found by running against the real thing. They
are therefore checked structurally: compile the schema for BOTH dialects and
assert the four things that actually differ.

  1. JSON vs JSONB      - JSONB does not exist on SQLite.
  2. SELECT ... FOR UPDATE - a no-op on SQLite, so it must not be what carries
                             the overdraft guarantee (and must not be emitted
                             against SQLite at all).
  3. datetime defaults  - Python-side `datetime.utcnow`, not a server default
                          whose spelling differs per dialect.
  4. autoincrement      - no integer autoincrement primary keys anywhere; the
                          app uses UUID strings, which behave identically on
                          both.
"""
import re
from datetime import datetime

from sqlalchemy import Integer, String
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.schema import CreateTable

from app.database import Base
from app.models import CreditTransaction, Payment, UsageEvent

FINANCIAL_TABLES = ["credit_transactions", "usage_events", "payments"]


def _ddl(table_name: str, dialect) -> str:
    return str(CreateTable(Base.metadata.tables[table_name]).compile(dialect=dialect))


# ---------------------------------------------------------------------------
# 1. JSON vs JSONB
# ---------------------------------------------------------------------------

def test_metadata_columns_are_jsonb_on_postgres_and_json_on_sqlite():
    for table in FINANCIAL_TABLES:
        pg = _ddl(table, postgresql.dialect())
        lite = _ddl(table, sqlite.dialect())
        assert "JSONB" in pg, f"{table} should use JSONB on Postgres:\n{pg}"
        assert "JSONB" not in lite, f"{table} must not use JSONB on SQLite:\n{lite}"
        assert "JSON" in lite, f"{table} should use JSON on SQLite:\n{lite}"


def test_the_migration_emits_the_right_json_type_per_dialect():
    """The hand-rolled DDL in m008 must agree with the ORM's choice."""
    from pathlib import Path
    src = Path(__file__).resolve().parent.parent / "app" / "migrations" / "m008_financial_spine.py"
    text = src.read_text()
    assert 'json_type = "JSONB" if is_postgres else "JSON"' in text
    assert "metadata {json_type}" in text


# ---------------------------------------------------------------------------
# 2. FOR UPDATE
# ---------------------------------------------------------------------------

def test_for_update_is_only_issued_against_postgres():
    """
    `SELECT ... FOR UPDATE` is silently ignored by SQLite. Emitting it there
    would give a false sense of safety, so the ledger gates it on the dialect.
    """
    from pathlib import Path
    src = (Path(__file__).resolve().parent.parent / "app" / "services" / "ledger.py").read_text()
    for_update_lines = [l for l in src.splitlines() if "FOR UPDATE" in l and not l.strip().startswith(("#", "*"))]
    assert for_update_lines, "the Postgres row lock has disappeared"
    assert "if _is_postgres(db):" in src

    # The guarantee must NOT rest on the lock: the conditional UPDATE is what
    # enforces it, and it runs on every dialect.
    assert "AND COALESCE(credits, 0) + :delta >= 0" in src


def test_the_overdraft_guard_is_a_single_conditional_statement(make_user, db):
    """
    Behavioural counterpart to the source check above: on SQLite, where no row
    lock exists at all, a debit larger than the balance must still be refused
    atomically with no partial write.
    """
    from app.services import ledger

    user = make_user(credits=5)
    assert db.bind.dialect.name == "sqlite"  # this suite runs on SQLite
    try:
        ledger.spend_credits(user.id, 6, db)
        raise AssertionError("overdraft was allowed")
    except ledger.InsufficientCreditsError:
        pass
    assert ledger.get_balance(user.id, db) == 5
    assert ledger.get_ledger_balance(user.id, db) == 5


# ---------------------------------------------------------------------------
# 3. datetime defaults
# ---------------------------------------------------------------------------

def test_timestamps_default_in_python_not_in_the_database():
    """
    `CURRENT_TIMESTAMP` differs in type and timezone handling between SQLite and
    Postgres. Defaulting in Python gives one naive UTC value on both, which is
    what every query in app/services/reporting.py assumes.
    """
    for model in (CreditTransaction, UsageEvent, Payment):
        column = model.__table__.c.created_at
        assert column.default is not None, f"{model.__name__}.created_at has no default"
        # SQLAlchemy wraps the callable, so compare by identity of the target.
        assert getattr(column.default.arg, "__name__", None) == "utcnow"
        assert column.server_default is None, (
            f"{model.__name__}.created_at uses a server default, which differs "
            "between SQLite and Postgres"
        )


def test_no_server_defaults_anywhere_in_the_financial_tables():
    for table in FINANCIAL_TABLES:
        for column in Base.metadata.tables[table].columns:
            assert column.server_default is None, f"{table}.{column.name}"


# ---------------------------------------------------------------------------
# 4. autoincrement
# ---------------------------------------------------------------------------

def test_primary_keys_are_uuid_strings_not_autoincrement_integers():
    """
    SQLite's AUTOINCREMENT and Postgres' SERIAL/IDENTITY behave differently and
    do not survive a copy between the two. UUID strings do.
    """
    for table in FINANCIAL_TABLES:
        (pk,) = list(Base.metadata.tables[table].primary_key.columns)
        assert isinstance(pk.type, String), f"{table}.{pk.name} is {pk.type}"
        assert not isinstance(pk.type, Integer)
        assert pk.default is not None, f"{table}.{pk.name} has no id generator"


def test_money_columns_are_integers_everywhere():
    """
    No floats and no Decimals in the database. Checked at the schema level, for
    both dialects, because a NUMERIC that round-trips through a float is how a
    ledger quietly loses a cent.
    """
    money = re.compile(r"(usd_micros|balance_after|delta|credits|units)$")
    for table in FINANCIAL_TABLES:
        for column in Base.metadata.tables[table].columns:
            if money.search(column.name):
                assert isinstance(column.type, Integer), \
                    f"{table}.{column.name} is {column.type}, must be Integer"
    for dialect in (postgresql.dialect(), sqlite.dialect()):
        for table in FINANCIAL_TABLES:
            ddl = _ddl(table, dialect)
            for bad in ("FLOAT", "REAL", "DOUBLE", "NUMERIC", "DECIMAL"):
                assert bad not in ddl.upper(), f"{table} uses {bad} on {dialect.name}"


# ---------------------------------------------------------------------------
# The schema compiles for both dialects at all
# ---------------------------------------------------------------------------

def test_every_table_compiles_for_both_dialects():
    for table in Base.metadata.tables:
        for dialect in (postgresql.dialect(), sqlite.dialect()):
            ddl = _ddl(table, dialect)
            assert ddl.strip().upper().startswith("CREATE TABLE")


def test_unique_constraints_survive_to_both_dialects():
    """The replay defences. If either disappears, webhooks double-credit."""
    for dialect in (postgresql.dialect(), sqlite.dialect()):
        ct = _ddl("credit_transactions", dialect).upper()
        assert "EXTERNAL_REF" in ct and "UNIQUE" in ct
        pay = _ddl("payments", dialect).upper()
        assert "PROVIDER_REF" in pay and "UNIQUE" in pay
