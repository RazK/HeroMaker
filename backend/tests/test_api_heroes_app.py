"""The app's hero calls on /api/v1: everything the app does with a hero.

Real pipeline, providers stood in for (fixture from test_public_api).
"""
import base64

from app.models import Creation, CreationStep
from app.services import ledger
from test_public_api import HERO_COST, _bearer, _jwt, _key, _png, _wait_done_jwt, client  # noqa: F401

PNG = lambda: base64.b64encode(_png()).decode()  # noqa: E731


def test_upload_first_then_start_with_a_style(client, db, make_user):
    user = make_user(credits=HERO_COST)
    h = _jwt(user)
    draft = client.post("/api/v1/heroes", headers=h, json={"image_base64": PNG(), "start": False,
                                                          "artist_name": "Noa", "artist_age": 7}).json()
    assert draft["status"] == "draft" and draft["artist"] == {"name": "Noa", "age": 7}
    assert ledger.get_balance(user.id, db) == HERO_COST  # nothing charged yet
    styles = client.get("/api/v1/styles").json()["data"]
    r = client.post(f"/api/v1/heroes/{draft['id']}/start", headers=h, json={"style": styles[-1]["key"]})
    assert r.status_code == 202, r.text
    done = _wait_done_jwt(client, h, draft["id"])
    assert done["status"] == "completed" and done["style"] == styles[-1]["key"]
    db.expire_all()
    assert ledger.get_balance(user.id, db) == 0


def test_starting_without_credits_is_402(client, make_user):
    user = make_user(credits=0)
    draft = client.post("/api/v1/heroes", headers=_jwt(user), json={"image_base64": PNG(), "start": False}).json()
    assert client.post(f"/api/v1/heroes/{draft['id']}/start", headers=_jwt(user)).status_code == 402


def test_rename_and_who_drew_it(client, make_user):
    user = make_user(credits=0)
    h = _jwt(user)
    hero = client.post("/api/v1/heroes", headers=h, json={"image_base64": PNG(), "start": False}).json()
    v = client.patch(f"/api/v1/heroes/{hero['id']}", headers=h, json={"name": "Speckle Sally", "artist_name": "Itai", "artist_age": 9}).json()
    assert v["name"] == "Speckle Sally" and v["artist"] == {"name": "Itai", "age": 9}
    assert client.patch(f"/api/v1/heroes/{hero['id']}", headers=h, json={}).status_code == 400


def test_the_owner_sees_their_fields_others_do_not(client, make_user):
    owner, other = make_user(credits=0), make_user(credits=0)
    hero = client.post("/api/v1/heroes", headers=_jwt(owner), json={"image_base64": PNG(), "start": False}).json()
    mine = client.get(f"/api/v1/heroes/{hero['id']}", headers=_jwt(owner)).json()
    assert mine["mine"] is True and mine["owner"]["username"] == owner.username
    theirs = client.get(f"/api/v1/heroes/{hero['id']}", headers=_jwt(other)).json()
    assert theirs["mine"] is False and "owner" not in theirs
    anon = client.get(f"/api/v1/heroes/{hero['id']}").json()
    assert "owner" not in anon and anon["file_versions"] is not None


def test_retry_from_a_failed_stage_charges_only_what_runs_again(client, db, make_user):
    user = make_user(credits=100)
    h = _jwt(user)
    hero = client.post("/api/v1/heroes", headers=h, json={"image_base64": PNG()}).json()
    _wait_done_jwt(client, h, hero["id"])
    db.expire_all()
    before = ledger.get_balance(user.id, db)
    r = client.post(f"/api/v1/heroes/{hero['id']}/start", headers=h, json={"from_stage": "rig"})
    assert r.status_code == 202, r.text
    assert _wait_done_jwt(client, h, hero["id"])["status"] == "completed"
    db.expire_all()
    assert before - ledger.get_balance(user.id, db) == 3  # rig 2 + avatar 1
    assert client.post(f"/api/v1/heroes/{hero['id']}/start", headers=h, json={"from_stage": "nope"}).status_code == 400


def test_gallery_views(client, db, make_user):
    admin, user = make_user(is_admin=True), make_user(credits=20)
    h = _jwt(user)
    hero = client.post("/api/v1/heroes", headers=h, json={"image_base64": PNG()}).json()
    _wait_done_jwt(client, h, hero["id"])
    assert [x["id"] for x in client.get("/api/v1/gallery?view=mine", headers=h).json()["data"]] == [hero["id"]]
    assert client.get("/api/v1/gallery").json()["data"] == []  # not featured yet
    # Featuring is an admin's; a key of an admin account is still only a key.
    assert client.put(f"/api/v1/heroes/{hero['id']}/featured", headers=h, json={"featured": True}).status_code == 403
    admin_key = _key(client, admin)["key"]
    assert client.put(f"/api/v1/heroes/{hero['id']}/featured", headers=_bearer(admin_key), json={"featured": True}).status_code == 403
    r = client.put(f"/api/v1/heroes/{hero['id']}/featured", headers=_jwt(admin), json={"featured": True})
    assert r.status_code == 200 and r.json()["featured"] is True
    assert [x["id"] for x in client.get("/api/v1/gallery").json()["data"]] == [hero["id"]]
    # "all" is the admin's; anyone else, and any key, gets Editors' choice.
    assert client.get("/api/v1/gallery?view=all", headers=_bearer(admin_key)).json()["data"][0]["id"] == hero["id"]
    assert len(client.get("/api/v1/gallery?view=all", headers=_jwt(admin)).json()["data"]) >= 1


def test_cancel_when_nothing_runs_is_409(client, make_user):
    user = make_user(credits=0)
    hero = client.post("/api/v1/heroes", headers=_jwt(user), json={"image_base64": PNG(), "start": False}).json()
    assert client.post(f"/api/v1/heroes/{hero['id']}/cancel", headers=_jwt(user)).status_code == 409


def test_a_stage_on_its_own_needs_the_app(client, make_user):
    user = make_user(credits=0)
    key = _key(client, user)["key"]
    hero = client.post("/api/v1/heroes", headers=_jwt(user), json={"image_base64": PNG(), "start": False}).json()
    assert client.post(f"/api/v1/heroes/{hero['id']}/stages/cleanup/run", headers=_bearer(key)).status_code == 403


def test_estimates_carry_each_stage_cost(client):
    stages = client.get("/api/v1/estimates").json()["stages"]
    assert sum(s["cost_credits"] for s in stages) == HERO_COST
    assert {s["stage"]: s["file"] for s in stages}["avatar"] == "avatar.vrm"
