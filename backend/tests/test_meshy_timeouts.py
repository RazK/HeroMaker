"""
A Meshy connection that never answers must fail the step, not hang it.

Until 2026-11-23 no Meshy request or download had an HTTP timeout. A
connection that opened and then went silent blocked its worker thread for
ever, and the step's own timeout could not free it: cancelling the asyncio
task does not stop the thread it waits on. The hero stayed "processing" with
the user's credits taken.

These tests drive the REAL path: `pipeline.run_pipeline` -> `execute_step` ->
`step_meshy_3d` -> `MeshyClient` -> `requests`, against a real socket that
accepts and then says nothing. Only the timeout is shortened, so the suite
does not wait two minutes.
"""
import asyncio
import socket
import threading

import pytest

from app.config.steps import get_all_step_names
from app.models import CreationStep, CreditTransaction
from app.services import meshy, pipeline
from app.utils.storage import get_storage

MODEL_COST = 5        # app/config/steps.py
SHORT = (1, 1)        # connect, read seconds
GIVE_UP = 20          # a run that takes longer than this is hanging


class _SilentServer:
    """Accepts every connection, reads what is sent, never answers."""

    def __init__(self):
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(8)
        self.conns = []
        self._stop = threading.Event()
        threading.Thread(target=self._accept, daemon=True).start()

    @property
    def url(self):
        return f"http://127.0.0.1:{self.sock.getsockname()[1]}"

    def _accept(self):
        self.sock.settimeout(0.2)
        while not self._stop.is_set():
            try:
                conn, _ = self.sock.accept()
            except OSError:
                continue
            self.conns.append(conn)

    def close(self):
        # Closing the connections also frees a thread a broken client left
        # blocked, so a red run does not leak it into the rest of the suite.
        self._stop.set()
        for c in self.conns:
            c.close()
        self.sock.close()


@pytest.fixture
def silent():
    server = _SilentServer()
    yield server
    server.close()


@pytest.fixture
def meshy_env(monkeypatch):
    monkeypatch.setattr(meshy, "MESHY_API_KEY", "test-key")
    monkeypatch.setattr(meshy, "HTTP_TIMEOUT", SHORT, raising=False)
    monkeypatch.delenv("PIPELINE_RESULT_CACHE", raising=False)


def _run(coro):
    # wait_for only so that a hang fails this test instead of the whole suite.
    return asyncio.get_event_loop().run_until_complete(asyncio.wait_for(coro, GIVE_UP))


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


def _assert_failed_and_refunded(db, user, creation):
    step = _step(db, creation.id, "meshy_3d")
    assert step.status == "failed", "the step must end, not stay processing"
    assert _total(db, creation.id, "spend") == MODEL_COST
    assert _total(db, creation.id, "refund") == MODEL_COST, "a hero Meshy never answered for must cost nothing"
    db.refresh(user)
    assert user.credits == 100
    assert _step(db, creation.id, "meshy_rig").status == "pending"


def test_a_meshy_api_that_never_answers_fails_the_step_and_refunds(
    db, make_user, make_creation, meshy_env, silent, monkeypatch
):
    monkeypatch.setattr(meshy.MeshyClient, "BASE_URL", silent.url)
    user, creation = _hero_model_next(make_user, make_creation)

    result = _run(pipeline.run_pipeline(creation.id, user.id, from_step="meshy_3d", db=db))

    assert result["status"] == "failed"
    _assert_failed_and_refunded(db, user, creation)


def test_a_model_download_that_never_answers_fails_the_step_and_refunds(
    db, make_user, make_creation, meshy_env, silent, monkeypatch
):
    """Meshy made the model; the file server it points at goes silent."""
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
        if method == "POST":
            return _Answer({"result": "task-1"})
        return _Answer({"status": "SUCCEEDED", "progress": 100,
                        "model_urls": {"glb": f"{silent.url}/model.glb"}})

    # The API answers; only the download goes to the silent socket.
    monkeypatch.setattr(meshy.requests, "request", api)
    user, creation = _hero_model_next(make_user, make_creation)

    result = _run(pipeline.run_pipeline(creation.id, user.id, from_step="meshy_3d", db=db))

    assert result["status"] == "failed"
    _assert_failed_and_refunded(db, user, creation)
