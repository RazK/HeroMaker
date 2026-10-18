"""Migrations must not hang behind the backend they are replacing.

During a deploy the old backend keeps serving, and any transaction it has open
holds a lock on the tables it read. 015_classes ran ALTER TABLE users inside
one long migration transaction and hung staging twice, on the same line, until
Railway's health check killed the new container.

These tests hold such a lock from a second connection - exactly what the old
backend does - and drive the real code: runner.run_ddl and m015.migrate.
Postgres only: SQLite has no lock_timeout and no concurrent DDL to wait on.

    TEST_POSTGRES_URL=postgresql://user:pass@host/db \\
      .venv/bin/python -m pytest backend/tests/test_migration_locks.py
"""
import os
import threading
import time

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

pytestmark = pytest.mark.skipif(
    not os.getenv("TEST_POSTGRES_URL"),
    reason="set TEST_POSTGRES_URL: lock waits only exist on Postgres",
)

HOLD_SECONDS = 3


@pytest.fixture
def pg():
    from app.database import Base
    import app.models  # noqa: F401  (registers every table on Base)

    engine = create_engine(os.environ["TEST_POSTGRES_URL"])
    Base.metadata.create_all(bind=engine)
    yield engine, sessionmaker(bind=engine)
    engine.dispose()


def _hold_lock(engine, table: str, seconds: float, ready: threading.Event):
    """Read `table` in an open transaction, like an old-backend request mid-await."""
    with engine.connect() as conn:
        trans = conn.begin()
        conn.execute(text(f"SELECT 1 FROM {table} LIMIT 1"))
        ready.set()
        time.sleep(seconds)
        trans.rollback()


def _run_in_thread(fn, timeout: float):
    result = {}

    def target():
        try:
            fn()
            result["ok"] = True
        except BaseException as e:  # noqa: BLE001 - reported to the test
            result["error"] = e

    t = threading.Thread(target=target, daemon=True)
    t.start()
    t.join(timeout)
    assert not t.is_alive(), f"still blocked after {timeout}s"
    if "error" in result:
        raise result["error"]


def test_run_ddl_waits_out_a_held_lock_then_succeeds(pg, caplog):
    from app.migrations import runner

    engine, Session = pg
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS lock_probe"))
        conn.execute(text("CREATE TABLE lock_probe (id INTEGER)"))

    ready = threading.Event()
    holder = threading.Thread(
        target=_hold_lock, args=(engine, "lock_probe", HOLD_SECONDS, ready), daemon=True
    )
    holder.start()
    assert ready.wait(5)

    db = Session()
    try:
        started = time.monotonic()
        _run_in_thread(
            lambda: runner.run_ddl(db, "ALTER TABLE lock_probe ADD COLUMN extra INTEGER"),
            timeout=30,
        )
        waited = time.monotonic() - started
    finally:
        db.close()
        holder.join()

    assert waited >= HOLD_SECONDS - 0.5  # it really did wait for the lock
    assert "Lock busy" in caplog.text  # by retrying, not by one unbounded wait
    columns = {c["name"] for c in inspect(engine).get_columns("lock_probe")}
    assert "extra" in columns
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE lock_probe"))


def test_run_ddl_gives_up_instead_of_hanging(pg, monkeypatch):
    from sqlalchemy.exc import OperationalError
    from app.migrations import runner

    engine, Session = pg
    monkeypatch.setattr(runner, "LOCK_TIMEOUT", "200ms")
    monkeypatch.setattr(runner, "LOCK_ATTEMPTS", 2)
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS lock_probe"))
        conn.execute(text("CREATE TABLE lock_probe (id INTEGER)"))

    ready = threading.Event()
    holder = threading.Thread(
        target=_hold_lock, args=(engine, "lock_probe", HOLD_SECONDS, ready), daemon=True
    )
    holder.start()
    assert ready.wait(5)

    db = Session()
    try:
        with pytest.raises(OperationalError):
            _run_in_thread(
                lambda: runner.run_ddl(db, "ALTER TABLE lock_probe ADD COLUMN extra INTEGER"),
                timeout=10,
            )
    finally:
        db.close()
        holder.join()
        with engine.begin() as conn:
            conn.execute(text("DROP TABLE lock_probe"))


def test_m015_completes_while_the_old_backend_reads_users(pg):
    """The staging failure, replayed: an old-shaped schema, and a reader on users."""
    from app.migrations import m015_classes

    engine, Session = pg
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE creations DROP COLUMN IF EXISTS class_id"))
        conn.execute(text("ALTER TABLE users DROP COLUMN IF EXISTS is_teacher"))
        conn.execute(text("ALTER TABLE users DROP COLUMN IF EXISTS kind"))

    ready = threading.Event()
    holder = threading.Thread(
        target=_hold_lock, args=(engine, "users", HOLD_SECONDS, ready), daemon=True
    )
    holder.start()
    assert ready.wait(5)

    db = Session()
    try:
        _run_in_thread(lambda: m015_classes.migrate(db), timeout=60)
    finally:
        db.close()
        holder.join()

    inspector = inspect(engine)
    users = {c["name"] for c in inspector.get_columns("users")}
    creations = {c["name"] for c in inspector.get_columns("creations")}
    assert {"is_teacher", "kind"} <= users
    assert "class_id" in creations
