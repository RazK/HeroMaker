"""No ghost heroes: a picture picked and never made is nobody's hero, and
something that is not a picture never becomes one.

Persona review: a photo picked by mistake, then Back, sat in My heroes as
"Your hero · Not started" and opened on a progress screen with nothing
running; the admin's user list counted it as "making". A .txt file was
accepted as a drawing, its first step "completed" and its painting was
charged and failed.

Everything here goes through the real endpoints: POST /create, the gallery's
list, run-pipeline (start_pipeline, with a task manager that starts nothing),
the admin's user list and user page. A class student's text file is in
test_classes.py.
"""
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.models import Creation
from app.services.auth import create_access_token
from app.services.task_manager import get_task_manager

NOT_A_PICTURE = "That isn't a picture. Choose a photo or a drawing."


def _jpeg() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (64, 48), (200, 30, 30)).save(out, format="JPEG")
    return out.getvalue()


class _Tasks:
    """Stands in for the app's task manager: records runs, starts none."""
    def running_for_creation(self, creation_id):
        return []

    def create_task(self, creation_id, key, coro, timeout=None):
        coro.close()

    def cancel_all_tasks_for_creation(self, creation_id):
        return 0


@pytest.fixture
def client():
    app.dependency_overrides[get_task_manager] = lambda: _Tasks()
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_task_manager, None)


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _upload(client, user, body, name="d.jpg", kind="image/jpeg"):
    return client.post("/api/creations/create", headers=_auth(user), files={"image_file": (name, body, kind)})


def _mine(client, user):
    r = client.get("/api/creations/?mine_only=true", headers=_auth(user))
    assert r.status_code == 200, r.text
    return [c["id"] for c in r.json()]


# ---- not a picture ---------------------------------------------------------

@pytest.mark.parametrize("body,name,kind", [
    (b"Dear diary, today I drew a dragon.", "notes.txt", "text/plain"),
    (b"Dear diary", "notes.jpg", "image/jpeg"),             # a picture's name, not a picture
    (b"\xff\xd8\xff not really a jpeg", "d.jpg", "image/jpeg"),
    (b"%!PS-Adobe-3.0 EPSF-3.0\n", "d.eps", "image/x-eps"),  # Pillow reads EPS by running Ghostscript
    (b"", "d.jpg", "image/jpeg"),
])
def test_what_is_not_a_picture_makes_no_hero(db, make_user, client, body, name, kind):
    user = make_user(credits=100)
    r = _upload(client, user, body, name, kind)
    assert r.status_code == 400
    assert r.json()["detail"] == NOT_A_PICTURE        # the app shows it as it is
    assert db.query(Creation).count() == 0


@pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP", "GIF"])
def test_a_picture_is_taken(db, make_user, client, fmt):
    user = make_user()
    out = io.BytesIO()
    Image.new("RGB", (64, 48), (20, 120, 200)).save(out, format=fmt)
    r = _upload(client, user, out.getvalue())
    assert r.status_code == 201, r.text
    assert db.query(Creation).count() == 1


# ---- picked, never made ----------------------------------------------------

def test_a_hero_never_started_is_in_no_list_until_it_is_made(db, make_user, client):
    user = make_user(credits=100)
    admin = make_user(is_admin=True)
    made = _upload(client, user, _jpeg()).json()["id"]
    left = _upload(client, user, _jpeg()).json()["id"]      # the sheet was left: Back, tab closed

    # Neither is anyone's hero yet: not in My heroes, not in an admin's All heroes.
    assert _mine(client, user) == []
    r = client.get("/api/creations/", headers=_auth(admin))
    assert [c["id"] for c in r.json()] == []

    # "Make my hero": the real run-pipeline, which marks the first step running.
    r = client.post(f"/api/creations/{made}/run-pipeline", headers=_auth(user))
    assert r.status_code == 200, r.text
    assert _mine(client, user) == [made]
    r = client.get("/api/creations/", headers=_auth(admin))
    assert [c["id"] for c in r.json()] == [made]

    # Its own page still answers (a shared link, the app right after Make).
    assert client.get(f"/api/creations/{left}").status_code == 200
    # And the row is kept: nothing is deleted.
    assert db.query(Creation).filter_by(id=left).one().deleted_at is None


def test_admin_counts_leave_out_a_hero_never_started(db, make_user, client):
    user = make_user(credits=100, username="mayaparent")
    admin = make_user(is_admin=True)
    made = _upload(client, user, _jpeg()).json()["id"]
    _upload(client, user, _jpeg())
    _upload(client, user, _jpeg())
    assert client.post(f"/api/creations/{made}/run-pipeline", headers=_auth(user)).status_code == 200

    # The user list: one hero, being made, not three.
    r = client.get("/api/admin/users?include_test=true", headers=_auth(admin))
    assert r.status_code == 200, r.text
    [row] = [u for u in r.json() if u["id"] == user.id]
    assert row["creation_stats"] == {"completed": 0, "failed": 0, "in_progress": 1}

    # The user's page: the same one hero, and no "Not started" tiles.
    r = client.get(f"/api/admin/users/{user.id}", headers=_auth(admin))
    assert r.status_code == 200, r.text
    page = r.json()
    assert page["counts"]["heroes"] == 1
    assert [h["id"] for h in page["heroes"]] == [made]


def test_a_failed_hero_is_still_listed(db, make_user, make_creation, client):
    """Only "never started" is left out: a hero whose run failed is the
    owner's, with Try again on it."""
    user = make_user()
    failed = make_creation(user.id, {"openai_render": "failed", "meshy_3d": "pending"})
    assert _mine(client, user) == [failed.id]
