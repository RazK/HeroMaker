"""An admin can put files made outside the pipeline into a hero (PUT
/api/v1/admin/creations/{id}/files/{name}): how Tripo-made heroes reach
staging without a provider call. The hero must then read as finished
everywhere, through the same API the app uses."""
import io

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.services.auth import create_access_token
from app.utils.storage import get_storage

GLB = b"glTF" + b"\x02\x00\x00\x00" + b"\x00" * 32


def _png() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 40, 40)).save(out, "PNG")
    return out.getvalue()


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _put(client, user, creation_id, name, data, **params):
    return client.put(f"/api/v1/admin/creations/{creation_id}/files/{name}", content=data,
                      params=params, headers={**_auth(user), "Content-Type": "application/octet-stream"})


def _draft(make_creation, owner_id):
    return make_creation(owner_id, {"image_processing": "pending", "openai_render": "pending", "meshy_3d": "pending",
                                    "meshy_rig": "pending", "convert_vrm": "pending"})


def test_installing_every_output_finishes_the_hero(db, make_user, make_creation):
    owner = make_user()
    admin = make_user(username="admin_installer", is_admin=True)
    hero = _draft(make_creation, owner.id)
    client = TestClient(app)
    files = {"processed.jpg": _png(), "rendered.png": _png(), "model.glb": GLB, "rigged.glb": GLB, "avatar.vrm": GLB}
    for name, data in files.items():
        r = _put(client, admin, hero.id, name, data, source="tripo v3.1")
        assert r.status_code == 200, r.text
        assert r.json()["step_status"] == "completed"
    assert _put(client, admin, hero.id, "walking.glb", GLB).status_code == 200

    storage = get_storage()
    for name, data in {**files, "walking.glb": GLB}.items():
        assert storage.download_file(owner.id, hero.id, name) == data
    # Read back as the owner sees it: a finished hero with every file versioned.
    view = client.get(f"/api/v1/heroes/{hero.id}", headers=_auth(owner)).json()
    assert view["status"] == "completed"
    assert {"rendered.png", "model.glb", "rigged.glb", "avatar.vrm"} <= set(view["file_versions"])
    db.expire_all()
    step = next(s for s in hero.steps if s.step_name == "convert_vrm")
    assert step.metadata_json["installed:avatar.vrm"]["source"] == "tripo v3.1"
    assert step.metadata_json["installed:avatar.vrm"]["by"] == admin.id


def test_only_admins(db, make_user, make_creation):
    owner = make_user()
    hero = _draft(make_creation, owner.id)
    r = _put(TestClient(app), owner, hero.id, "avatar.vrm", GLB)
    assert r.status_code == 403
    db.expire_all()
    assert next(s for s in hero.steps if s.step_name == "convert_vrm").status == "pending"


def test_refuses_what_is_not_a_hero_file(db, make_user, make_creation):
    owner = make_user()
    admin = make_user(username="admin_refuser", is_admin=True)
    hero = _draft(make_creation, owner.id)
    client = TestClient(app)
    assert _put(client, admin, hero.id, "original.jpg", _png()).status_code == 400   # the drawing is the user's
    assert _put(client, admin, hero.id, "opt_avatar.vrm", GLB).status_code == 400   # derived, never uploaded
    assert _put(client, admin, hero.id, "../x.vrm", GLB).status_code in (400, 404)
    assert _put(client, admin, hero.id, "avatar.vrm", b"not a glb").status_code == 400
    assert _put(client, admin, hero.id, "rendered.png", b"not a picture").status_code == 400
    assert _put(client, admin, hero.id, "avatar.vrm", b"").status_code == 400
    assert _put(client, admin, "no-such-hero", "avatar.vrm", GLB).status_code == 404


def test_walking_clip_alone_does_not_finish_the_rig(db, make_user, make_creation):
    owner = make_user()
    admin = make_user(username="admin_walker", is_admin=True)
    hero = _draft(make_creation, owner.id)
    assert _put(TestClient(app), admin, hero.id, "walking.glb", GLB).json()["step_status"] == "pending"


def test_a_running_step_is_left_alone(db, make_user, make_creation):
    owner = make_user()
    admin = make_user(username="admin_waiter", is_admin=True)
    hero = make_creation(owner.id, {"convert_vrm": "processing"})
    assert _put(TestClient(app), admin, hero.id, "avatar.vrm", GLB).status_code == 409


def test_reinstalling_drops_the_cached_optimized_copy(db, make_user, make_creation):
    owner = make_user()
    admin = make_user(username="admin_again", is_admin=True)
    hero = _draft(make_creation, owner.id)
    client = TestClient(app)
    storage = get_storage()
    assert _put(client, admin, hero.id, "avatar.vrm", GLB).status_code == 200
    storage.upload_file(owner.id, hero.id, "opt_avatar.vrm", GLB)
    assert _put(client, admin, hero.id, "avatar.vrm", GLB + b"\x00" * 4).status_code == 200
    assert not storage.file_exists(owner.id, hero.id, "opt_avatar.vrm")
