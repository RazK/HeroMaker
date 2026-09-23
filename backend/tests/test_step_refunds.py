"""
A pipeline step that fails must give the credits back.

These tests drive the REAL `pipeline.execute_step`. That matters: the whole
reason this bug shipped with a green suite is that nothing exercised it -
`backend/scripts/demo_purchase.py` re-implements step execution and calls
`ledger.refund_credits` itself, so it proved the ledger could refund, never that
the product did.

Measured on staging before the fix: a real Meshy failure took 5 credits from a
paying user and left them taken.
"""
import asyncio

import pytest

from app.services import ledger, pipeline
from app.services.credits import refund_last_step_charge

MESHY_COST = 5          # app/config/steps.py
RENDER_COST = 2


class _AllFilesExist:
    """Storage stand-in: every input and output file is present."""

    def file_exists(self, *_a, **_kw):
        return True

    def get_file_path(self, *_a, **_kw):
        return "/dev/null"


@pytest.fixture
def storage_ok(monkeypatch):
    monkeypatch.setattr(pipeline, "get_storage", lambda: _AllFilesExist())


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _rows(db, creation_id, reason):
    return [
        tx for tx in db.query(ledger.CreditTransaction)
        .filter(
            ledger.CreditTransaction.creation_id == creation_id,
            ledger.CreditTransaction.reason == reason,
        ).all()
    ]


def _fail_step(monkeypatch, message="provider exploded"):
    async def boom(*_a, **_kw):
        raise RuntimeError(message)
    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda _n: boom)


def _succeed_step(monkeypatch):
    async def fine(*_a, **_kw):
        return None
    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda _n: fine)


# ---------------------------------------------------------------------------

def test_provider_failure_refunds_the_step(db, make_user, make_creation, storage_ok, monkeypatch):
    """The headline case: the provider errors, the user is made whole."""
    user = make_user(credits=100)
    creation = make_creation(user.id, steps={"meshy_3d": "pending"})
    _fail_step(monkeypatch)

    with pytest.raises(RuntimeError):
        _run(pipeline.execute_step(creation.id, user.id, "meshy_3d", db))

    db.refresh(user)
    assert user.credits == 100, "the failed step's credits were not returned"

    refunds = _rows(db, creation.id, "refund")
    assert len(refunds) == 1
    assert refunds[0].delta == MESHY_COST
    assert refunds[0].metadata_json["step_name"] == "meshy_3d"
    # and the spend it reverses is named, so an admin can trace the pair
    assert refunds[0].metadata_json["refunded_tx"] == _rows(db, creation.id, "spend")[0].id

    check = ledger.verify_user_balance(user.id, db)
    assert check.consistent, f"cache drifted from the ledger: {check.as_dict()}"


def test_retrying_a_failing_step_refunds_every_attempt(db, make_user, make_creation, storage_ok, monkeypatch):
    """
    Two attempts cost twice, so they must refund twice.

    This is what an external_ref of "refund:{creation}:{step}" - the key the demo
    script uses - would get wrong: the second refund would collide with the
    first, return it, and grant nothing.
    """
    user = make_user(credits=100)
    creation = make_creation(user.id, steps={"meshy_3d": "pending"})
    _fail_step(monkeypatch)

    for _ in range(2):
        with pytest.raises(RuntimeError):
            _run(pipeline.execute_step(creation.id, user.id, "meshy_3d", db))

    db.refresh(user)
    assert len(_rows(db, creation.id, "spend")) == 2
    assert len(_rows(db, creation.id, "refund")) == 2
    assert user.credits == 100
    assert ledger.verify_user_balance(user.id, db).consistent


def test_a_successful_step_is_not_refunded(db, make_user, make_creation, storage_ok, monkeypatch):
    """Delivered work stays paid for."""
    user = make_user(credits=100)
    creation = make_creation(user.id, steps={"openai_render": "pending"})
    _succeed_step(monkeypatch)

    _run(pipeline.execute_step(creation.id, user.id, "openai_render", db))

    db.refresh(user)
    assert user.credits == 100 - RENDER_COST
    assert _rows(db, creation.id, "refund") == []


def test_user_cancellation_keeps_the_charge(db, make_user, make_creation, storage_ok, monkeypatch):
    """
    A cancel is not a provider failure: the call was already made and already
    cost us, so the charge stands. Deliberate product decision.
    """
    user = make_user(credits=100)
    creation = make_creation(user.id, steps={"meshy_3d": "pending"})

    async def cancelled_midway(creation_id, user_id, session):
        from app.models import CreationStep
        step = session.query(CreationStep).filter(
            CreationStep.creation_id == creation_id,
            CreationStep.step_name == "meshy_3d",
        ).first()
        step.status = "failed"
        step.error_message = "Step cancelled by user"
        session.commit()
        raise RuntimeError("cancelled")

    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda _n: cancelled_midway)

    with pytest.raises(RuntimeError):
        _run(pipeline.execute_step(creation.id, user.id, "meshy_3d", db))

    db.refresh(user)
    assert user.credits == 100 - MESHY_COST
    assert _rows(db, creation.id, "refund") == []


def test_failing_before_the_charge_refunds_nothing(db, make_user, make_creation, monkeypatch):
    """
    A step that never got as far as paying owes nothing back - no phantom
    refund row, and no free credits.
    """
    user = make_user(credits=100)
    creation = make_creation(user.id, steps={"meshy_3d": "pending"})

    class _NoFiles:
        def file_exists(self, *_a, **_kw):
            return False
        def get_file_path(self, *_a, **_kw):
            return "/dev/null"

    monkeypatch.setattr(pipeline, "get_storage", lambda: _NoFiles())

    with pytest.raises(ValueError):
        _run(pipeline.execute_step(creation.id, user.id, "meshy_3d", db))

    db.refresh(user)
    assert user.credits == 100
    assert _rows(db, creation.id, "spend") == []
    assert _rows(db, creation.id, "refund") == []


def test_insufficient_credits_refunds_nothing(db, make_user, make_creation, storage_ok, monkeypatch):
    """The balance guard fires before the charge, so there is nothing to undo."""
    user = make_user(credits=1)          # meshy_3d costs 5
    creation = make_creation(user.id, steps={"meshy_3d": "pending"})
    _fail_step(monkeypatch)

    with pytest.raises(ValueError):
        _run(pipeline.execute_step(creation.id, user.id, "meshy_3d", db))

    db.refresh(user)
    assert user.credits == 1
    assert _rows(db, creation.id, "refund") == []


def test_refund_is_idempotent(db, make_user, make_creation, storage_ok, monkeypatch):
    """Calling it twice for one charge must not pay the user twice."""
    user = make_user(credits=100)
    creation = make_creation(user.id, steps={"meshy_3d": "pending"})
    _fail_step(monkeypatch)

    with pytest.raises(RuntimeError):
        _run(pipeline.execute_step(creation.id, user.id, "meshy_3d", db))

    again = refund_last_step_charge(db, creation.id, "meshy_3d", note="manual retry")
    db.refresh(user)

    assert again is not None                      # returns the original row
    assert len(_rows(db, creation.id, "refund")) == 1
    assert user.credits == 100


def test_a_timed_out_step_is_refunded(db, make_user, make_creation, storage_ok, monkeypatch):
    """
    The path that bypasses the handler above.

    Cancelling the task raises CancelledError, which inherits from
    BaseException, so `except Exception` in execute_step never sees it. Without
    the refund in task_manager's timeout handler this step stays charged.
    """
    from app.services.task_manager import TaskManager

    user = make_user(credits=100)
    creation = make_creation(user.id, steps={"meshy_3d": "pending"})

    async def hangs(*_a, **_kw):
        await asyncio.sleep(30)
    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda _n: hangs)

    async def scenario():
        manager = TaskManager()
        task = manager.create_task(
            creation.id, "meshy_3d",
            pipeline.execute_step(creation.id, user.id, "meshy_3d", db, task_manager=manager),
            timeout=1,
        )
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=10)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            pass
        await asyncio.sleep(1.0)   # let the timeout handler finish its commit

    _run(scenario())

    db.expire_all()
    db.refresh(user)
    assert user.credits == 100, "a timed-out step kept the user's credits"
    assert len(_rows(db, creation.id, "refund")) == 1
