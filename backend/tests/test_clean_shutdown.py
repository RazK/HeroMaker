"""
A deploy shuts the backend down cleanly, and a step it cuts off is refunded
at once.

Railway sends SIGTERM to the old process. Uvicorn (now exec'd as PID 1, see
backend/Dockerfile) drains its requests and runs the app's lifespan shutdown,
which cancels this process's tasks. A cancelled step raises CancelledError,
a BaseException, which no `except Exception` refund in the pipeline sees.
Until the shutdown made it whole, the step sat "processing" and charged until
the next process's sweep (startup_reconcile), minutes later.

These drive the real code: the app's own lifespan and TaskManager (no stand-in)
through `with TestClient(app)`, the real endpoints, `run_pipeline` and
`execute_step`. Only the provider calls are replaced, by ones that deliver or
that hang until cancelled, as a slow Meshy job does. The last test runs the
backend image's real CMD and sends it SIGTERM.
"""
import asyncio
import io
import json
import os
import re
import signal
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config.steps import get_step_by_name
from app.main import app
from app.models import CreationStep, CreditTransaction
from app.services import ledger, pipeline, step_errors
from app.services.auth import create_access_token
from app.services.startup_reconcile import RESTART_MESSAGE, SHUTDOWN_NOTE, reconcile_stuck_steps
from app.services.task_manager import get_task_manager
from app.utils.storage import get_storage

RENDER = get_step_by_name("openai_render")["credit_cost"]   # 2
MESHY = get_step_by_name("meshy_3d")["credit_cost"]         # 5

def _jpeg(tag: bytes) -> bytes:
    """A real (tiny) JPEG, `tag` after its end: an upload must be a picture
    (creations.require_picture), and each test's drawing stays its own bytes."""
    out = io.BytesIO()
    Image.new("RGB", (4, 4), (200, 30, 30)).save(out, format="JPEG")
    return out.getvalue() + tag


DRAWING = _jpeg(b" a crayon dragon")
BACKEND = Path(__file__).resolve().parent.parent


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _step(db, creation_id, name):
    db.expire_all()
    return db.query(CreationStep).filter_by(creation_id=creation_id, step_name=name).one()


def _balance(db, user_id):
    db.expire_all()
    return ledger.get_balance(user_id, db)


def _refunds(db, creation_id):
    db.expire_all()
    return db.query(CreditTransaction).filter_by(creation_id=creation_id, reason="refund").all()


def _wait_for(check, what, timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(0.05)
    raise AssertionError(f"timed out waiting for {what}")


def _providers(monkeypatch, hangs_at):
    """Every step delivers its output, except `hangs_at`, whose provider call
    is still out when the shutdown comes."""
    def coroutine_for(name):
        async def run(creation_id, user_id, session):
            if name == hangs_at:
                await asyncio.sleep(3600)
            get_storage().upload_file(user_id, creation_id, get_step_by_name(name)["output"], b"out")
        return run
    monkeypatch.setattr(pipeline, "get_step_coroutine", coroutine_for)


@pytest.fixture
def real_lifespan():
    """The app's TaskManager, not any module's stand-in."""
    before = app.dependency_overrides.pop(get_task_manager, None)
    try:
        yield
    finally:
        if before is not None:
            app.dependency_overrides[get_task_manager] = before


@pytest.mark.parametrize("started_by", ["run-pipeline", "run-step"])
def test_a_step_cut_off_by_shutdown_is_refunded_at_once(started_by, db, make_user, real_lifespan,
                                                         monkeypatch):
    user = make_user(credits=100)
    hangs_at = "meshy_3d" if started_by == "run-pipeline" else "openai_render"
    _providers(monkeypatch, hangs_at)
    cost = get_step_by_name(hangs_at)["credit_cost"]
    paid_before = RENDER if hangs_at == "meshy_3d" else 0

    with TestClient(app) as client:
        r = client.post("/api/creations/create", files={"image_file": ("d.jpg", DRAWING, "image/jpeg")},
                        headers=_auth(user))
        assert r.status_code == 201, r.text
        creation_id = r.json()["id"]
        if started_by == "run-pipeline":
            r = client.post(f"/api/creations/{creation_id}/run-pipeline", headers=_auth(user))
        else:
            get_storage().upload_file(user.id, creation_id, "processed.jpg", b"processed")
            r = client.post(f"/api/creations/{creation_id}/steps/{hangs_at}/run", headers=_auth(user))
        assert r.status_code == 200, r.text

        # The provider call is out: the step is charged and "processing".
        _wait_for(lambda: _balance(db, user.id) == 100 - paid_before - cost, "the step's charge")
        assert _step(db, creation_id, hangs_at).status == "processing"
    # Leaving the block is the SIGTERM: uvicorn runs the lifespan shutdown.

    step = _step(db, creation_id, hangs_at)
    assert step.status == "failed"
    assert step.error_code == step_errors.INTERRUPTED
    assert step.error_message == RESTART_MESSAGE
    assert step.metadata_json[step_errors.REFUND_KEY] == cost
    [refund] = _refunds(db, creation_id)
    assert refund.delta == cost and refund.metadata_json["note"] == SHUTDOWN_NOTE
    assert _balance(db, user.id) == 100 - paid_before        # a delivered render stays paid
    assert ledger.verify_user_balance(user.id, db).consistent
    # The steps after it were never started, never charged.
    if hangs_at == "meshy_3d":
        assert _step(db, creation_id, "meshy_rig").status == "pending"

    # The next process's sweep finds nothing to do: refunded once, not twice.
    assert reconcile_stuck_steps(db)["stuck"] == 0
    assert len(_refunds(db, creation_id)) == 1
    assert _balance(db, user.id) == 100 - paid_before


def test_shutdown_leaves_the_other_processes_steps_alone(db, make_user, make_creation, real_lifespan):
    """A deploy overlaps: the new process is running its own steps while the
    old one shuts down. Those are "processing" too, and are not the old
    process's to fail."""
    user = make_user(credits=100)
    theirs = make_creation(user.id, steps={"meshy_3d": "processing"})
    with TestClient(app):
        pass
    assert _step(db, theirs.id, "meshy_3d").status == "processing"


def test_a_step_refunded_but_not_marked_is_refunded_once(db, make_user, real_lifespan, monkeypatch):
    """The shutdown cut off between its refund and its mark (here the mark
    fails; a SIGKILL there is the same): the step is still "processing", the
    next process's sweep finds it again, and pays nothing more."""
    user = make_user(credits=100)
    _providers(monkeypatch, "openai_render")

    def mark_fails(*_a, **_kw):
        raise RuntimeError("killed before the mark")

    with TestClient(app) as client:
        r = client.post("/api/creations/create", files={"image_file": ("d.jpg", DRAWING, "image/jpeg")},
                        headers=_auth(user))
        creation_id = r.json()["id"]
        get_storage().upload_file(user.id, creation_id, "processed.jpg", b"processed")
        assert client.post(f"/api/creations/{creation_id}/steps/openai_render/run",
                           headers=_auth(user)).status_code == 200
        _wait_for(lambda: _balance(db, user.id) == 100 - RENDER, "the step's charge")
        monkeypatch.setattr(step_errors, "mark_failed", mark_fails)
    monkeypatch.undo()

    assert _step(db, creation_id, "openai_render").status == "processing"
    assert _balance(db, user.id) == 100
    reconcile_stuck_steps(db)
    step = _step(db, creation_id, "openai_render")
    assert step.status == "failed" and step.error_code == step_errors.INTERRUPTED
    assert len(_refunds(db, creation_id)) == 1
    assert _balance(db, user.id) == 100
    assert ledger.verify_user_balance(user.id, db).consistent


# ---------------------------------------------------------------------------
# The image's own CMD gets the SIGTERM

def _dockerfile_cmd(path):
    """The exec-form CMD of a Dockerfile, as Docker would run it."""
    text = Path(path).read_text()
    joined = re.sub(r"\\\n", " ", text)
    [line] = [l for l in joined.splitlines() if l.startswith("CMD ")]
    return json.loads(line[len("CMD "):])


def test_every_python_service_execs_uvicorn_with_a_graceful_timeout():
    for dockerfile in (BACKEND / "Dockerfile", BACKEND.parent / "vrm-converter-service" / "Dockerfile"):
        cmd = _dockerfile_cmd(dockerfile)          # exec form: no extra shell above it
        script = cmd[-1]
        runs = re.findall(r"(\S+ )?uvicorn ", script)
        assert runs and all(r == "exec " for r in runs), f"{dockerfile}: every uvicorn must be exec'd"
        assert "--timeout-graceful-shutdown" in script, dockerfile
        assert "--reload" in script, f"{dockerfile}: DEBUG=true still reloads"


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX signals")
def test_the_backend_image_cmd_shuts_down_cleanly_on_sigterm(tmp_path):
    """Run backend/Dockerfile's CMD as the container would (the process we
    start is PID 1's stand-in), SIGTERM it as Railway does, and see the
    lifespan shutdown run. Under the old `sh -c` with no exec, the shell took
    the signal and uvicorn never heard it."""
    cmd = _dockerfile_cmd(BACKEND / "Dockerfile")
    port = _free_port()
    env = {
        **os.environ,
        "PATH": f"{Path(sys.executable).parent}{os.pathsep}{os.environ.get('PATH', '')}",
        "PORT": str(port),
        "DEBUG": "false",
        "DATABASE_URL": f"sqlite:///{tmp_path}/shutdown.db",
        "FILES_ROOT": str(tmp_path / "files"),
        "PYTHONUNBUFFERED": "1",
    }
    proc = subprocess.Popen(cmd, cwd=BACKEND, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True)
    try:
        deadline = time.monotonic() + 60
        while True:
            assert proc.poll() is None, proc.stdout.read()
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1)
                break
            except OSError:
                assert time.monotonic() < deadline, "backend never became healthy"
                time.sleep(0.2)
        proc.send_signal(signal.SIGTERM)
        out, _ = proc.communicate(timeout=30)
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.communicate()
    assert "Shutdown interrupted running steps" in out, out
    assert "Shutdown complete" in out, out
    # Uvicorn re-raises the signal once it has shut down, so the exit status
    # says "terminated by SIGTERM", as Railway expects.
    assert proc.returncode in (0, -signal.SIGTERM), out
