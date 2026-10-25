"""
When a step fails, the run stops there, and the user ends where they started.

Found on staging, 2026-10-13: the OpenAI account ran dry. openai_render failed
with a 429 stored as "rate limit exceeded", and within a second meshy_3d,
meshy_rig and convert_vrm had each started and failed on "Input file not found".

These drive the REAL code path: `pipeline.run_pipeline` -> `execute_step` ->
`step_openai_render` -> `openai.render_image`, against real local storage and
the real ledger. Only the network call itself (OpenAI's images.edit) is
replaced, by one that raises the exact error OpenAI sent.
"""
import asyncio
import importlib
import logging

import pytest
from fastapi import HTTPException

from app.api import creations as creations_api
from app.config.steps import get_all_step_names
from app.models import CreationStep, CreditTransaction
from app.services import ledger, meshy, pipeline, provider_errors
from app.services import openai as openai_service
from app.utils.storage import get_storage

RENDER_COST = 2   # app/config/steps.py

try:   # the OpenAI SDK's HTTP client, under whichever name this version ships
    _http = importlib.import_module("httpx2")
except ImportError:   # pragma: no cover
    _http = importlib.import_module("httpx")


def _openai_429(message: str, code: str):
    import openai
    body = {"error": {"message": message, "type": code, "code": code}}
    response = _http.Response(
        429, request=_http.Request("POST", "https://api.openai.com/v1/images/edits")
    )
    return openai.RateLimitError(f"Error code: 429 - {body}", response=response, body=body)


OUT_OF_CREDITS = _openai_429(
    "You have no credits remaining. Add credits to continue.", "insufficient_quota"
)
REAL_RATE_LIMIT = _openai_429(
    "Rate limit reached for gpt-image-1 on requests per min.", "rate_limit_exceeded"
)


class _OpenAIRaising:
    """Stands in for openai.OpenAI: images.edit raises the given error."""

    def __init__(self, error):
        self._error = error

    def __call__(self, *_a, **_kw):
        error = self._error

        class _Images:
            def edit(self, **_kw):
                raise error

        class _Client:
            images = _Images()

        return _Client()


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _hero_painting_next(db, make_user, make_creation, credits=100):
    """A hero whose drawing has been read; the painting is next."""
    user = make_user(credits=credits)
    steps = {name: "pending" for name in get_all_step_names()}
    steps["image_processing"] = "completed"
    creation = make_creation(user.id, steps)
    get_storage().upload_file(user.id, creation.id, "processed.jpg", b"\xff\xd8 not really a jpeg")
    return user, creation


def _steps(db, creation_id):
    db.expire_all()
    return {
        s.step_name: s for s in db.query(CreationStep)
        .filter(CreationStep.creation_id == creation_id).all()
    }


def _ledger(db, creation_id, reason):
    return db.query(CreditTransaction).filter(
        CreditTransaction.creation_id == creation_id,
        CreditTransaction.reason == reason,
    ).all()


@pytest.fixture
def openai_raises(monkeypatch):
    monkeypatch.setattr(openai_service, "OPENAI_API_KEY", "sk-test")

    def _set(error):
        monkeypatch.setattr(openai_service, "OpenAI", _OpenAIRaising(error))
    return _set


# ---------------------------------------------------------------------------
# Fail fast
# ---------------------------------------------------------------------------

def test_a_failed_step_stops_the_run_and_the_user_is_made_whole(
    db, make_user, make_creation, openai_raises, monkeypatch
):
    user, creation = _hero_painting_next(db, make_user, make_creation)
    openai_raises(OUT_OF_CREDITS)

    # Anything after the painting being started at all is the bug.
    started_later = []
    for name in ("meshy_3d", "meshy_rig", "convert_vrm"):
        async def _never(*_a, _name=name, **_kw):
            started_later.append(_name)
        monkeypatch.setitem(pipeline.STEP_COROUTINES, name, _never)

    result = _run(pipeline.run_pipeline(creation.id, user.id, from_step="openai_render", db=db))

    assert result["status"] == "failed"
    assert result["failed_step"] == "openai_render"
    assert started_later == [], f"steps ran after the failure: {started_later}"

    steps = _steps(db, creation.id)
    assert steps["openai_render"].status == "failed"
    for name in ("meshy_3d", "meshy_rig", "convert_vrm"):
        assert steps[name].status == "pending", f"{name} is {steps[name].status}"
        assert steps[name].started_at is None
        assert steps[name].error_message is None

    # Charged for the painting only, then refunded: back where it started.
    spends = _ledger(db, creation.id, "spend")
    assert [(t.metadata_json or {}).get("step_name") for t in spends] == ["openai_render"]
    assert [t.delta for t in spends] == [-RENDER_COST]
    refunds = _ledger(db, creation.id, "refund")
    assert [t.delta for t in refunds] == [RENDER_COST]
    db.refresh(user)
    assert user.credits == 100
    assert ledger.verify_user_balance(user.id, db).consistent


def test_a_rerun_clears_stale_failures_left_by_an_earlier_attempt(
    db, make_user, make_creation, openai_raises
):
    """The staging heroes carried a row of "Input file not found" from the
    concurrent retry. A fresh run from the failed step must not show them."""
    user, creation = _hero_painting_next(db, make_user, make_creation)
    for s in db.query(CreationStep).filter(CreationStep.creation_id == creation.id):
        if s.step_name != "image_processing":
            s.status = "failed"
            s.error_message = "Input file not found: whatever"
    db.commit()
    openai_raises(OUT_OF_CREDITS)

    _run(pipeline.run_pipeline(creation.id, user.id, from_step="openai_render", db=db))

    steps = _steps(db, creation.id)
    assert steps["openai_render"].status == "failed"
    assert [steps[n].status for n in ("meshy_3d", "meshy_rig", "convert_vrm")] == ["pending"] * 3


def test_a_step_whose_input_is_missing_is_never_charged(db, make_user, make_creation):
    """Inputs are checked BEFORE the charge, so there is nothing to refund."""
    user = make_user(credits=100)
    creation = make_creation(user.id, {"meshy_3d": "pending"})

    with pytest.raises(ValueError, match="Input file not found: rendered.png"):
        _run(pipeline.execute_step(creation.id, user.id, "meshy_3d", db))

    db.refresh(user)
    assert user.credits == 100
    assert _ledger(db, creation.id, "spend") == []
    assert _ledger(db, creation.id, "refund") == []


# ---------------------------------------------------------------------------
# Naming the error honestly
# ---------------------------------------------------------------------------

def test_openai_out_of_credits_is_named_service_unavailable_and_alerts(
    db, make_user, make_creation, openai_raises, caplog
):
    user, creation = _hero_painting_next(db, make_user, make_creation)
    openai_raises(OUT_OF_CREDITS)

    with caplog.at_level(logging.ERROR):
        _run(pipeline.run_pipeline(creation.id, user.id, from_step="openai_render", db=db))

    message = _steps(db, creation.id)["openai_render"].error_message
    assert message.startswith("OpenAI service unavailable: our account is out of credits")
    assert "rate limit exceeded" not in message.lower()
    assert "no credits remaining" in message          # the provider's words, for admins

    alerts = [r for r in caplog.records
              if r.levelno == logging.ERROR and "PROVIDER_OUT_OF_CREDITS openai" in r.getMessage()]
    assert len(alerts) == 1


def test_a_real_openai_rate_limit_is_still_a_rate_limit(
    db, make_user, make_creation, openai_raises, caplog
):
    user, creation = _hero_painting_next(db, make_user, make_creation)
    openai_raises(REAL_RATE_LIMIT)

    with caplog.at_level(logging.ERROR):
        _run(pipeline.run_pipeline(creation.id, user.id, from_step="openai_render", db=db))

    message = _steps(db, creation.id)["openai_render"].error_message
    assert message.startswith("OpenAI API rate limit exceeded")
    assert provider_errors.ALERT_MARKER not in caplog.text


@pytest.mark.parametrize("status, text, out", [
    (402, "Payment Required", True),
    (400, "NoMorePendingTasks", True),
    (429, "Too many requests", False),
    (500, "Internal error", False),
])
def test_meshy_out_of_credits_is_recognised(status, text, out, caplog):
    class _Response:
        status_code = status

        def json(self):
            return {"message": text}

        def raise_for_status(self):
            import requests
            raise requests.exceptions.HTTPError(f"{status}", response=self)

    client = meshy.MeshyClient(api_key="test")
    import app.services.meshy as m
    original = m.requests.request
    m.requests.request = lambda *a, **kw: _Response()
    try:
        with caplog.at_level(logging.ERROR), pytest.raises(meshy.MeshyAPIError) as caught:
            client._request("POST", "/openapi/v1/image-to-3d")
    finally:
        m.requests.request = original

    assert isinstance(caught.value, provider_errors.ProviderOutOfCredits) is out
    assert ("PROVIDER_OUT_OF_CREDITS meshy" in caplog.text) is out
    if out:
        assert str(caught.value).startswith("Meshy service unavailable")


# ---------------------------------------------------------------------------
# One run per hero at a time
# ---------------------------------------------------------------------------

class _Tasks:
    def __init__(self, running):
        self._running = running

    def running_for_creation(self, _creation_id):
        return list(self._running)


def test_a_step_cannot_start_while_another_step_of_the_hero_runs(db, make_user, make_creation):
    """What "Try again" did on staging: it fired every unfinished step at once."""
    user = make_user()
    creation = make_creation(user.id, {"openai_render": "processing", "meshy_3d": "failed"})
    db.refresh(creation)

    with pytest.raises(HTTPException) as caught:
        creations_api._refuse_if_busy(creation, _Tasks(["openai_render"]), except_step="meshy_3d")
    assert caught.value.status_code == 400


def test_a_second_pipeline_start_is_refused_before_any_step_has_started(db, make_user, make_creation):
    """A double tap on Go: the first run's task exists, no step is processing yet."""
    user = make_user()
    creation = make_creation(user.id, {n: "pending" for n in get_all_step_names()})
    db.refresh(creation)

    with pytest.raises(HTTPException):
        creations_api._refuse_if_busy(creation, _Tasks(["pipeline"]))
    creations_api._refuse_if_busy(creation, _Tasks([]))   # idle: allowed


def test_a_timed_out_pipeline_run_refunds_the_step_it_was_inside(
    db, make_user, make_creation, monkeypatch
):
    """The pipeline task is tracked as "pipeline", which has no step row. Its
    timeout used to find nothing to mark, leaving the step charged and stuck."""
    from app.services.task_manager import TaskManager, PIPELINE_KEY

    user, creation = _hero_painting_next(db, make_user, make_creation)

    async def hangs(*_a, **_kw):
        await asyncio.sleep(30)
    monkeypatch.setitem(pipeline.STEP_COROUTINES, "openai_render", hangs)

    async def scenario():
        manager = TaskManager()
        task = manager.create_task(
            creation.id, PIPELINE_KEY,
            pipeline.run_pipeline(creation.id, user.id, from_step="openai_render", db=db),
            timeout=1,
        )
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=10)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            pass
        await asyncio.sleep(0.5)

    _run(scenario())

    steps = _steps(db, creation.id)
    assert steps["openai_render"].status == "failed"
    assert "timed out" in steps["openai_render"].error_message
    db.refresh(user)
    assert user.credits == 100
    assert len(_ledger(db, creation.id, "refund")) == 1


# ---------------------------------------------------------------------------
# The endpoints, end to end through FastAPI
# ---------------------------------------------------------------------------

class _RecordingTasks:
    """A task manager that records what it was asked to start and runs nothing."""

    def __init__(self):
        self.started = []

    def running_for_creation(self, creation_id):
        return [name for cid, name in self.started if cid == creation_id]

    def is_running(self, creation_id, step_name):
        return (creation_id, step_name) in self.started

    def create_task(self, creation_id, step_name, coro, timeout=None):
        coro.close()
        self.started.append((creation_id, step_name))


@pytest.fixture
def api(db):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.services.task_manager import get_task_manager

    tasks = _RecordingTasks()
    previous = app.dependency_overrides.get(get_task_manager)
    app.dependency_overrides[get_task_manager] = lambda: tasks
    try:
        yield TestClient(app), tasks
    finally:
        if previous is None:
            app.dependency_overrides.pop(get_task_manager, None)
        else:
            app.dependency_overrides[get_task_manager] = previous


def _auth(user):
    from app.services.auth import create_access_token
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def test_try_again_shows_the_run_started_and_a_second_tap_is_refused(
    db, make_user, make_creation, api
):
    client, tasks = api
    user = make_user(credits=100)
    steps = {name: "failed" for name in get_all_step_names()}
    steps["image_processing"] = "completed"
    creation = make_creation(user.id, steps)
    url = f"/api/v1/heroes/{creation.id}/start"
    try_again = {"from_stage": "painting"}

    first = client.post(url, json=try_again, headers=_auth(user))
    assert first.status_code == 202, first.text
    # The answer itself already reads "making".
    assert first.json()["status"] == "processing"

    # Read right after the answer, the hero is already "making" - not "failed",
    # which the app would stop polling and leave on screen.
    shown = client.get(f"/api/v1/heroes/{creation.id}", headers=_auth(user)).json()
    assert shown["status"] == "processing" and shown["error"] is None
    by_name = {s["step"]: s["status"] for s in shown["stages"] if s.get("step")}
    assert by_name["openai_render"] == "processing"
    assert [by_name[n] for n in ("meshy_3d", "meshy_rig", "convert_vrm")] == ["pending"] * 3

    assert client.post(url, json=try_again, headers=_auth(user)).status_code == 400
    one_step = client.post(f"/api/v1/heroes/{creation.id}/stages/model/run", headers=_auth(user))
    assert one_step.status_code == 400
    assert tasks.started == [(creation.id, "pipeline")]
