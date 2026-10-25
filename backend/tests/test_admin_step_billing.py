"""Support reads what a failed step cost and whether it came back.

"3D failed · refunded 5" on the admin's tile and hero screen comes from the
ledger (credits.step_billing), not the step's refund marker: the marker is
newer than many refunds, and a hero failed before it read "not refunded" while
its credits had come back (staging, 2026-10-20). These tests fail a step
through the REAL pipeline.execute_step, which charges and refunds.
"""
import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm.attributes import flag_modified

from app.main import app
from app.models import CreationStep
from app.services import pipeline
from app.services.auth import create_access_token

MESHY_COST = 5


class _AllFilesExist:
    def file_exists(self, *_a, **_kw):
        return True

    def get_file_path(self, *_a, **_kw):
        return "/dev/null"


@pytest.fixture
def storage_ok(monkeypatch):
    monkeypatch.setattr(pipeline, "get_storage", lambda: _AllFilesExist())


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _fail(monkeypatch, db, creation, user, step="meshy_3d"):
    async def boom(*_a, **_kw):
        raise RuntimeError("provider exploded")
    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda _n: boom)
    with pytest.raises(RuntimeError):
        asyncio.get_event_loop().run_until_complete(pipeline.execute_step(creation.id, user.id, step, db))


def _step(view, name):
    return next(s for s in view["steps"] if s["step_name"] == name)


def _stage(hero, step_name):
    """A stage of the API's hero object, by its pipeline step."""
    return next(s for s in hero["stages"] if s.get("step") == step_name)


def test_support_sees_a_failed_step_refunded(db, make_user, make_creation, storage_ok, monkeypatch, completed_steps):
    owner = make_user(credits=100)
    admin = make_user(username="support", is_admin=True)
    creation = make_creation(owner.id, {"image_processing": "completed", "openai_render": "completed", "meshy_3d": "pending"})
    _fail(monkeypatch, db, creation, owner)
    client = TestClient(app)

    page = client.get(f"/api/v1/admin/users/{owner.id}", headers=_auth(admin)).json()
    step = _step(next(h for h in page["heroes"] if h["id"] == creation.id), "meshy_3d")
    assert (step["charged_credits"], step["refunded_credits"], step["credits_refunded"]) == (MESHY_COST, MESHY_COST, True)
    # The hero's own page, opened by the admin, says the same.
    stage = _stage(client.get(f"/api/v1/heroes/{creation.id}", headers=_auth(admin)).json(), "meshy_3d")
    assert (stage["charged_credits"], stage["error"]["refunded_credits"]) == (MESHY_COST, MESHY_COST)
    # Nobody else gets the ledger's view.
    stage = _stage(client.get(f"/api/v1/heroes/{creation.id}", headers=_auth(owner)).json(), "meshy_3d")
    assert stage["charged_credits"] is None


def test_a_refund_from_before_the_marker_still_reads_refunded(db, make_user, make_creation, storage_ok, monkeypatch):
    owner = make_user(credits=100)
    admin = make_user(username="support2", is_admin=True)
    creation = make_creation(owner.id, {"meshy_3d": "pending"})
    _fail(monkeypatch, db, creation, owner)
    # As every hero failed before note_refund existed: no marker on the step.
    row = db.query(CreationStep).filter_by(creation_id=creation.id, step_name="meshy_3d").one()
    row.metadata_json = {}
    flag_modified(row, "metadata_json")
    db.commit()

    page = TestClient(app).get(f"/api/v1/admin/users/{owner.id}", headers=_auth(admin)).json()
    step = _step(page["heroes"][0], "meshy_3d")
    assert step["credits_refunded"] is True and step["refunded_credits"] == MESHY_COST


def test_a_step_that_never_got_its_charge_reads_nothing_charged(db, make_user, make_creation, storage_ok, monkeypatch):
    owner = make_user(credits=0)   # cannot pay: execute_step fails before charging
    admin = make_user(username="support3", is_admin=True)
    creation = make_creation(owner.id, {"meshy_3d": "pending"})
    with pytest.raises(ValueError):
        asyncio.get_event_loop().run_until_complete(pipeline.execute_step(creation.id, owner.id, "meshy_3d", db))

    page = TestClient(app).get(f"/api/v1/admin/users/{owner.id}", headers=_auth(admin)).json()
    step = _step(page["heroes"][0], "meshy_3d")
    assert step["status"] == "failed" and step["charged_credits"] == 0 and step["credits_refunded"] is False
