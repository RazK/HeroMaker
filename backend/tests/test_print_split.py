"""Cutting a hero into printable parts (Meshy Auto Split), admins only.

Meshy is replaced by a stand-in; everything else (routes, storage, the state
file, usage booking) is the real code.
"""
from types import SimpleNamespace

import pytest

from app.config import pricing
from app.models import CreationStep, UsageEvent
from app.services import print_split
from app.services.meshy import MeshyAPIError
from test_public_api import _bearer, _jwt, _key, client  # noqa: F401


class FakeMeshy:
    def __init__(self):
        self.created = []
        self.task = {"status": "IN_PROGRESS", "progress": 40}
        self.gone = set()  # task ids Meshy has deleted (3 days after they ended)

    def create_print_split_task(self, input_task_id, **kw):
        if input_task_id in self.gone:
            raise MeshyAPIError("Task not found")
        self.created.append({"input_task_id": input_task_id, **kw})
        return f"split-{len(self.created)}"

    def get_print_split_status(self, task_id):
        return dict(self.task, id=task_id)


@pytest.fixture
def meshy(monkeypatch):
    fake = FakeMeshy()
    monkeypatch.setattr(print_split, "MeshyClient", lambda: fake)
    monkeypatch.setattr(print_split, "_download", lambda url: f"bytes of {url}".encode())
    monkeypatch.setattr(print_split, "POLL_SECONDS", 0)
    return fake


@pytest.fixture
def hero(db, make_user, make_creation, completed_steps):
    owner = make_user()
    creation = make_creation(owner.id, completed_steps)
    step = db.query(CreationStep).filter_by(creation_id=creation.id, step_name="meshy_3d").one()
    step.metadata_json = {"meshy_3d_task_id": "img3d-42"}
    db.commit()
    return creation


def test_only_admins_may_split(client, make_user, hero, meshy):
    owner_jwt = _jwt(make_user())
    assert client.post(f"/api/v1/heroes/{hero.id}/print-split", json={}, headers=owner_jwt).status_code == 403
    key = _bearer(_key(client, make_user())["key"])
    assert client.get(f"/api/v1/heroes/{hero.id}/print-split", headers=key).status_code == 403
    assert meshy.created == []


def test_split_runs_from_the_heros_own_3d_task(client, make_user, hero, meshy):
    admin = _jwt(make_user(is_admin=True))
    url = f"/api/v1/heroes/{hero.id}/print-split"
    assert client.get(url, headers=admin).json()["status"] == "none"

    r = client.post(url, json={"connectors": True}, headers=admin)
    assert r.status_code == 202, r.text
    assert r.json()["status"] == "pending"
    assert meshy.created == [{"input_task_id": "img3d-42", "mode": "auto", "prompt": None, "connectors": True,
                              "usage": meshy.created[0]["usage"]}]

    # A second start while it runs is the same split, not a second charge.
    client.post(url, json={}, headers=admin)
    assert len(meshy.created) == 1

    assert client.get(url, headers=admin).json()["progress"] == 40

    meshy.task = {"status": "SUCCEEDED", "progress": 100, "part_count": 5,
                  "model_urls": {"glb": "https://m/parts.glb", "3mf": "https://m/parts.3mf"},
                  "alpha_thumbnail_url": "https://m/preview.png"}
    done = client.get(url, headers=admin).json()
    assert done["status"] == "succeeded" and done["part_count"] == 5
    for name, file in (("parts", "split.glb"), ("parts_3mf", "split.3mf"), ("preview", "split_preview.png")):
        assert f"/{hero.id}/{file}?v=split-1" in done["files"][name]
    assert f"/{hero.id}/opt_split.glb?v=split-1" in done["files"]["parts_view"]
    got = client.get(done["files"]["parts"].split("/api/files", 1)[1].join(["/api/files", ""]).split("?")[0])
    assert got.status_code == 200 and got.content == b"bytes of https://m/parts.glb"

    # Once it has ended, nothing asks Meshy again.
    meshy.task = {"status": "FAILED"}
    assert client.get(url, headers=admin).json()["status"] == "succeeded"


def test_a_failed_split_says_why(client, make_user, hero, meshy):
    admin = _jwt(make_user(is_admin=True))
    url = f"/api/v1/heroes/{hero.id}/print-split"
    client.post(url, json={}, headers=admin)
    meshy.task = {"status": "FAILED", "task_error": {"message": "Model has fewer than 2 parts"}}
    body = client.get(url, headers=admin).json()
    assert body["status"] == "failed" and body["error"] == "Model has fewer than 2 parts"
    # And it may be tried again.
    assert client.post(url, json={}, headers=admin).json()["status"] == "pending"
    assert len(meshy.created) == 2


def test_by_parts_needs_the_parts_named(client, make_user, hero, meshy):
    admin = _jwt(make_user(is_admin=True))
    url = f"/api/v1/heroes/{hero.id}/print-split"
    r = client.post(url, json={"mode": "by_parts"}, headers=admin)
    assert r.status_code == 400 and r.json()["detail"]["code"] == "prompt_required"
    assert client.post(url, json={"mode": "sideways"}, headers=admin).status_code == 400
    r = client.post(url, json={"mode": "by_parts", "prompt": "head, body, arms, legs"}, headers=admin)
    assert r.status_code == 202 and meshy.created[0]["prompt"] == "head, body, arms, legs"


def test_a_hero_without_a_3d_model_cannot_be_split(client, db, make_user, make_creation, meshy):
    creation = make_creation(make_user().id, {"image_processing": "completed", "openai_render": "completed"})
    r = client.post(f"/api/v1/heroes/{creation.id}/print-split", json={}, headers=_jwt(make_user(is_admin=True)))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "no_source"
    assert meshy.created == []


def test_the_routes_are_not_in_the_public_api_docs(client):
    paths = client.get("/api/v1/openapi.json").json()["paths"]
    assert not any("print-split" in p for p in paths)


def test_the_client_books_the_split_at_ten_credits(db, monkeypatch, make_user, hero):
    from app.services import meshy as meshy_module
    from app.services.usage import UsageContext

    sent = {}

    def fake_request(method, url, headers=None, json=None, **kw):
        sent.update(method=method, url=url, json=json)
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"result": "split-9"})

    monkeypatch.setattr(meshy_module.requests, "request", fake_request)
    client = meshy_module.MeshyClient(api_key="test")
    user = make_user(is_admin=True)
    task = client.create_print_split_task("img3d-42", usage=UsageContext(user_id=user.id, creation_id=hero.id,
                                                                          step_name="print_split"))
    assert task == "split-9"
    assert sent["url"].endswith("/openapi/v1/print/split")
    assert sent["json"] == {"input_task_id": "img3d-42", "mode": "auto", "target_formats": ["glb", "3mf"],
                            "layout": "assembled", "keep_texture": True, "connectors": False}
    event = db.query(UsageEvent).filter_by(provider_ref="split-9").one()
    assert event.operation == pricing.OP_MESHY_PRINT_SPLIT and event.units == 10  # Meshy credits
    assert event.cost_usd_micros == 10 * 20000  # MESHY_USD_MICROS_PER_CREDIT in conftest


def test_a_hero_older_than_meshys_three_days_says_so(client, make_user, hero, meshy):
    """Meshy deletes a task 3 days after it ends; the split cannot be made from anything else."""
    meshy.gone.add("img3d-42")
    r = client.post(f"/api/v1/heroes/{hero.id}/print-split", json={}, headers=_jwt(make_user(is_admin=True)))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "source_expired"
    assert "3 days" in r.json()["detail"]["message"]
    assert client.get(f"/api/v1/heroes/{hero.id}/print-split", headers=_jwt(make_user(is_admin=True))).json()["status"] == "none"
