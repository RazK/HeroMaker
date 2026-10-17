"""backend/scripts/set_admin.py: grant and revoke admin by email."""
import importlib.util
from datetime import datetime
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "set_admin", Path(__file__).resolve().parents[1] / "scripts" / "set_admin.py")
set_admin = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(set_admin)


def test_grants_by_email_ignoring_case(db, make_user):
    user = make_user()
    assert set_admin.set_admin(db, user.email.upper()) == "granted"
    db.refresh(user)
    assert user.is_admin


def test_second_grant_changes_nothing(db, make_user):
    user = make_user(is_admin=True)
    assert set_admin.set_admin(db, user.email) == "unchanged"


def test_revoke(db, make_user):
    user = make_user(is_admin=True)
    assert set_admin.set_admin(db, user.email, admin=False) == "revoked"
    db.refresh(user)
    assert not user.is_admin


def test_unknown_or_deleted_account_is_not_found(db, make_user):
    assert set_admin.set_admin(db, "nobody@example.test") == "not-found"
    gone = make_user()
    gone.deleted_at = datetime.utcnow()
    db.commit()
    assert set_admin.set_admin(db, gone.email) == "not-found"
    db.refresh(gone)
    assert not gone.is_admin
