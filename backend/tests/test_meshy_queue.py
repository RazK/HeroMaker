"""
A busy five minutes is not an empty account.

Meshy lets a plan run a fixed number of tasks at once (Pro: 10). Over it,
creating a task answers 429 "NoMorePendingTasks ..." and Meshy's own advice is
"Wait for one of your tasks to finish, then create the next one"
(docs.meshy.ai/en/api/rate-limits, read 2026-11-19).

Until then this was treated as "our account is out of credits": the eleventh
hero inside five minutes failed for good, and the ops alert said money we had
was gone. That is exactly what a marketing campaign does to the queue.

The pipeline tests here drive the REAL path: `pipeline.run_pipeline` ->
`execute_step` -> `step_meshy_3d` -> `MeshyClient.create_image_to_3d_task` ->
`MeshyClient._request`, against real local storage and the real ledger. Only
`requests.request` (the network) and the clock are replaced.
"""
import asyncio
import logging

import pytest
import requests

from app.config.steps import get_all_step_names
from app.models import CreationStep, CreditTransaction
from app.services import meshy, pipeline, provider_errors, step_errors
from app.utils.storage import get_storage

MODEL_COST = 5   # app/config/steps.py
QUEUE_FULL = "NoMorePendingTasks: the number of pending tasks has reached the limit of your plan"


class _Response:
    def __init__(self, status, body, headers=None):
        self.status_code = status
        self._body = body
        self.headers = headers or {}
        self.text = str(body)

    def json(self):
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.exceptions.HTTPError(str(self.status_code), response=self)


class _Meshy:
    """Stands in for the network: answers each request from a script, then
    repeats the last answer. Records what was asked."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.calls = []

    def __call__(self, method, url, **_kw):
        self.calls.append((method, url))
        answer = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        return answer


class _Clock:
    """time.sleep that returns at once and moves time.monotonic on."""

    def __init__(self):
        self.now = 1000.0
        self.slept = []

    def sleep(self, seconds):
        self.slept.append(seconds)
        self.now += seconds

    def monotonic(self):
        return self.now


@pytest.fixture
def clock(monkeypatch):
    c = _Clock()
    monkeypatch.setattr(meshy.time, "sleep", c.sleep)
    monkeypatch.setattr(meshy.time, "monotonic", c.monotonic)
    return c


@pytest.fixture
def network(monkeypatch):
    def _set(*answers):
        fake = _Meshy(*answers)
        monkeypatch.setattr(meshy.requests, "request", fake)
        return fake
    return _set


def _full():
    return _Response(429, {"message": QUEUE_FULL})


# ---------------------------------------------------------------------------
# The client
# ---------------------------------------------------------------------------

def test_a_full_queue_is_waited_for_not_failed(network, clock, caplog):
    fake = network(_full(), _full(), _Response(202, {"result": "task-1"}))
    client = meshy.MeshyClient(api_key="test")

    with caplog.at_level(logging.ERROR):
        answer = client._request("POST", "/openapi/v1/image-to-3d", json={})

    assert answer == {"result": "task-1"}
    assert len(fake.calls) == 3
    assert clock.slept == [meshy.QUEUE_RETRY_SECONDS] * 2
    assert provider_errors.ALERT_MARKER not in caplog.text
    assert meshy.QUEUE_ALERT_MARKER not in caplog.text


def test_a_queue_that_stays_full_fails_as_busy_with_one_alert(network, clock, caplog):
    fake = network(_full())
    client = meshy.MeshyClient(api_key="test")

    with caplog.at_level(logging.ERROR), pytest.raises(meshy.MeshyAPIError) as caught:
        client._request("POST", "/openapi/v1/image-to-3d", json={})

    assert not isinstance(caught.value, provider_errors.ProviderOutOfCredits)
    assert step_errors.classify(caught.value) == step_errors.PROVIDER_BUSY
    assert sum(clock.slept) <= meshy.QUEUE_WAIT_SECONDS
    assert sum(clock.slept) > meshy.QUEUE_WAIT_SECONDS - 2 * meshy.QUEUE_RETRY_SECONDS
    assert len(fake.calls) == len(clock.slept) + 1
    alerts = [r for r in caplog.records if f"{meshy.QUEUE_ALERT_MARKER} meshy" in r.getMessage()]
    assert len(alerts) == 1
    assert provider_errors.ALERT_MARKER not in caplog.text


def test_an_abandoned_request_stops_waiting_and_creates_nothing(network, clock):
    """The step was cancelled while its task waited for a slot: do not go on
    to create (and pay for) a task nobody will collect."""
    fake = network(_full(), _Response(202, {"result": "task-nobody-wants"}))
    client = meshy.MeshyClient(api_key="test")
    client.abandon()

    with pytest.raises(meshy.MeshyAPIError):
        client._request("POST", "/openapi/v1/image-to-3d", json={})

    assert len(fake.calls) == 1
    assert clock.slept == []


def test_a_requests_per_second_limit_waits_what_meshy_says(network, clock):
    fake = network(
        _Response(429, {"message": "Rate limit exceeded"}, {"Retry-After": "3"}),
        _Response(200, {"status": "IN_PROGRESS"}),
    )
    client = meshy.MeshyClient(api_key="test")

    assert client._request("GET", "/openapi/v1/image-to-3d/task-1") == {"status": "IN_PROGRESS"}
    assert clock.slept == [3.0]
    assert len(fake.calls) == 2


def test_an_empty_account_is_still_an_empty_account(network, clock, caplog):
    network(_Response(402, {"message": "Payment Required"}))
    client = meshy.MeshyClient(api_key="test")

    with caplog.at_level(logging.ERROR), pytest.raises(provider_errors.ProviderOutOfCredits):
        client._request("POST", "/openapi/v1/image-to-3d", json={})

    assert clock.slept == []
    assert "PROVIDER_OUT_OF_CREDITS meshy" in caplog.text


# ---------------------------------------------------------------------------
# The pipeline
# ---------------------------------------------------------------------------

def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _hero_model_next(db, make_user, make_creation, credits=100):
    """A hero whose painting is done; the 3D model is next."""
    user = make_user(credits=credits)
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


def _ledger(db, creation_id, reason):
    return db.query(CreditTransaction).filter(
        CreditTransaction.creation_id == creation_id,
        CreditTransaction.reason == reason,
    ).all()


@pytest.fixture
def meshy_key(monkeypatch):
    monkeypatch.setattr(meshy, "MESHY_API_KEY", "test-key")
    monkeypatch.delenv("PIPELINE_RESULT_CACHE", raising=False)


def test_the_eleventh_hero_waits_for_a_slot_and_gets_its_model(
    db, make_user, make_creation, meshy_key, network, clock, monkeypatch, caplog
):
    user, creation = _hero_model_next(db, make_user, make_creation)
    fake = network(_full(), _full(), _full(), _Response(202, {"result": "task-11"}))

    # Past the create call the rest of the step (poll, download) is not what
    # this is about: stop the run once the task exists.
    collected = []

    def _collect(task_id, *_a, **_kw):
        collected.append(task_id)
        raise meshy.MeshyAPIError("stop here: the task was created")

    monkeypatch.setattr(pipeline, "execute_meshy_3d_sync", _collect)

    with caplog.at_level(logging.ERROR):
        _run(pipeline.run_pipeline(creation.id, user.id, from_step="meshy_3d", db=db))

    assert collected == ["task-11"], "the model task was never created after the wait"
    assert len(fake.calls) == 4
    assert clock.slept == [meshy.QUEUE_RETRY_SECONDS] * 3
    assert "out of credits" not in caplog.text
    assert provider_errors.ALERT_MARKER not in caplog.text


def test_a_queue_that_never_frees_fails_as_busy_and_refunds_the_step(
    db, make_user, make_creation, meshy_key, network, clock, caplog
):
    user, creation = _hero_model_next(db, make_user, make_creation)
    network(_full())

    with caplog.at_level(logging.ERROR):
        _run(pipeline.run_pipeline(creation.id, user.id, from_step="meshy_3d", db=db))

    step = _step(db, creation.id, "meshy_3d")
    assert step.status == "failed"
    assert step.error_code == step_errors.PROVIDER_BUSY
    assert "out of credits" not in (step.error_message or "")
    assert provider_errors.ALERT_MARKER not in caplog.text

    spent = sum(-t.delta for t in _ledger(db, creation.id, "spend"))
    refunded = sum(t.delta for t in _ledger(db, creation.id, "refund"))
    assert spent == MODEL_COST
    assert refunded == MODEL_COST, "a hero that never got a slot must cost nothing"
    assert _step(db, creation.id, "meshy_rig").status == "pending"
