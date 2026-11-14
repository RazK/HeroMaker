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
from app.utils.storage import get_storage
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


# -- Hi3D: jointed parts from our own model, any age -------------------------

def _two_part_glb() -> bytes:
    """A real GLB: two triangles as two mesh nodes, the second moved up 1 m."""
    import json
    import struct

    import numpy as np

    pos = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], dtype=np.float32).tobytes()
    idx = np.array([0, 1, 2], dtype=np.uint16).tobytes() + b"\0\0"
    blob = pos + idx
    js = {
        "asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [0, 1]}],
        "nodes": [{"mesh": 0, "name": "body"}, {"mesh": 0, "name": "head", "translation": [0, 1, 0]}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"},
                      {"bufferView": 1, "componentType": 5123, "count": 3, "type": "SCALAR"}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 36},
                        {"buffer": 0, "byteOffset": 36, "byteLength": 6}],
        "buffers": [{"byteLength": len(blob)}],
    }
    j = json.dumps(js).encode()
    j += b" " * (-len(j) % 4)
    body = struct.pack("<II", len(j), 0x4E4F534A) + j + struct.pack("<II", len(blob), 0x004E4942) + blob
    return struct.pack("<III", 0x46546C67, 2, 12 + len(body)) + body


class FakeHi3d:
    def __init__(self):
        self.created = []
        self.task = {"state": "processing"}

    def create_character_split(self, **kw):
        self.created.append(kw)
        return f"hi3d-{len(self.created)}"

    def get_split(self, task_id):
        return dict(self.task, task_id=task_id)


@pytest.fixture
def hi3d(monkeypatch, meshy):
    from app.services import hi3d as hi3d_module

    fake = FakeHi3d()
    monkeypatch.setattr(hi3d_module, "Hi3dClient", lambda: fake)
    glb = _two_part_glb()
    monkeypatch.setattr(print_split, "_download", lambda url: glb if url.endswith(".glb") else b"png")
    return fake


def test_hi3d_splits_our_own_model_with_ball_joints_at_any_age(client, make_user, hero, meshy, hi3d):
    import io
    import zipfile

    get_storage().upload_file(hero.user_id, hero.id, "model.glb", b"glTF our model", content_type="model/gltf-binary")
    meshy.gone.add("img3d-42")  # Meshy forgot this hero long ago; Hi3D does not care
    admin = _jwt(make_user(is_admin=True))
    url = f"/api/v1/heroes/{hero.id}/print-split"

    r = client.post(url, json={"provider": "hi3d", "part": "a", "joint": "ball"}, headers=admin)
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["provider"] == "hi3d" and body["joint"] == "ball" and body["part_count"] == 6
    sent = hi3d.created[0]
    assert sent["part"] == "a" and sent["joint"] == "ball" and sent["merge"] is True
    assert sent.get("mesh") == b"glTF our model" or sent.get("mesh_url", "").startswith("http")
    assert meshy.created == []

    assert client.get(url, headers=admin).json()["status"] == "in_progress"

    hi3d.task = {"state": "success", "url": "https://hi3d/parts.glb", "cover_url": "https://hi3d/cover.png"}
    done = client.get(url, headers=admin).json()
    assert done["status"] == "succeeded"
    assert done["files"]["parts"] and done["files"]["parts_3mf"] and done["files"]["preview"]
    made = client.get(done["files"]["parts_3mf"].split("?")[0].split(".app", 1)[-1].split("testserver", 1)[-1])
    assert made.status_code == 200
    model = zipfile.ZipFile(io.BytesIO(made.content)).read("3D/3dmodel.model").decode()
    assert model.count("<object ") == 2 and 'name="head"' in model and 'unit="millimeter"' in model


def test_hi3d_without_keys_says_so(client, make_user, hero, monkeypatch):
    monkeypatch.delenv("HI3D_CLIENT_ID", raising=False)
    monkeypatch.delenv("HI3D_CLIENT_SECRET", raising=False)
    get_storage().upload_file(hero.user_id, hero.id, "model.glb", b"glTF", content_type="model/gltf-binary")
    r = client.post(f"/api/v1/heroes/{hero.id}/print-split", json={"provider": "hi3d"},
                    headers=_jwt(make_user(is_admin=True)))
    assert r.status_code == 503 and r.json()["detail"]["code"] == "hi3d_not_configured"


def test_hi3d_client_books_its_price_and_sends_a_character_split(db, monkeypatch, make_user, hero):
    from app.services import hi3d as hi3d_module
    from app.services.usage import UsageContext

    calls = []

    def fake_post(url, headers=None, json=None, timeout=None):
        calls.append(("token", url, headers["Authorization"].split()[0]))
        return SimpleNamespace(status_code=200, json=lambda: {"code": 200, "data": {"accessToken": "tok"}})

    def fake_request(method, url, headers=None, timeout=None, data=None, files=None, params=None):
        calls.append((method, url, headers["Authorization"], data))
        return SimpleNamespace(status_code=200, json=lambda: {"code": 200, "data": {"task_id": "split_1", "state": "queueing"}})

    monkeypatch.setattr(hi3d_module.requests, "post", fake_post)
    monkeypatch.setattr(hi3d_module.requests, "request", fake_request)
    monkeypatch.setattr(hi3d_module, "_token", {"value": None, "at": 0.0})
    c = hi3d_module.Hi3dClient(client_id="ak", client_secret="sk")
    task = c.create_character_split(mesh_url="https://s3/model.glb", part="b", joint="ball",
                                    usage=UsageContext(user_id=make_user().id, creation_id=hero.id, step_name="print_split"))
    assert task == "split_1"
    assert calls[0] == ("token", "https://api.hitem3d.ai/open-api/v1/auth/token", "Basic")
    method, url, auth, form = calls[1]
    assert url.endswith("/open-api/v1/split/create-task") and auth == "Bearer tok"
    assert form == {"model": "character", "part": "b", "joint": "ball", "format": "2", "merge": "yes",
                    "mesh_url": "https://s3/model.glb"}
    event = db.query(UsageEvent).filter_by(provider_ref="split_1").one()
    assert event.provider == pricing.PROVIDER_HI3D and event.cost_usd_micros == 400_000
