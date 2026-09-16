"""
Shared fixtures for the backend unit tests.

These tests run entirely in-process against a throwaway SQLite database. They
do NOT need a running server, network access, or API keys - unlike the
integration tests in backend/app/tests/, which drive a live API.

IMPORTANT: DATABASE_URL is set BEFORE any `app.*` module is imported, because
app/database.py builds its engine at import time from app/config/settings.py.
Importing the app first and swapping the URL afterwards would leave every
service module bound to the developer's real database.
"""
import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

_TMP_DIR = tempfile.mkdtemp(prefix="heromaker-tests-")

# A FILE-BACKED SQLite database, not :memory:. The concurrency tests use real
# threads with their own connections; an in-memory database would give each
# connection its own private, empty database and the race being measured could
# not happen at all.
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP_DIR}/test.db"
os.environ["FILES_ROOT"] = f"{_TMP_DIR}/files"
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only")
os.environ.setdefault("MESHY_USD_MICROS_PER_CREDIT", "20000")

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.models import (  # noqa: E402
    Coupon,
    CouponRedemption,
    Creation,
    CreationStep,
    CreditTransaction,
    Payment,
    UsageEvent,
    User,
)

# Tables are wiped between tests in dependency order (children first), so
# foreign keys never block a truncate.
_WIPE_ORDER = (
    UsageEvent,
    CreditTransaction,
    Payment,
    CouponRedemption,
    Coupon,
    CreationStep,
    Creation,
    User,
)


# Create the schema HERE, at conftest import time, rather than in a
# `pytest_sessionstart` hook. `pytest_sessionstart` only fires for conftests
# pytest loads up front, and whether this file is one of those depends on the
# directory pytest was invoked from - from the repository root it is loaded
# lazily during collection, long after session start, and the tables would not
# exist. Import time always happens before any test in this directory runs.
Base.metadata.create_all(bind=engine)


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(_TMP_DIR, ignore_errors=True)


@pytest.fixture(autouse=True)
def clean_database():
    """Every test starts from an empty database."""
    db = SessionLocal()
    try:
        for model in _WIPE_ORDER:
            db.query(model).delete()
        db.commit()
    finally:
        db.close()
    yield
    db = SessionLocal()
    try:
        for model in _WIPE_ORDER:
            db.query(model).delete()
        db.commit()
    finally:
        db.close()


@pytest.fixture
def db():
    """A session for the test body. Independent of any session under test."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def make_user(db):
    """Create a user with an optional starting balance, via the ledger."""
    from app.services import ledger

    counter = {"n": 0}

    def _make(credits: int = 0, username: str = None, is_admin: bool = False) -> User:
        counter["n"] += 1
        n = counter["n"]
        user = User(
            email=f"user{n}@example.test",
            username=username or f"user{n}",
            credits=0,
            is_admin=is_admin,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        if credits:
            ledger.post(
                db=db, user_id=user.id, delta=credits, reason="opening_balance",
                metadata={"source": "test fixture"},
            )
            db.refresh(user)
        return user

    return _make


@pytest.fixture
def make_creation(db):
    """Create a creation, optionally with steps at given statuses."""
    def _make(user_id: str, steps: dict = None) -> Creation:
        creation = Creation(user_id=user_id)
        db.add(creation)
        db.commit()
        db.refresh(creation)
        for name, status in (steps or {}).items():
            db.add(CreationStep(creation_id=creation.id, step_name=name, status=status))
        if steps:
            db.commit()
        return creation

    return _make


@pytest.fixture
def completed_steps():
    """Step map for a creation that finished the whole pipeline."""
    from app.config.steps import get_all_step_names
    return {name: "completed" for name in get_all_step_names()}
