"""backend/scripts/cleanup_test_accounts.py: deletes the staging robot's
leftover accounts, and nothing else, through the real account_deletion."""
import importlib.util
from datetime import datetime
from pathlib import Path

import pytest

from app.models import CreditTransaction, Payment, User
from app.services import account_deletion
from app.utils import storage as storage_mod

_spec = importlib.util.spec_from_file_location(
    "cleanup_test_accounts", Path(__file__).resolve().parents[1] / "scripts" / "cleanup_test_accounts.py")
script = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(script)


@pytest.fixture(autouse=True)
def local_storage(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_mod, "FILES_ROOT", str(tmp_path))
    store = storage_mod.LocalFileStorage()
    monkeypatch.setattr(account_deletion, "get_storage", lambda: store)


@pytest.fixture
def account(db, make_user):
    def _make(username, email, credits=0, is_admin=False):
        user = make_user(credits=credits, username=username, is_admin=is_admin)
        user.email = email
        db.commit()
        db.refresh(user)
        return user
    return _make


def _live(db):
    return {u.username for u in db.query(User).filter(User.deleted_at.is_(None))}


@pytest.mark.parametrize("name,ok", [
    ("robot_mfz3k9a1", True),
    ("robot_abc", True),
    ("robot_", False),
    ("robotXabc", False),          # `_` is a LIKE wildcard: the regex must not be
    ("robot_ABC", False),
    ("robot_abc-x", False),
    ("my_robot_abc", False),
    ("robotics_fan", False),
    (None, False),
])
def test_robot_username_shape(name, ok):
    assert script.is_robot_username(name) is ok


@pytest.mark.parametrize("email,ok", [
    ("robot+mfz3k9a1@example.com", True),
    ("robot+@example.com", False),
    ("robot+abc@example.com.evil.io", False),
    ("robot+abc@example.co", False),
    ("raz+robot@example.com", False),
    ("robot@example.com", False),
    ("robot+abc@gmail.com", False),
    ("Robot+abc@example.com", False),
    (None, False),
])
def test_robot_email_shape(email, ok):
    assert script.is_robot_email(email) is ok


def test_dry_run_lists_only_robots_and_deletes_nothing(db, account, make_user):
    account("robot_aaa1", "robot+aaa1@example.com", credits=20)
    account("robot_bbb2", "robot+bbb2@example.com")
    account("robotics_fan", "fan@gmail.com")
    account("raz", "raz@example.com")      # a hand-made test account: not the robot's
    make_user(username="real_person")
    lines = []

    assert script.cleanup(db, apply=False, out=lines.append) == 2

    assert _live(db) == {"robot_aaa1", "robot_bbb2", "robotics_fan", "raz", "real_person"}
    assert sum("would delete robot_" in line for line in lines) == 2


def test_apply_deletes_robots_through_account_deletion(db, account, make_user, make_creation):
    robot = account("robot_aaa1", "robot+aaa1@example.com", credits=20)
    make_creation(robot.id)
    db.add(Payment(user_id=robot.id, provider="lemonsqueezy", provider_ref="order-9",
                   gross_usd_micros=5_000_000, fee_usd_micros=0, net_usd_micros=5_000_000,
                   status="succeeded", metadata_json={"test_mode": True}))
    db.commit()
    make_user(username="real_person", credits=7)

    assert script.cleanup(db, apply=True, out=lambda _: None) == 1

    db.expire_all()
    gone = db.query(User).filter(User.id == robot.id).one()
    assert gone.deleted_at is not None and gone.email is None and gone.credits == 0
    # Purchases stay, and the ledger still adds up to the (forfeited) balance.
    assert db.query(Payment).filter(Payment.user_id == robot.id).count() == 1
    deltas = [t.delta for t in db.query(CreditTransaction).filter(CreditTransaction.user_id == robot.id)]
    assert sum(deltas) == 0
    assert _live(db) == {"real_person"}
    # Idempotent: a second run finds nothing.
    assert script.cleanup(db, apply=True, out=lambda _: None) == 0


@pytest.mark.parametrize("username,email,is_admin", [
    ("robot_aaa1", "someone@gmail.com", False),        # robot name, a person's email
    ("someone", "robot+aaa1@example.com", False),      # robot email, a person's name
    ("robot_aaa1", None, False),                        # no email to confirm it
    ("robot_aaa1", "robot+aaa1@example.com", True),    # an admin
])
def test_refuses_and_deletes_nothing_if_any_match_is_not_the_robot(db, account, username, email, is_admin):
    account("robot_zzz9", "robot+zzz9@example.com")
    account(username, email, is_admin=is_admin)

    with pytest.raises(script.Refused):
        script.cleanup(db, apply=True, out=lambda _: None)

    assert _live(db) == {"robot_zzz9", username}


def test_keep_leaves_a_named_robot_alone(db, account):
    account("robot_aaa1", "robot+aaa1@example.com")
    account("robot_keep", "robot+keep@example.com")

    assert script.cleanup(db, apply=True, keep=["robot_keep"], out=lambda _: None) == 1
    assert _live(db) == {"robot_keep"}


def test_already_deleted_accounts_are_ignored(db, account):
    gone = account("robot_old1", "robot+old1@example.com")
    gone.deleted_at = datetime.utcnow()
    db.commit()
    assert script.cleanup(db, apply=False, out=lambda _: None) == 0


def test_main_needs_a_database(monkeypatch, capsys):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert script.main([]) == 2
