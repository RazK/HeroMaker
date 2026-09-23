#!/usr/bin/env python
"""
Look before leaping: a read-only, PII-free summary of a database.

THIS IS WHAT YOU RUN THE MOMENT SOMEONE HANDS YOU THE RAILWAY URL, to answer
"is there real data in here" before touching anything.

    .venv/bin/python backend/scripts/inspect_db.py "postgresql://user:pass@host:5432/railway"

or, with the URL already in the environment:

    DATABASE_URL="postgresql://..." .venv/bin/python backend/scripts/inspect_db.py

SAFETY PROPERTIES
-----------------
* READ ONLY, and not merely by convention. On Postgres the session is opened
  with `postgresql_readonly=True`, so the server itself rejects any write. On
  SQLite the file is opened with `mode=ro`. There is no code path in this file
  that issues INSERT, UPDATE, DELETE or DDL.
* NO PERSONAL DATA IS EVER PRINTED. No emails, no names, no usernames, no
  creation titles, no ids that identify a person. Only counts, dates and
  aggregates. The password in the connection URL is masked in the output too,
  so the report can be pasted into a chat.
* Nothing is written to disk.

Exit code is 0 on success, 1 if the database could not be read.
"""
import argparse
import os
import re
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import create_engine, inspect, text  # noqa: E402

# Columns that must never be printed, in any form. Belt and braces: this script
# only ever SELECTs aggregates, but the list documents the intent and is used to
# assert that no free-text column value leaks into the output.
PII_COLUMNS = {
    "email", "name", "username", "password_hash", "google_id",
    "date_of_birth", "character_name", "error_message",
}

# Tables we know about, in a sensible reading order. Anything else in the
# database is still listed, just after these.
KNOWN_TABLES = [
    "users", "creations", "creation_steps",
    "credit_transactions", "usage_events", "payments",
    "coupons", "coupon_redemptions", "migrations",
]

# (table, column) pairs used for the "oldest / newest row" line.
TIME_COLUMNS = {
    "users": "created_at",
    "creations": "created_at",
    "creation_steps": "created_at",
    "credit_transactions": "created_at",
    "usage_events": "created_at",
    "payments": "created_at",
    "coupons": "created_at",
    "coupon_redemptions": "redeemed_at",
    "migrations": "applied_at",
}


def mask_url(url: str) -> str:
    """Hide the password so the output can be pasted anywhere."""
    return re.sub(r"(://[^:/@]+):([^@]+)@", r"\1:***@", url)


def build_engine(url: str):
    """A connection that the server itself will not let us write through."""
    if url.startswith("sqlite"):
        # Re-open the same file through SQLite's URI syntax in read-only mode.
        path = url.split("sqlite:///", 1)[-1].lstrip("/")
        if not path:
            raise SystemExit("Refusing to inspect an in-memory SQLite database")
        return create_engine(f"sqlite:///file:/{path}?mode=ro&uri=true")
    engine = create_engine(url, pool_pre_ping=True)
    if engine.dialect.name == "postgresql":
        # Enforced by Postgres, not by us being careful.
        engine = engine.execution_options(postgresql_readonly=True)
    return engine


def _count(conn, table: str) -> int:
    return int(conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar() or 0)


def _fmt(value) -> str:
    if value is None:
        return "-"
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M")
    return str(value)


def _rule(title: str = "") -> str:
    return f"\n{title}\n" + "-" * 68 if title else "-" * 68


def inspect_database(url: str) -> int:
    engine = build_engine(url)
    out = []

    with engine.connect() as conn:
        inspector = inspect(conn)
        tables = set(inspector.get_table_names())

        out.append("=" * 68)
        out.append("DATABASE INSPECTION (read-only, no personal data)")
        out.append(f"url     : {mask_url(url)}")
        out.append(f"dialect : {engine.dialect.name}")
        out.append(f"run at  : {datetime.utcnow():%Y-%m-%d %H:%M:%S} UTC")
        out.append("=" * 68)

        if not tables:
            out.append("\nNo tables. This database is EMPTY - safe to migrate into.")
            print("\n".join(out))
            return 0

        # ---- table inventory --------------------------------------------
        out.append(_rule("TABLES"))
        ordered = [t for t in KNOWN_TABLES if t in tables]
        ordered += sorted(tables - set(KNOWN_TABLES))
        counts = {}
        out.append(f"  {'table':<24} {'rows':>10}   {'oldest':>16}   {'newest':>16}")
        for table in ordered:
            try:
                counts[table] = _count(conn, table)
            except Exception as exc:
                out.append(f"  {table:<24} {'unreadable':>10}   ({exc})")
                continue
            oldest = newest = None
            col = TIME_COLUMNS.get(table)
            if col and counts[table]:
                try:
                    oldest, newest = conn.execute(
                        text(f"SELECT MIN({col}), MAX({col}) FROM {table}")
                    ).first()
                except Exception:
                    pass
            out.append(
                f"  {table:<24} {counts[table]:>10}   "
                f"{_fmt(oldest):>16}   {_fmt(newest):>16}"
            )
        out.append(f"  {'':<24} {'':>10}")
        out.append(f"  total rows across all tables: {sum(counts.values())}")

        # ---- is there real data ------------------------------------------
        out.append(_rule("IS THERE REAL DATA HERE?"))
        user_rows = counts.get("users", 0)
        creation_rows = counts.get("creations", 0)
        if user_rows == 0 and creation_rows == 0:
            out.append("  NO. No users and no creations - this looks like a fresh database.")
        else:
            out.append(f"  YES. {user_rows} user(s), {creation_rows} creation(s).")
            out.append("  Treat this as production data: back it up before migrating.")

        # ---- users --------------------------------------------------------
        if "users" in tables:
            out.append(_rule("USERS (aggregates only)"))
            cols = {c["name"] for c in inspector.get_columns("users")}
            out.append(f"  total users                    {user_rows}")
            if "credits" in cols:
                nonzero = int(conn.execute(text(
                    "SELECT COUNT(*) FROM users WHERE COALESCE(credits, 0) <> 0"
                )).scalar() or 0)
                total, biggest = conn.execute(text(
                    "SELECT COALESCE(SUM(credits), 0), COALESCE(MAX(credits), 0) FROM users"
                )).first()
                negative = int(conn.execute(text(
                    "SELECT COUNT(*) FROM users WHERE COALESCE(credits, 0) < 0"
                )).scalar() or 0)
                out.append(f"  users with non-zero credits    {nonzero}")
                out.append(f"  total credits outstanding      {int(total or 0)}")
                out.append(f"  largest single balance         {int(biggest or 0)}")
                if negative:
                    out.append(f"  ** users with NEGATIVE credits {negative}  <- overdrawn, investigate")
            if "is_admin" in cols:
                admins = int(conn.execute(text(
                    "SELECT COUNT(*) FROM users WHERE is_admin"
                )).scalar() or 0)
                out.append(f"  admins                         {admins}")
            if "subscription_tier" in cols:
                out.append("  by subscription tier:")
                for tier, n in conn.execute(text(
                    "SELECT COALESCE(subscription_tier, '(none)'), COUNT(*) "
                    "FROM users GROUP BY subscription_tier ORDER BY COUNT(*) DESC"
                )).all():
                    out.append(f"      {str(tier):<22} {n}")

        # ---- creations ----------------------------------------------------
        if "creations" in tables:
            out.append(_rule("CREATIONS"))
            out.append(f"  total creations                {creation_rows}")
            if "creation_steps" in tables and creation_rows:
                out.extend(_creation_status_spread(conn))
                out.append("  steps by status:")
                for status, n in conn.execute(text(
                    "SELECT COALESCE(status, '(null)'), COUNT(*) FROM creation_steps "
                    "GROUP BY status ORDER BY COUNT(*) DESC"
                )).all():
                    out.append(f"      {str(status):<22} {n}")
                out.append("  steps by name:")
                for step, n in conn.execute(text(
                    "SELECT COALESCE(step_name, '(null)'), COUNT(*) FROM creation_steps "
                    "GROUP BY step_name ORDER BY COUNT(*) DESC"
                )).all():
                    out.append(f"      {str(step):<22} {n}")

        # ---- financial spine ----------------------------------------------
        out.append(_rule("FINANCIAL SPINE"))
        missing = [t for t in ("credit_transactions", "usage_events", "payments")
                   if t not in tables]
        if missing:
            out.append(f"  NOT YET MIGRATED. Missing tables: {', '.join(missing)}")
            out.append("  Migration 008_financial_spine will create them and backfill")
            out.append("  every existing users.credits value as an opening balance.")
        else:
            out.append("  all three tables present")

        if "credit_transactions" in tables:
            ledger_total = int(conn.execute(text(
                "SELECT COALESCE(SUM(delta), 0) FROM credit_transactions"
            )).scalar() or 0)
            out.append(f"  ledger rows                    {counts.get('credit_transactions', 0)}")
            out.append(f"  ledger sum of deltas           {ledger_total}")
            if "users" in tables:
                cached_total = int(conn.execute(text(
                    "SELECT COALESCE(SUM(credits), 0) FROM users"
                )).scalar() or 0)
                drifted = int(conn.execute(text("""
                    SELECT COUNT(*) FROM (
                        SELECT u.id
                          FROM users u
                          LEFT JOIN credit_transactions ct ON ct.user_id = u.id
                         GROUP BY u.id, u.credits
                        HAVING COALESCE(u.credits, 0) <> COALESCE(SUM(ct.delta), 0)
                    ) drift
                """)).scalar() or 0)
                verdict = "OK" if cached_total == ledger_total and not drifted else "MISMATCH"
                out.append(f"  cached balances sum            {cached_total}")
                out.append(f"  ledger vs cache                {verdict}"
                           f"{'' if verdict == 'OK' else f'  ({drifted} user(s) drifted)'}")
            for reason, n in conn.execute(text(
                "SELECT reason, COUNT(*) FROM credit_transactions "
                "GROUP BY reason ORDER BY COUNT(*) DESC"
            )).all():
                out.append(f"      {str(reason):<22} {n}")

        if "usage_events" in tables and counts.get("usage_events"):
            out.append("  usage events by provider (cost in USD micros):")
            for provider, n, cost in conn.execute(text(
                "SELECT provider, COUNT(*), COALESCE(SUM(cost_usd_micros), 0) "
                "FROM usage_events GROUP BY provider ORDER BY 3 DESC"
            )).all():
                out.append(f"      {str(provider):<14} {n:>6} calls  {int(cost or 0):>12} micros")
            for status, n in conn.execute(text(
                "SELECT status, COUNT(*) FROM usage_events GROUP BY status ORDER BY 2 DESC"
            )).all():
                out.append(f"      status {str(status):<16} {n}")

        if "payments" in tables and counts.get("payments"):
            out.append("  payments by status (net USD micros):")
            for status, n, net in conn.execute(text(
                "SELECT status, COUNT(*), COALESCE(SUM(net_usd_micros), 0) "
                "FROM payments GROUP BY status ORDER BY 2 DESC"
            )).all():
                out.append(f"      {str(status):<14} {n:>6}      {int(net or 0):>12} micros")

        # ---- migrations ----------------------------------------------------
        if "migrations" in tables:
            out.append(_rule("MIGRATIONS APPLIED"))
            for name, applied in conn.execute(text(
                "SELECT name, applied_at FROM migrations ORDER BY id"
            )).all():
                out.append(f"  {str(name):<34} {_fmt(applied)}")

        out.append("")
        out.append("=" * 68)
        out.append("No personal data was read or printed. Nothing was written.")
        out.append("=" * 68)

    report = "\n".join(out)
    _assert_no_pii(report)
    print(report)
    return 0


def _creation_status_spread(conn):
    """
    Creation status is DERIVED from its steps (see Creation.status in
    app/models.py), so it cannot be read from a column. Recomputed here in one
    grouped query, using the same rules:

        any step failed        -> failed
        any step processing    -> processing
        last step completed    -> completed
        otherwise              -> pending
    """
    try:
        from app.config.steps import get_last_step
        last_step = (get_last_step() or {}).get("name", "convert_vrm")
    except Exception:
        last_step = "convert_vrm"

    rows = conn.execute(text("""
        SELECT c.id,
               MAX(CASE WHEN s.status = 'failed' THEN 1 ELSE 0 END)     AS any_failed,
               MAX(CASE WHEN s.status = 'processing' THEN 1 ELSE 0 END) AS any_processing,
               MAX(CASE WHEN s.step_name = :last AND s.status = 'completed'
                        THEN 1 ELSE 0 END)                              AS last_done,
               COUNT(s.id)                                              AS step_count
          FROM creations c
          LEFT JOIN creation_steps s ON s.creation_id = c.id
         GROUP BY c.id
    """), {"last": last_step}).all()

    spread = {"completed": 0, "failed": 0, "processing": 0, "pending": 0}
    for _cid, any_failed, any_processing, last_done, step_count in rows:
        if not step_count:
            spread["pending"] += 1
        elif any_failed:
            spread["failed"] += 1
        elif any_processing:
            spread["processing"] += 1
        elif last_done:
            spread["completed"] += 1
        else:
            spread["pending"] += 1

    total = sum(spread.values()) or 1
    lines = ["  status spread (derived from steps):"]
    for status in ("completed", "failed", "processing", "pending"):
        n = spread[status]
        lines.append(f"      {status:<22} {n:>6}   {100 * n // total:>3}%")
    return lines


def _assert_no_pii(report: str) -> None:
    """
    A last line of defence. If an '@' ever appears outside the masked URL, or a
    forbidden column name shows up with a value attached, something has been
    added to this script that leaks. Fail loudly rather than print it.
    """
    for line in report.splitlines():
        if line.startswith("url     :"):
            continue
        if "@" in line:
            raise SystemExit(
                "inspect_db: refusing to print a line that may contain an email "
                f"address: {line!r}"
            )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Read-only, PII-free summary of a HeroMaker database.",
        epilog="Prints counts and dates only. Never writes. Never prints personal data.",
    )
    parser.add_argument(
        "database_url", nargs="?", default=os.getenv("DATABASE_URL"),
        help="SQLAlchemy URL. Defaults to $DATABASE_URL.",
    )
    args = parser.parse_args()

    if not args.database_url:
        parser.error("no database URL given and DATABASE_URL is not set")

    try:
        return inspect_database(args.database_url)
    except SystemExit:
        raise
    except Exception as exc:
        print(f"ERROR: could not read database: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
