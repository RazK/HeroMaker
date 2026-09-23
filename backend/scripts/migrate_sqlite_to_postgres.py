#!/usr/bin/env python
"""
Copy a HeroMaker SQLite database into Postgres. Safely.

    # 1. always look first
    .venv/bin/python backend/scripts/inspect_db.py "$TARGET_URL"

    # 2. dry run (this is the DEFAULT - it writes nothing)
    .venv/bin/python backend/scripts/migrate_sqlite_to_postgres.py \
        --source "sqlite:////abs/path/heromaker.db" --target "$TARGET_URL"

    # 3. do it
    .venv/bin/python backend/scripts/migrate_sqlite_to_postgres.py \
        --source "sqlite:////abs/path/heromaker.db" --target "$TARGET_URL" --apply

SAFETY PROPERTIES
-----------------
* DRY RUN BY DEFAULT. Without --apply nothing is written, and the plan it prints
  is the plan it would execute.
* REFUSES A NON-EMPTY TARGET unless --force. Migrating on top of live data is
  occasionally right and never accidental.
* IDEMPOTENT. Every insert is `ON CONFLICT DO NOTHING` on the primary key, so a
  half-finished run can simply be run again. Rows already in the target are
  left exactly as they are - this script never overwrites.
* VERIFIES ROW COUNTS AFTERWARDS, per table, and exits non-zero if any table
  does not match. A migration you did not verify is a migration you did not do.
* The SOURCE IS OPENED READ-ONLY. It is never modified.

WHY IT USES THE APP'S OWN TABLE DEFINITIONS
-------------------------------------------
Rather than reflecting the SQLite schema, it drives both ends from
`app.models.Base.metadata`. SQLAlchemy then applies the right type handling on
each side automatically, which silently fixes the three things that make a
hand-rolled SQLite->Postgres copy go wrong:

  * JSON columns - TEXT in SQLite, JSONB in Postgres;
  * booleans     - 0/1 integers in SQLite, real booleans in Postgres;
  * datetimes    - strings in SQLite, timestamps in Postgres.

Columns present in the model but missing from an older SQLite file are skipped
per table, so an out-of-date source still migrates.
"""
import argparse
import os
import re
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import (  # noqa: E402
    Column, DateTime, Integer, MetaData, String, Table, create_engine, func, inspect, select, text,
)
from sqlalchemy.dialects.postgresql import insert as pg_insert  # noqa: E402

from app.database import Base  # noqa: E402
import app.models  # noqa: F401,E402  (registers every table on Base.metadata)

# Parent tables first: a foreign key must not point at a row that has not been
# copied yet.
TABLE_ORDER = [
    "users",
    "creations",
    "creation_steps",
    "coupons",
    "coupon_redemptions",
    "credit_transactions",
    "usage_events",
    "payments",
]

BATCH = 500

# The migration bookkeeping table is created by app/migrations/runner.py with
# raw SQL, so it is not on Base.metadata. Defined here so the target ends up
# knowing which migrations have already been applied - without it, the runner
# would replay every migration against already-migrated data.
_migrations_meta = MetaData()
MIGRATIONS_TABLE = Table(
    "migrations", _migrations_meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", String(255), unique=True, nullable=False),
    Column("applied_at", DateTime, server_default=func.current_timestamp()),
)


def mask(url: str) -> str:
    return re.sub(r"(://[^:/@]+):([^@]+)@", r"\1:***@", url)


def open_source(url: str):
    """Read-only handle on the SQLite file. It is never written to."""
    if not url.startswith("sqlite"):
        raise SystemExit(f"--source must be a SQLite URL, got {mask(url)}")
    path = url.split("sqlite:///", 1)[-1].lstrip("/")
    if not path:
        raise SystemExit("Refusing to migrate from an in-memory SQLite database")
    if not Path("/" + path).exists():
        raise SystemExit(f"Source database not found: /{path}")
    return create_engine(f"sqlite:///file:/{path}?mode=ro&uri=true")


def open_target(url: str):
    if not url.startswith("postgresql"):
        raise SystemExit(f"--target must be a PostgreSQL URL, got {mask(url)}")
    return create_engine(url, pool_pre_ping=True)


def count_rows(conn, table_name: str):
    """Row count, or None if the table does not exist."""
    try:
        return int(conn.execute(text(f"SELECT COUNT(*) FROM {table_name}")).scalar() or 0)
    except Exception:
        return None


def common_columns(source_conn, table: Table):
    """
    Columns the model defines AND the source file actually has.

    An older SQLite file predating a migration is missing columns; skipping them
    lets the target's defaults apply instead of blowing up mid-copy.
    """
    available = {c["name"] for c in inspect(source_conn).get_columns(table.name)}
    return [c for c in table.columns if c.name in available]


def plan(source_engine, target_engine, tables):
    """Everything the run would do, computed without writing anything."""
    rows = []
    with source_engine.connect() as src, target_engine.connect() as dst:
        src_tables = set(inspect(src).get_table_names())
        dst_tables = set(inspect(dst).get_table_names())
        for name in tables:
            rows.append({
                "table": name,
                "in_source": name in src_tables,
                "source_rows": count_rows(src, name) if name in src_tables else None,
                "in_target": name in dst_tables,
                "target_rows": count_rows(dst, name) if name in dst_tables else None,
            })
    return rows


def print_plan(rows):
    print(f"  {'table':<24} {'source':>10} {'target (before)':>17}  {'action':<28}")
    print("  " + "-" * 82)
    for row in rows:
        if not row["in_source"]:
            action = "skip - not in source"
            source = "-"
        elif row["source_rows"] == 0:
            action = "skip - source empty"
            source = "0"
        else:
            action = f"copy {row['source_rows']} row(s), ON CONFLICT DO NOTHING"
            source = str(row["source_rows"])
        target = "(missing)" if not row["in_target"] else str(row["target_rows"])
        print(f"  {row['table']:<24} {source:>10} {target:>17}  {action:<28}")


def copy_table(source_engine, target_engine, table: Table) -> int:
    """
    Copy one table. Returns the number of rows sent (not necessarily inserted -
    conflicts are skipped, which is what makes a re-run harmless).
    """
    sent = 0
    with source_engine.connect() as src:
        columns = common_columns(src, table)
        if not columns:
            return 0
        result = src.execute(select(*columns))
        with target_engine.begin() as dst:
            while True:
                chunk = result.fetchmany(BATCH)
                if not chunk:
                    break
                payload = [dict(row._mapping) for row in chunk]
                stmt = pg_insert(table).values(payload)
                pk = [c.name for c in table.primary_key.columns]
                dst.execute(stmt.on_conflict_do_nothing(index_elements=pk))
                sent += len(payload)
    return sent


def copy_migrations(source_engine, target_engine) -> int:
    """
    Carry over which migrations have already run, so the app does not replay
    them against data that is already migrated.
    """
    with source_engine.connect() as src:
        if "migrations" not in inspect(src).get_table_names():
            return 0
        rows = src.execute(text("SELECT name, applied_at FROM migrations")).all()
    if not rows:
        return 0
    with target_engine.begin() as dst:
        MIGRATIONS_TABLE.create(bind=dst, checkfirst=True)
        stmt = pg_insert(MIGRATIONS_TABLE).values(
            [{"name": name, "applied_at": applied} for name, applied in rows]
        )
        dst.execute(stmt.on_conflict_do_nothing(index_elements=["name"]))
    return len(rows)


def verify(source_engine, target_engine, tables):
    """Per-table row counts on both sides. Returns (ok, lines)."""
    ok = True
    lines = [f"  {'table':<24} {'source':>10} {'target':>10}   verdict"]
    lines.append("  " + "-" * 60)
    with source_engine.connect() as src, target_engine.connect() as dst:
        for name in tables:
            s = count_rows(src, name)
            t = count_rows(dst, name)
            if s is None:
                lines.append(f"  {name:<24} {'-':>10} {str(t):>10}   not in source, skipped")
                continue
            if t is None:
                ok = False
                lines.append(f"  {name:<24} {s:>10} {'MISSING':>10}   FAIL")
                continue
            if t >= s:
                verdict = "OK" if t == s else f"OK (target has {t - s} extra)"
            else:
                verdict = "FAIL - target is short"
                ok = False
            lines.append(f"  {name:<24} {s:>10} {t:>10}   {verdict}")
    return ok, lines


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Copy a HeroMaker SQLite database into Postgres. Dry run by default.",
    )
    parser.add_argument("--source", default=os.getenv("SQLITE_DATABASE_URL"),
                        help="SQLite URL. Default: $SQLITE_DATABASE_URL, else the "
                             "project's data/db/heromaker.db")
    parser.add_argument("--target", default=os.getenv("TARGET_DATABASE_URL") or os.getenv("DATABASE_URL"),
                        help="PostgreSQL URL. Default: $TARGET_DATABASE_URL, else $DATABASE_URL")
    parser.add_argument("--apply", action="store_true",
                        help="Actually write. Without this, nothing is modified.")
    parser.add_argument("--force", action="store_true",
                        help="Allow writing into a target that already has rows.")
    parser.add_argument("--tables", nargs="*", default=None,
                        help="Restrict to these tables (default: all, in FK order).")
    args = parser.parse_args()

    source_url = args.source
    if not source_url:
        default_db = BACKEND_DIR.parent / "data" / "db" / "heromaker.db"
        source_url = f"sqlite:///{default_db.absolute()}"
    if not args.target:
        parser.error("no --target given and neither TARGET_DATABASE_URL nor DATABASE_URL is set")

    tables = args.tables or TABLE_ORDER
    unknown = [t for t in tables if t not in TABLE_ORDER]
    if unknown:
        parser.error(f"unknown table(s): {', '.join(unknown)}")

    source_engine = open_source(source_url)
    target_engine = open_target(args.target)

    print("=" * 86)
    print("SQLITE -> POSTGRES MIGRATION" + ("" if args.apply else "   [DRY RUN - nothing will be written]"))
    print(f"source : {mask(source_url)}  (opened read-only)")
    print(f"target : {mask(args.target)}")
    print("=" * 86)

    # ---- schema on the target -------------------------------------------
    with target_engine.connect() as dst:
        existing = set(inspect(dst).get_table_names())
    missing_tables = [t for t in tables if t not in existing]
    if missing_tables:
        print(f"\nTarget is missing {len(missing_tables)} table(s): {', '.join(missing_tables)}")
        if args.apply:
            print("Creating them from app/models.py ...")
            Base.metadata.create_all(bind=target_engine)
            MIGRATIONS_TABLE.create(bind=target_engine, checkfirst=True)
            print("Done.")
        else:
            print("They would be created from app/models.py.")

    # ---- non-empty target guard -----------------------------------------
    rows = plan(source_engine, target_engine, tables)
    occupied = [r for r in rows if (r["target_rows"] or 0) > 0]
    if occupied and not args.force:
        print("\nREFUSING TO RUN: the target already contains data.")
        for row in occupied:
            print(f"  {row['table']}: {row['target_rows']} row(s)")
        print("\nThis is almost always the right refusal. Inspect the target first:")
        print(f'  .venv/bin/python backend/scripts/inspect_db.py "{mask(args.target)}"')
        print("\nIf you are certain, re-run with --force. The copy is idempotent")
        print("(ON CONFLICT DO NOTHING on the primary key), so existing rows are kept.")
        return 2

    print("\nPLAN")
    print_plan(rows)

    if not args.apply:
        print("\nDRY RUN - nothing was written. Re-run with --apply to execute.")
        return 0

    # ---- copy -------------------------------------------------------------
    print("\nCOPYING")
    for name in tables:
        table = Base.metadata.tables.get(name)
        if table is None:
            print(f"  {name:<24} skipped - not defined in app/models.py")
            continue
        with source_engine.connect() as src:
            if name not in inspect(src).get_table_names():
                print(f"  {name:<24} skipped - not in source")
                continue
        sent = copy_table(source_engine, target_engine, table)
        print(f"  {name:<24} {sent} row(s) sent")

    carried = copy_migrations(source_engine, target_engine)
    print(f"  {'migrations':<24} {carried} applied-migration marker(s) carried over")

    # ---- verify -----------------------------------------------------------
    print("\nVERIFICATION")
    ok, lines = verify(source_engine, target_engine, tables)
    for line in lines:
        print(line)

    print()
    if ok:
        print("All row counts match. Migration verified.")
        print("Now run inspect_db.py against the target and compare it to the source.")
        return 0
    print("ROW COUNTS DO NOT MATCH. The migration is INCOMPLETE.")
    print("The copy is idempotent - re-running is safe and will fill the gaps.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
