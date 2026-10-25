"""The progress a user sees while their hero is being made.

The founder watched "Sculpting in 3D · About 5 min" sit unchanged for minutes
on a phone. Meshy reports a 0-100 progress while it works, and the pipeline's
poller already stored it on the step row; the API just never sent it. These
tests drive the real poller and the real execute_step, and read the answer back
through the real HTTP endpoints the hero screen polls, while the step is still
running.
"""
import asyncio
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app.config.steps import get_step_by_name
from app.main import app
from app.models import CreationStep
from app.services import pipeline


class _AllFilesExist:
    def file_exists(self, *_a, **_kw):
        return True

    def get_file_path(self, *_a, **_kw):
        return "/dev/null"


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(pipeline.time, "sleep", lambda *_a: None)


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _step_json(client, creation_id, step_name):
    """The stage as the hero screen sees it: from GET /api/v1/heroes/{id}.

    `provider_progress` is what the provider reported (0-100, or null);
    `typical_seconds` the step's typical length, to estimate from."""
    r = client.get(f"/api/v1/heroes/{creation_id}")
    assert r.status_code == 200, r.text
    (step,) = [s for s in r.json()["stages"] if s.get("step") == step_name]
    return step


def test_meshy_progress_reaches_the_hero_screen_while_the_task_runs(db, make_user, make_creation, client):
    user = make_user()
    creation = make_creation(user.id)
    step = CreationStep(
        creation_id=creation.id, step_name="meshy_3d",
        status="processing", started_at=datetime.utcnow(),
    )
    db.add(step)
    db.commit()

    readings = iter([
        {"status": "PENDING", "progress": None},
        {"status": "IN_PROGRESS", "progress": 12},
        {"status": "IN_PROGRESS", "progress": 37},
        {"status": "IN_PROGRESS", "progress": 82},
        {"status": "SUCCEEDED", "progress": 100, "model_urls": {"glb": "https://example.test/m.glb"}},
    ])
    seen = []

    def status_func(_task_id):
        # What the phone would have read at this moment, mid-task.
        seen.append(_step_json(client, creation.id, "meshy_3d")["provider_progress"])
        return next(readings)

    url = pipeline._poll_meshy_task_with_progress(
        "task-1", status_func, step, db, pipeline._extract_3d_download_url,
    )

    assert url == "https://example.test/m.glb"
    # Before Meshy first answers there is nothing to show; then every reading
    # lands, in order. A null from a queued task reads as 0, not a crash.
    assert seen == [None, 0, 12, 37, 82]
    single = _step_json(client, creation.id, "meshy_3d")
    assert single["provider_progress"] == 100
    assert single["typical_seconds"] == get_step_by_name("meshy_3d")["estimated_duration"]


def test_a_step_without_provider_progress_reports_none_and_when_it_started(
    db, make_user, make_creation, client, monkeypatch,
):
    """The OpenAI render reports no %: the screen gets started_at and the
    typical duration to estimate from, and no invented number."""
    user = make_user(credits=100)
    creation = make_creation(user.id, steps={"openai_render": "pending"})
    monkeypatch.setattr(pipeline, "get_storage", lambda: _AllFilesExist())
    during = {}

    async def render(*_a, **_kw):
        during.update(_step_json(client, creation.id, "openai_render"))

    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda _n: render)
    _run(pipeline.execute_step(creation.id, user.id, "openai_render", db))

    assert during["status"] == "processing"
    assert during["provider_progress"] is None
    assert during["started_at"] is not None
    assert during["typical_seconds"] == get_step_by_name("openai_render")["estimated_duration"]

    after = _step_json(client, creation.id, "openai_render")
    assert after["status"] == "completed"
    assert after["provider_progress"] == 100


def test_a_retried_step_starts_again_from_nothing(db, make_user, make_creation, client, monkeypatch):
    """A 3D step that failed at 60% must not show 60% when it is tried again."""
    user = make_user(credits=100)
    creation = make_creation(user.id)
    db.add(CreationStep(
        creation_id=creation.id, step_name="meshy_3d", status="failed",
        started_at=datetime(2026, 1, 1), estimated_progress=60, error_message="boom",
    ))
    db.commit()
    monkeypatch.setattr(pipeline, "get_storage", lambda: _AllFilesExist())
    during = {}

    async def sculpt(*_a, **_kw):
        during.update(_step_json(client, creation.id, "meshy_3d"))

    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda _n: sculpt)
    _run(pipeline.execute_step(creation.id, user.id, "meshy_3d", db))

    assert during["status"] == "processing"
    assert during["provider_progress"] is None
    assert during["started_at"] > "2026-01-02"


def test_a_step_that_never_ran_reports_its_typical_duration(db, make_user, make_creation, client):
    user = make_user()
    creation = make_creation(user.id)  # no step rows at all yet
    step = _step_json(client, creation.id, "convert_vrm")
    assert step["status"] == "pending"
    assert step["provider_progress"] is None
    assert step["typical_seconds"] == get_step_by_name("convert_vrm")["estimated_duration"]
