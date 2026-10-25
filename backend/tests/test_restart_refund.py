"""
A step cut off by a server restart gives its credits back.

A step is charged before its provider is called, so every way it can end badly
needs a compensating refund. A deploy (or crash) during a hero's paint or
sculpt is one: the process that would have refunded is gone, and the next one
finds the step still "processing". The startup reconciliation used to mark it
failed and keep the charge.

These tests drive the real code: the step is charged and left "processing" by
the real `pipeline.execute_step` / `run_pipeline` / class endpoint, stopped by
an exception that, like a killed process, no handler in the pipeline catches.
Then the real reconciliation runs: `reconcile_stuck_steps`, and once through the
app's own lifespan and its sweep. Remove the refund call there and they go red.
"""
import asyncio
import io
import time
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config.steps import STEPS, get_step_by_name
from app.main import app
from app.models import ClassRoom, CreationStep, CreditTransaction
from app.services import ledger, pipeline, startup_reconcile, step_errors
from app.services.startup_reconcile import RESTART_MESSAGE, reconcile_stuck_steps
from app.services.task_manager import TaskManager, get_task_manager
from app.utils.storage import get_storage


def _jpeg(tag: bytes) -> bytes:
    """A real (tiny) JPEG, `tag` after its end: an upload must be a picture
    (creations.require_picture), and each test's drawing stays its own bytes."""
    out = io.BytesIO()
    Image.new("RGB", (4, 4), (200, 30, 30)).save(out, format="JPEG")
    return out.getvalue() + tag


RENDER = get_step_by_name("openai_render")["credit_cost"]   # 2
MESHY = get_step_by_name("meshy_3d")["credit_cost"]         # 5
HERO = sum(s["credit_cost"] for s in STEPS)


class _ProcessDied(BaseException):
    """What a deploy does to a running step: nothing in the process runs after
    it. A BaseException, so no `except Exception` in the pipeline sees it -
    the step is left exactly as a SIGKILL leaves it: charged, "processing"."""


class _AllFilesExist:
    def file_exists(self, *_a, **_kw):
        return True

    def get_file_path(self, *_a, **_kw):
        return "/dev/null"


@pytest.fixture
def storage_ok(monkeypatch):
    monkeypatch.setattr(pipeline, "get_storage", lambda: _AllFilesExist())


def _steps(monkeypatch, dies_at, deliver=None):
    """Every step succeeds (via `deliver`, if given) until `dies_at`, where the
    process goes away mid-provider-call."""
    def coroutine_for(name):
        async def run(creation_id, user_id, session):
            if name == dies_at:
                raise _ProcessDied()
            if deliver:
                deliver(session, creation_id, user_id, name)
        return run
    monkeypatch.setattr(pipeline, "get_step_coroutine", coroutine_for)


def _run(coro):
    # The loop the rest of the suite uses; asyncio.run would close it.
    return asyncio.get_event_loop().run_until_complete(coro)


def _die(coro):
    with pytest.raises(_ProcessDied):
        _run(coro)


def _step(db, creation_id, name):
    db.expire_all()
    return db.query(CreationStep).filter_by(creation_id=creation_id, step_name=name).one()


def _rows(db, creation_id, reason):
    db.expire_all()
    return db.query(CreditTransaction).filter_by(creation_id=creation_id, reason=reason).all()


def _balance(db, user_id):
    db.expire_all()
    return ledger.get_balance(user_id, db)


def _consistent(db, user_id):
    check = ledger.verify_user_balance(user_id, db)
    assert check.consistent, f"cache drifted from the ledger: {check.as_dict()}"


def _as_the_endpoint_starts_it(db, creation_id, name):
    """POST /run-step and /run-pipeline mark the step processing (and stamp
    started_at) BEFORE the task runs and charges."""
    step = _step(db, creation_id, name)
    step.status = "processing"
    step.started_at = datetime.utcnow()
    db.commit()


# ---------------------------------------------------------------------------

@pytest.mark.parametrize("started_by", ["pipeline", "endpoint"])
def test_a_step_cut_off_by_a_restart_is_refunded(started_by, db, make_user, make_creation,
                                                  storage_ok, monkeypatch):
    user = make_user(credits=100)
    creation = make_creation(user.id, steps={"meshy_3d": "pending"})
    if started_by == "endpoint":
        _as_the_endpoint_starts_it(db, creation.id, "meshy_3d")
    _steps(monkeypatch, dies_at="meshy_3d")

    _die(pipeline.execute_step(creation.id, user.id, "meshy_3d", db))
    assert _balance(db, user.id) == 100 - MESHY
    assert _step(db, creation.id, "meshy_3d").status == "processing"

    counts = reconcile_stuck_steps(db)

    assert _balance(db, user.id) == 100, "the restart kept the user's credits"
    step = _step(db, creation.id, "meshy_3d")
    assert step.status == "failed" and step.error_message == RESTART_MESSAGE
    assert step.error_code == step_errors.INTERRUPTED
    assert step.metadata_json[step_errors.REFUND_KEY] == MESHY
    fields = step_errors.response_fields(step, admin=False)
    assert fields["credits_refunded"] is True
    assert fields["error_user"] == "Our sculptor was interrupted. Credits returned. Try again."
    [spend] = _rows(db, creation.id, "spend")
    [refund] = _rows(db, creation.id, "refund")
    assert refund.delta == MESHY and refund.user_id == user.id
    assert refund.external_ref == f"refund:tx:{spend.id}"
    assert refund.metadata_json["note"] == "restart"
    assert refund.metadata_json["step_name"] == "meshy_3d"
    assert counts == {"stuck": 1, "refunded": 1, "credits_refunded": MESHY}
    _consistent(db, user.id)


def test_reconciling_twice_refunds_once(db, make_user, make_creation, storage_ok, monkeypatch):
    """Two replicas starting at once, a second restart, or a restart that cut
    off the reconciliation itself between the refund and marking the step."""
    user = make_user(credits=100)
    creation = make_creation(user.id, steps={"meshy_3d": "pending"})
    _steps(monkeypatch, dies_at="meshy_3d")
    _die(pipeline.execute_step(creation.id, user.id, "meshy_3d", db))

    reconcile_stuck_steps(db)
    reconcile_stuck_steps(db)
    # Refunded, then died before the step was marked: found again next time.
    step = _step(db, creation.id, "meshy_3d")
    step.status = "processing"
    db.commit()
    reconcile_stuck_steps(db)

    assert len(_rows(db, creation.id, "refund")) == 1
    assert _balance(db, user.id) == 100
    assert _step(db, creation.id, "meshy_3d").status == "failed"
    _consistent(db, user.id)


def test_a_whole_pipeline_cut_off_refunds_only_the_step_it_was_in(db, make_user, make_creation,
                                                                   storage_ok, monkeypatch):
    """A PIPELINE_KEY task has no row of its own; the step it was inside is the
    one left processing and charged. Delivered steps stay paid; later steps were
    never charged."""
    user = make_user(credits=100)
    creation = make_creation(user.id, steps={s["name"]: "pending" for s in STEPS})
    _as_the_endpoint_starts_it(db, creation.id, STEPS[0]["name"])
    _steps(monkeypatch, dies_at="meshy_3d")

    _die(pipeline.run_pipeline(creation.id, user.id, db=db))
    assert _balance(db, user.id) == 100 - RENDER - MESHY

    reconcile_stuck_steps(db)

    assert _balance(db, user.id) == 100 - RENDER
    assert [r.metadata_json["step_name"] for r in _rows(db, creation.id, "refund")] == ["meshy_3d"]
    assert _step(db, creation.id, "openai_render").status == "completed"
    assert _step(db, creation.id, "meshy_3d").status == "failed"
    assert _step(db, creation.id, "meshy_rig").status == "pending"
    _consistent(db, user.id)


def test_a_step_never_charged_is_not_refunded(db, make_user, make_creation):
    """The endpoint marked it processing; the restart came before the charge."""
    user = make_user(credits=100)
    creation = make_creation(user.id, steps={"meshy_3d": "pending"})
    _as_the_endpoint_starts_it(db, creation.id, "meshy_3d")

    counts = reconcile_stuck_steps(db)

    assert _balance(db, user.id) == 100
    assert _rows(db, creation.id, "refund") == []
    step = _step(db, creation.id, "meshy_3d")
    assert step.status == "failed" and step.error_code == step_errors.INTERRUPTED
    # Nothing was given back, so the user is not told it was.
    assert step_errors.REFUND_KEY not in (step.metadata_json or {})
    assert step_errors.response_fields(step, admin=False)["error_user"] == "Our sculptor was interrupted. Try again."
    assert counts["refunded"] == 0


def test_an_earlier_attempts_charge_is_not_refunded(db, make_user, make_creation,
                                                    storage_ok, monkeypatch):
    """"Make it again" on a step that completed: the endpoint marks it
    processing, the restart comes before the new charge. The step's last spend
    is the delivered attempt's, and stays paid."""
    user = make_user(credits=100)
    creation = make_creation(user.id, steps={"openai_render": "pending"})
    _steps(monkeypatch, dies_at=None)
    _run(pipeline.execute_step(creation.id, user.id, "openai_render", db))
    # ...made ten minutes ago.
    [spend] = _rows(db, creation.id, "spend")
    spend.created_at = datetime.utcnow() - timedelta(minutes=10)
    db.commit()
    _as_the_endpoint_starts_it(db, creation.id, "openai_render")

    reconcile_stuck_steps(db)

    assert _balance(db, user.id) == 100 - RENDER
    assert _rows(db, creation.id, "refund") == []
    _consistent(db, user.id)


def test_a_step_this_process_is_running_is_left_alone(db, make_user, make_creation,
                                                      storage_ok, monkeypatch):
    """The sweep runs while the server serves. A hero it is making right now is
    not an orphan; only once its task is gone is the step reconciled."""
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
            timeout=60,
        )
        await asyncio.sleep(0.2)                   # charged, processing, provider "running"
        during = startup_reconcile.sweep_once(manager)
        task.cancel()                              # the process forgets it, as a kill does
        await asyncio.gather(task, return_exceptions=True)
        after = startup_reconcile.sweep_once(manager)
        return during, after

    during, after = _run(scenario())

    assert during["stuck"] == 0
    assert after == {"stuck": 1, "refunded": 1, "credits_refunded": MESHY}
    assert _balance(db, user.id) == 100
    _consistent(db, user.id)


def test_the_app_sweeps_once_the_old_process_is_gone(db, make_user, make_creation,
                                                      storage_ok, monkeypatch):
    """The lifespan the server runs on boot starts the sweep, after a delay (a
    deploy overlaps: the old process still runs its steps for a while), and
    does not touch the step before then."""
    user = make_user(credits=100)
    creation = make_creation(user.id, steps={"meshy_3d": "pending"})
    _steps(monkeypatch, dies_at="meshy_3d")
    _die(pipeline.execute_step(creation.id, user.id, "meshy_3d", db))

    monkeypatch.setattr(startup_reconcile, "SWEEP_FIRST_DELAY", 1.0)
    before = app.dependency_overrides.get(get_task_manager)
    try:
        with TestClient(app):
            assert _step(db, creation.id, "meshy_3d").status == "processing"   # not yet
            deadline = time.monotonic() + 10
            while _step(db, creation.id, "meshy_3d").status == "processing" and time.monotonic() < deadline:
                time.sleep(0.1)
    finally:
        if before is not None:
            app.dependency_overrides[get_task_manager] = before

    assert _step(db, creation.id, "meshy_3d").status == "failed"
    assert _balance(db, user.id) == 100
    _consistent(db, user.id)


# ---------------------------------------------------------------------------
# A class hero: charged to the class wallet, refunded to the class wallet.

class _Tasks:
    """Stands in for the task manager: keeps each pipeline run to run later."""

    def __init__(self):
        self.pending = []

    def running_for_creation(self, creation_id):
        return []

    def create_task(self, creation_id, key, coro, timeout=None):
        self.pending.append(coro)

    def cancel_all_tasks_for_creation(self, creation_id):
        return 0


def _deliver(session, creation_id, user_id, name):
    from sqlalchemy.orm.attributes import flag_modified
    get_storage().upload_file(user_id, creation_id, get_step_by_name(name)["output"], b"out")
    if name == "meshy_3d":
        step = session.query(CreationStep).filter_by(creation_id=creation_id, step_name=name).one()
        step.metadata_json = {"meshy_3d_task_id": "task-1"}
        flag_modified(step, "metadata_json")
        session.commit()


def _auth(user):
    from app.services.auth import create_access_token
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def test_a_class_hero_is_refunded_to_the_class_wallet(db, make_user, monkeypatch):
    from app.services import classes
    classes.reset_throttles()
    tasks = _Tasks()
    before = app.dependency_overrides.get(get_task_manager)
    app.dependency_overrides[get_task_manager] = lambda: tasks
    try:
        client = TestClient(app)
        teacher = make_user(credits=100)
        r = client.post("/api/v1/classes", json={"title": "Grade 2B", "seats": 2}, headers=_auth(teacher))
        assert r.status_code == 201, r.text
        class_id = r.json()["id"]
        r = client.post(f"/api/v1/classes/{class_id}/start", json={"minutes": 45, "approve_first": False},
                        headers=_auth(teacher))
        assert r.status_code == 200, r.text
        pin = r.json()["live"]["pin"]

        student = TestClient(app)
        assert student.post("/api/v1/class/join", json={"pin": pin, "first_name": "Maya", "age": 7}).status_code == 200
        _steps(monkeypatch, dies_at="meshy_3d", deliver=_deliver)
        r = student.post("/api/v1/class/me/hero", files={"image_file": ("d.jpg", _jpeg(b" dragon"), "image/jpeg")})
        assert r.status_code == 201, r.text
        [run] = tasks.pending
        _die(run)
    finally:
        if before is None:
            app.dependency_overrides.pop(get_task_manager, None)
        else:
            app.dependency_overrides[get_task_manager] = before

    wallet = db.query(ClassRoom).filter_by(id=class_id).one().wallet_user_id
    teacher_before = _balance(db, teacher.id)
    assert _balance(db, wallet) == 2 * HERO - RENDER - MESHY

    reconcile_stuck_steps(db)

    assert _balance(db, wallet) == 2 * HERO - RENDER, "the class wallet kept the charge"
    assert _balance(db, teacher.id) == teacher_before      # not refunded to the teacher
    [refund] = db.query(CreditTransaction).filter_by(user_id=wallet, reason="refund").all()
    assert refund.delta == MESHY
    _consistent(db, wallet)
    _consistent(db, teacher.id)
