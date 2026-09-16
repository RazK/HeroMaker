"""
The three operational scripts.

These are the things run by hand, under pressure, against a database that
matters - which is exactly why they need tests. The two properties asserted
hardest are the ones whose failure is expensive and silent:

  * inspect_db.py never prints personal data and cannot write;
  * migrate_sqlite_to_postgres.py refuses a non-empty target and writes nothing
    without --apply.
"""
import importlib.util
import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

BACKEND_DIR = Path(__file__).resolve().parent.parent
SCRIPTS = BACKEND_DIR / "scripts"
VENV_PYTHON = BACKEND_DIR.parent / ".venv" / "bin" / "python"


def _load(name: str):
    """Import a script by path - they are not a package."""
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


inspect_db = _load("inspect_db")
migrate_script = _load("migrate_sqlite_to_postgres")


# ---------------------------------------------------------------------------
# A realistic SQLite database to point the scripts at
# ---------------------------------------------------------------------------

SENSITIVE = {
    "email": "raz.private.address@example.com",
    "name": "Raz Karl",
    "username": "razk_private_handle",
}


@pytest.fixture
def seeded_sqlite(tmp_path):
    """A database with real-looking personal data in it, to prove none leaks."""
    path = tmp_path / "seeded.db"
    engine = create_engine(f"sqlite:///{path}")
    user_id = str(uuid.uuid4())
    creation_id = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, username TEXT,
                name TEXT, credits INTEGER DEFAULT 0, is_admin BOOLEAN DEFAULT 0,
                subscription_tier TEXT DEFAULT 'free', created_at TIMESTAMP)
        """))
        conn.execute(text("""
            CREATE TABLE creations (id TEXT PRIMARY KEY, user_id TEXT,
                character_name TEXT, created_at TIMESTAMP)
        """))
        conn.execute(text("""
            CREATE TABLE creation_steps (id TEXT PRIMARY KEY, creation_id TEXT,
                step_name TEXT, status TEXT, error_message TEXT, created_at TIMESTAMP)
        """))
        conn.execute(text("""
            CREATE TABLE credit_transactions (id TEXT PRIMARY KEY, user_id TEXT,
                delta INTEGER, reason TEXT, external_ref TEXT, creation_id TEXT,
                balance_after INTEGER, metadata TEXT, created_at TIMESTAMP)
        """))
        conn.execute(
            text("INSERT INTO users (id, email, username, name, credits, created_at) "
                 "VALUES (:id, :email, :username, :name, 37, CURRENT_TIMESTAMP)"),
            {"id": user_id, **SENSITIVE},
        )
        conn.execute(
            text("INSERT INTO creations (id, user_id, character_name, created_at) "
                 "VALUES (:id, :uid, 'Captain Secret', CURRENT_TIMESTAMP)"),
            {"id": creation_id, "uid": user_id},
        )
        for step, status in [("openai_render", "completed"), ("meshy_3d", "completed"),
                             ("meshy_rig", "failed"), ("convert_vrm", "pending")]:
            conn.execute(
                text("INSERT INTO creation_steps (id, creation_id, step_name, status, "
                     "error_message, created_at) VALUES (:id, :cid, :s, :st, "
                     "'stack trace with raz.private.address@example.com', CURRENT_TIMESTAMP)"),
                {"id": str(uuid.uuid4()), "cid": creation_id, "s": step, "st": status},
            )
        conn.execute(
            text("INSERT INTO credit_transactions (id, user_id, delta, reason, "
                 "balance_after, metadata, created_at) VALUES (:id, :uid, 37, "
                 "'opening_balance', 37, '{}', CURRENT_TIMESTAMP)"),
            {"id": str(uuid.uuid4()), "uid": user_id},
        )
    return f"sqlite:///{path}", user_id, creation_id


# ---------------------------------------------------------------------------
# inspect_db.py
# ---------------------------------------------------------------------------

def test_inspect_db_prints_counts_and_the_answer_to_is_there_real_data(seeded_sqlite, capsys):
    url, _uid, _cid = seeded_sqlite
    assert inspect_db.inspect_database(url) == 0
    out = capsys.readouterr().out

    assert "IS THERE REAL DATA HERE?" in out
    assert "YES. 1 user(s), 1 creation(s)." in out
    assert "users with non-zero credits    1" in out
    assert "total credits outstanding      37" in out
    assert "ledger vs cache                OK" in out


def test_inspect_db_never_prints_personal_data(seeded_sqlite, capsys):
    """The property that lets this output be pasted into a chat window."""
    url, _uid, _cid = seeded_sqlite
    inspect_db.inspect_database(url)
    out = capsys.readouterr().out

    for value in SENSITIVE.values():
        assert value not in out, f"leaked {value!r}"
    assert "Captain Secret" not in out
    assert "stack trace" not in out
    # No stray email address anywhere except the (masked) URL line.
    for line in out.splitlines():
        if line.startswith("url     :"):
            continue
        assert "@" not in line, f"possible email leak: {line!r}"


def test_inspect_db_masks_the_password_in_the_url(capsys):
    assert inspect_db.mask_url(
        "postgresql://someuser:hunter2@host.railway.app:5432/railway"
    ) == "postgresql://someuser:***@host.railway.app:5432/railway"


def test_inspect_db_pii_guard_actually_fires():
    """The guard is only reassuring if it can fail. Feed it a leak."""
    with pytest.raises(SystemExit, match="email"):
        inspect_db._assert_no_pii("  some user: person@example.com")
    # And is not fooled into firing on the masked URL line.
    inspect_db._assert_no_pii("url     : postgresql://u:***@host/db")


def test_inspect_db_connection_is_genuinely_read_only(seeded_sqlite):
    """
    Not 'we are careful' - the database itself must reject the write. If this
    ever starts passing a write through, the script is no longer safe to point
    at production.
    """
    url, _uid, _cid = seeded_sqlite
    engine = inspect_db.build_engine(url)
    with engine.connect() as conn:
        with pytest.raises(Exception):
            conn.execute(text("UPDATE users SET credits = 999999"))
            conn.commit()

    # And the data is untouched.
    with create_engine(url).connect() as conn:
        assert conn.execute(text("SELECT credits FROM users")).scalar() == 37


def test_inspect_db_reports_an_empty_database_as_safe_to_migrate_into(tmp_path, capsys):
    url = f"sqlite:///{tmp_path}/empty.db"
    create_engine(url).connect().close()
    assert inspect_db.inspect_database(url) == 0
    assert "EMPTY - safe to migrate into" in capsys.readouterr().out


def test_inspect_db_derives_the_creation_status_spread(seeded_sqlite, capsys):
    """
    Creation.status is a Python property, not a column. The script recomputes it
    in SQL using the same rules - here, one creation with a failed rig step.
    """
    url, _uid, _cid = seeded_sqlite
    inspect_db.inspect_database(url)
    out = capsys.readouterr().out
    assert "status spread (derived from steps)" in out
    assert "failed                      1" in out
    assert "completed                   0" in out


def test_inspect_db_flags_a_missing_financial_spine(tmp_path, capsys):
    url = f"sqlite:///{tmp_path}/old.db"
    with create_engine(url).begin() as conn:
        conn.execute(text("CREATE TABLE users (id TEXT PRIMARY KEY, credits INTEGER)"))
        conn.execute(text("INSERT INTO users VALUES ('u1', 5)"))
    inspect_db.inspect_database(url)
    out = capsys.readouterr().out
    assert "NOT YET MIGRATED" in out
    assert "credit_transactions" in out


def test_inspect_db_runs_as_a_command(seeded_sqlite):
    """The thing actually typed at a terminal."""
    url, _uid, _cid = seeded_sqlite
    result = subprocess.run(
        [str(VENV_PYTHON), str(SCRIPTS / "inspect_db.py"), url],
        capture_output=True, text=True, timeout=120,
    )
    assert result.returncode == 0, result.stderr
    assert "DATABASE INSPECTION" in result.stdout
    assert SENSITIVE["email"] not in result.stdout


def test_inspect_db_exits_nonzero_on_an_unreachable_database(tmp_path):
    result = subprocess.run(
        [str(VENV_PYTHON), str(SCRIPTS / "inspect_db.py"),
         f"sqlite:///{tmp_path}/does-not-exist.db"],
        capture_output=True, text=True, timeout=120,
    )
    assert result.returncode == 1
    assert "ERROR" in result.stderr


# ---------------------------------------------------------------------------
# migrate_sqlite_to_postgres.py
# ---------------------------------------------------------------------------

def test_migration_refuses_a_non_postgres_target(seeded_sqlite):
    url, _uid, _cid = seeded_sqlite
    with pytest.raises(SystemExit, match="must be a PostgreSQL URL"):
        migrate_script.open_target("sqlite:///somewhere.db")


def test_migration_refuses_a_non_sqlite_source():
    with pytest.raises(SystemExit, match="must be a SQLite URL"):
        migrate_script.open_source("postgresql://u:p@h/db")


def test_migration_refuses_a_source_that_does_not_exist(tmp_path):
    with pytest.raises(SystemExit, match="not found"):
        migrate_script.open_source(f"sqlite:///{tmp_path}/nope.db")


def test_migration_opens_the_source_read_only(seeded_sqlite):
    """The source is never modified. Enforced by SQLite, not by discipline."""
    url, _uid, _cid = seeded_sqlite
    engine = migrate_script.open_source(url)
    with engine.connect() as conn:
        with pytest.raises(Exception):
            conn.execute(text("DELETE FROM users"))
            conn.commit()


def test_migration_is_dry_run_by_default(seeded_sqlite, tmp_path):
    """
    Without --apply the script must not write. Run as a subprocess against a
    fake Postgres URL: it should fail to CONNECT, never having decided to write.
    """
    url, _uid, _cid = seeded_sqlite
    result = subprocess.run(
        [str(VENV_PYTHON), str(SCRIPTS / "migrate_sqlite_to_postgres.py"),
         "--source", url,
         "--target", "postgresql://u:p@127.0.0.1:1/nonexistent"],
        capture_output=True, text=True, timeout=180,
    )
    assert "DRY RUN - nothing will be written" in result.stdout
    assert "--apply" not in result.stdout.split("DRY RUN")[0]
    # The password is masked even in the banner.
    assert ":p@" not in result.stdout


def test_migration_default_is_dry_run_in_the_argument_parser():
    """A flag whose default is wrong is a production incident."""
    import argparse
    src = (SCRIPTS / "migrate_sqlite_to_postgres.py").read_text()
    assert '"--apply", action="store_true"' in src
    assert '"--force", action="store_true"' in src
    # Neither may ever acquire default=True.
    assert 'action="store_true", default=True' not in src


def test_migration_plan_and_verify_work_on_two_databases(seeded_sqlite, tmp_path):
    """
    plan() and verify() are the read-only halves of the script. Exercised here
    between two SQLite databases so the logic is covered without a Postgres
    server; only the ON CONFLICT insert is Postgres-specific.
    """
    source_url, _uid, _cid = seeded_sqlite
    target_url = f"sqlite:///{tmp_path}/target.db"
    source = create_engine(source_url)
    target = create_engine(target_url)
    with target.begin() as conn:
        conn.execute(text("CREATE TABLE users (id TEXT PRIMARY KEY, credits INTEGER)"))

    rows = migrate_script.plan(source, target, ["users", "creations", "payments"])
    by_table = {r["table"]: r for r in rows}
    assert by_table["users"]["source_rows"] == 1
    assert by_table["users"]["target_rows"] == 0
    assert by_table["payments"]["in_source"] is False

    ok, lines = migrate_script.verify(source, target, ["users"])
    assert ok is False  # target is short: 1 vs 0
    assert any("FAIL" in line for line in lines)

    with target.begin() as conn:
        conn.execute(text("INSERT INTO users VALUES ('x', 37)"))
    ok, _lines = migrate_script.verify(source, target, ["users"])
    assert ok is True


def test_migration_skips_columns_an_older_source_does_not_have(seeded_sqlite):
    """
    An out-of-date SQLite file is missing columns added by later migrations.
    Those must be skipped so the target's defaults apply, rather than the copy
    blowing up halfway through.
    """
    from app.database import Base

    url, _uid, _cid = seeded_sqlite
    engine = create_engine(url)
    users_table = Base.metadata.tables["users"]
    with engine.connect() as conn:
        columns = {c.name for c in migrate_script.common_columns(conn, users_table)}
    assert "credits" in columns
    assert "email" in columns
    # The seeded fixture has no password_hash / date_of_birth columns.
    assert "password_hash" not in columns
    assert "date_of_birth" not in columns


def test_migration_copies_parents_before_children():
    """A foreign key must not point at a row that has not been copied yet."""
    order = migrate_script.TABLE_ORDER
    assert order.index("users") < order.index("creations")
    assert order.index("creations") < order.index("creation_steps")
    assert order.index("creations") < order.index("usage_events")
    assert order.index("users") < order.index("credit_transactions")
    assert order.index("users") < order.index("payments")
    assert order.index("coupons") < order.index("coupon_redemptions")


def test_migration_covers_every_financial_table():
    for table in ("credit_transactions", "usage_events", "payments"):
        assert table in migrate_script.TABLE_ORDER


# ---------------------------------------------------------------------------
# seed_demo.py
# ---------------------------------------------------------------------------

def test_seed_demo_runs_end_to_end_and_prints_the_margin_report(tmp_path):
    """
    The whole system demonstrated without a real customer - run exactly as a
    person would run it, in a subprocess, against its own throwaway database.
    """
    demo_db = tmp_path / "demo.db"
    env = dict(os.environ, JWT_SECRET_KEY="test-secret")
    env.pop("DATABASE_URL", None)
    result = subprocess.run(
        [str(VENV_PYTHON), str(SCRIPTS / "seed_demo.py"),
         "--database-url", f"sqlite:///{demo_db}"],
        capture_output=True, text=True, timeout=300, env=env,
    )
    assert result.returncode == 0, result.stderr[-3000:]
    out = result.stdout

    assert "HEROMAKER MARGIN REPORT" in out
    assert "COST PER SUCCESSFUL HERO" in out
    assert "COST OF THE FREE TIER" in out
    assert "GROSS MARGIN" in out
    assert "consistent=True" in out

    # The seeded numbers, pinned. Two heroes delivered: one clean at $0.5670 and
    # one that needed its render and its 3D model twice, at $1.1340.
    assert "heroes completed                     2" in out
    assert "$0.8505" in out   # cost per successful hero
    assert "$1.1340" in out   # fully loaded per successful hero
    assert demo_db.exists()


def test_seed_demo_does_not_touch_the_project_database(tmp_path):
    """
    Safe to run repeatedly. It must default to a throwaway file, never the
    developer's real database.
    """
    src = (SCRIPTS / "seed_demo.py").read_text()
    assert "heromaker-seed-demo.db" in src
    assert "--use-project-db" in src
    assert 'os.environ["DATABASE_URL"] = url' in src
