"""
The leaked debug admin is disarmed on every boot.

backend/scripts/migrate_debug_user.py, public in the repo until 2026-11-23,
made an ADMIN account (username "debug", email debug@heromaker.local) with its
password in the file. The startup guard takes admin away from that account
and replaces the password, wherever it exists. These tests run the real guard
against the real database and the real password check.
"""
import logging

import pytest

from app.models import User
from app.services.auth import hash_password, verify_password
from app.services.security_guards import disarm_leaked_debug_admin

LEAKED_PASSWORD = "the password that was published"   # stands in for the real one


def _user(db, username, email, admin, password="s3cret-pw"):
    u = User(username=username, email=email, is_admin=admin, password_hash=hash_password(password))
    db.add(u)
    db.commit()
    return u


def _fresh(db, user):
    db.expire_all()
    return db.get(User, user.id)


def test_the_leaked_debug_admin_loses_admin_and_its_password(db, caplog):
    debug = _user(db, "debug", "debug@heromaker.local", admin=True, password=LEAKED_PASSWORD)

    with caplog.at_level(logging.WARNING):
        assert disarm_leaked_debug_admin(db) == 1

    debug = _fresh(db, debug)
    assert debug.is_admin is False
    assert not verify_password(LEAKED_PASSWORD, debug.password_hash), "the published password still works"
    assert debug.id in caplog.text and "SECURITY" in caplog.text


@pytest.mark.parametrize("username,email", [
    ("debug", "someone-else@example.com"),          # matched by username
    ("renamed", "debug@heromaker.local"),           # matched by email
])
def test_either_the_username_or_the_email_identifies_it(db, username, email):
    leaked = _user(db, username, email, admin=True, password=LEAKED_PASSWORD)
    assert disarm_leaked_debug_admin(db) == 1
    assert _fresh(db, leaked).is_admin is False


def test_real_admins_and_users_are_untouched(db):
    admin = _user(db, "raz", "raz@example.com", admin=True, password="admin-pw")
    user = _user(db, "parent", "parent@example.com", admin=False, password="user-pw")
    debug_but_not_admin = _user(db, "debug", "debug@heromaker.local", admin=False, password="kept-pw")
    before = {u.id: _fresh(db, u).password_hash for u in (admin, user, debug_but_not_admin)}

    assert disarm_leaked_debug_admin(db) == 0

    assert _fresh(db, admin).is_admin is True and verify_password("admin-pw", _fresh(db, admin).password_hash)
    assert _fresh(db, user).is_admin is False and verify_password("user-pw", _fresh(db, user).password_hash)
    assert {u.id: _fresh(db, u).password_hash for u in (admin, user, debug_but_not_admin)} == before


def test_running_it_again_changes_nothing(db):
    debug = _user(db, "debug", "debug@heromaker.local", admin=True, password=LEAKED_PASSWORD)
    assert disarm_leaked_debug_admin(db) == 1
    after_first = _fresh(db, debug).password_hash

    assert disarm_leaked_debug_admin(db) == 0
    assert _fresh(db, debug).password_hash == after_first


def test_the_guard_runs_when_the_app_starts(db, monkeypatch):
    """Wired into app/main.py's startup: importing the app runs it."""
    import importlib
    import sys

    debug = _user(db, "debug", "debug@heromaker.local", admin=True, password=LEAKED_PASSWORD)
    sys.modules.pop("app.main", None)
    importlib.import_module("app.main")

    assert _fresh(db, debug).is_admin is False
