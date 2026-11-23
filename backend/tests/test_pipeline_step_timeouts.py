"""
A step inside a full pipeline run keeps its own timeout.

Paid heroes run through `start_pipeline` -> `run_pipeline`, which until
2026-11-23 called `execute_step` with no timeout. The run as a whole had a
2-hour backstop, so a stuck provider held a paid hero, and its credits, for up
to two hours, while a single step run (TaskManager) was failed after its own
limit (app/config/steps.py: 60 s to 30 min).

A timeout cancels the step, and CancelledError is a BaseException: it never
reaches execute_step's `except Exception` refund. So the refund has to happen
where the timeout is caught. These tests drive the REAL `run_pipeline` and
`execute_step`, against the real ledger and local storage.
"""
import asyncio
import time as real_time
import types

import pytest

from app.config.steps import get_all_step_names, get_step_by_name
from app.models import CreationStep, CreditTransaction
from app.services import meshy, pipeline, step_errors
from app.utils.storage import get_storage

MODEL_COST = 5        # app/config/steps.py
GIVE_UP = 10          # a run that takes longer than this ignored the step timeout


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(asyncio.wait_for(coro, GIVE_UP))


@pytest.fixture
def short_model_timeout(monkeypatch):
    monkeypatch.setitem(get_step_by_name("meshy_3d"), "timeout", 1)
    monkeypatch.setattr(meshy, "MESHY_API_KEY", "test-key")
    monkeypatch.delenv("PIPELINE_RESULT_CACHE", raising=False)


def _hero_model_next(make_user, make_creation):
    user = make_user(credits=100)
    steps = {name: "pending" for name in get_all_step_names()}
    steps["image_processing"] = "completed"
    steps["openai_render"] = "completed"
    creation = make_creation(user.id, steps)
    get_storage().upload_file(user.id, creation.id, "rendered.png", b"\x89PNG not really a png")
    return user, creation


def _step(db, creation_id, name):
    db.expire_all()
    return db.query(CreationStep).filter(
        CreationStep.creation_id == creation_id, CreationStep.step_name == name,
    ).one()


def _total(db, creation_id, reason):
    return sum(abs(t.delta) for t in db.query(CreditTransaction).filter(
        CreditTransaction.creation_id == creation_id, CreditTransaction.reason == reason,
    ))


def test_a_stuck_step_in_a_full_run_times_out_and_is_refunded(
    db, make_user, make_creation, short_model_timeout, monkeypatch
):
    async def stuck(*_a, **_kw):
        await asyncio.sleep(60)

    real = pipeline.get_step_coroutine
    monkeypatch.setattr(pipeline, "get_step_coroutine",
                        lambda name: stuck if name == "meshy_3d" else real(name))
    user, creation = _hero_model_next(make_user, make_creation)

    result = _run(pipeline.run_pipeline(creation.id, user.id, from_step="meshy_3d", db=db))

    assert result["status"] == "failed" and result["failed_step"] == "meshy_3d"
    step = _step(db, creation.id, "meshy_3d")
    assert step.status == "failed"
    assert step.error_code == step_errors.PROVIDER_BUSY
    assert "timed out" in step.error_message
    assert _total(db, creation.id, "spend") == MODEL_COST
    assert _total(db, creation.id, "refund") == MODEL_COST, "a timed-out step kept the user's credits"
    db.refresh(user)
    assert user.credits == 100
    assert _step(db, creation.id, "meshy_rig").status == "pending", "a step after a timeout must not start"


def test_a_timed_out_model_step_stops_polling_meshy(
    db, make_user, make_creation, short_model_timeout, monkeypatch
):
    """Cancelling the step must also stop its worker thread, or it keeps
    polling Meshy (and writing progress) for up to an hour."""
    calls = []

    class _Answer:
        status_code = 200
        headers = {}
        text = ""

        def __init__(self, body):
            self._body = body

        def json(self):
            return self._body

        def raise_for_status(self):
            pass

    def api(method, url, **_kw):
        calls.append(method)
        if method == "POST":
            return _Answer({"result": "task-1"})
        return _Answer({"status": "IN_PROGRESS", "progress": 10})

    monkeypatch.setattr(meshy.requests, "request", api)
    # Poll every 50 ms instead of 3 s; only the pipeline module sees this.
    monkeypatch.setattr(pipeline, "time", types.SimpleNamespace(
        time=real_time.time, sleep=lambda _s: real_time.sleep(0.05)))
    user, creation = _hero_model_next(make_user, make_creation)

    result = _run(pipeline.run_pipeline(creation.id, user.id, from_step="meshy_3d", db=db))
    assert result["status"] == "failed"

    real_time.sleep(0.3)            # let the thread see it was abandoned
    after_timeout = len(calls)
    real_time.sleep(0.5)            # ten more polls, if it were still going
    assert len(calls) == after_timeout, "the step timed out but its thread kept polling Meshy"
    assert _total(db, creation.id, "refund") == MODEL_COST
