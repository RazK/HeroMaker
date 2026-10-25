"""The public API (/api/v1): keys, making a hero from a drawing, its stages.

Heroes here run the REAL pipeline (`pipeline.run_pipeline` via
`creations.start_pipeline`), with only the provider calls stood in for, so
the credits charged are the product's own charges.
"""
import asyncio
import base64
import io
import time

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.models import ApiHero, ApiKey, Creation
from app.services import api_heroes, api_keys, ledger, pipeline, step_stats
from app.services.auth import create_access_token

HERO_COST = 10


class _AllFilesExist:
    def file_exists(self, *_a, **_kw):
        return True

    def get_file_path(self, *_a, **_kw):
        return "/dev/null"


@pytest.fixture
def client(monkeypatch):
    from app.main import app

    def provider(step_name):
        async def fine(creation_id, _user_id, db):
            if step_name == "meshy_3d":  # what the rigger needs from the sculptor
                from app.models import CreationStep
                from sqlalchemy.orm.attributes import flag_modified
                step = db.query(CreationStep).filter_by(creation_id=creation_id, step_name="meshy_3d").one()
                step.metadata_json = {**(step.metadata_json or {}), "meshy_3d_task_id": "t-1"}
                flag_modified(step, "metadata_json")
                db.commit()
        return fine

    monkeypatch.setattr(pipeline, "get_step_coroutine", provider)
    monkeypatch.setattr(pipeline, "get_storage", lambda: _AllFilesExist())
    step_stats.reset_cache()
    # Other test modules install a stand-in task manager for good; these
    # heroes need the real one, which runs the pipeline.
    from app.services.task_manager import get_task_manager
    saved = app.dependency_overrides.pop(get_task_manager, None)
    try:
        with TestClient(app) as c:
            yield c
    finally:
        if saved is not None:
            app.dependency_overrides[get_task_manager] = saved


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 96), "white").save(buf, "PNG")
    return buf.getvalue()


def _jwt(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _key(client, user, **body):
    r = client.post("/api/v1/keys", json={"name": "test", **body}, headers=_jwt(user))
    assert r.status_code == 201, r.text
    return r.json()


def _bearer(key):
    return {"Authorization": f"Bearer {key}"}


def _wait_done(client, key, hero_id, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        v = client.get(f"/api/v1/heroes/{hero_id}", headers=_bearer(key)).json()
        if v["status"] in ("completed", "failed"):
            return v
        time.sleep(0.05)
    raise AssertionError(f"hero still {v['status']}")


def test_a_key_is_shown_once_and_stored_hashed(client, db, make_user):
    user = make_user()
    made = _key(client, user)
    assert made["key"].startswith("hm_sk_") and made["webhook_secret"].startswith("whsec_")
    row = db.query(ApiKey).filter_by(id=made["id"]).one()
    assert row.key_hash == api_keys.hash_key(made["key"]) and made["key"] not in (row.prefix, row.key_hash)
    listed = client.get("/api/v1/keys", headers=_jwt(user)).json()["data"]
    assert [k["prefix"] for k in listed] == [made["prefix"]]
    assert "key" not in listed[0]


def test_no_key_bad_key_revoked_key(client, make_user):
    user = make_user(credits=100)
    body = {"image_base64": base64.b64encode(_png()).decode()}
    assert client.post("/api/v1/heroes", json=body).status_code == 401
    assert client.post("/api/v1/heroes", json=body, headers=_bearer("hm_sk_nope")).status_code == 401
    made = _key(client, user)
    client.delete(f"/api/v1/keys/{made['id']}", headers=_jwt(user))
    assert client.post("/api/v1/heroes", json=body, headers=_bearer(made["key"])).status_code == 401


def test_a_hero_from_a_drawing_charges_the_owner_and_reports_every_stage(client, db, make_user):
    user = make_user(credits=25)
    key = _key(client, user)["key"]
    r = client.post("/api/v1/heroes", headers=_bearer(key), json={
        "image_base64": "data:image/png;base64," + base64.b64encode(_png()).decode(),
        "name": "Captain Crayon", "client_ref": "player-7",
    })
    assert r.status_code == 202, r.text
    started = r.json()
    assert started["status"] in ("queued", "processing", "completed")
    assert started["cost_credits"] == HERO_COST
    assert started["client_ref"] == "player-7"
    assert [s["stage"] for s in started["stages"]] == ["drawing", "cleanup", "painting", "model", "rig", "avatar"]
    assert started["files"]["drawing"].endswith(f"/api/files/{user.id}/{started['id']}/original.jpg")

    done = _wait_done(client, key, started["id"])
    assert done["status"] == "completed", done
    assert done["progress"] == 100 and done["eta"] is None
    assert all(s["status"] == "completed" and s["file"] for s in done["stages"])
    assert done["files"]["avatar"].endswith("/avatar.vrm")
    assert done["files"]["avatar_optimized"].endswith("/opt_avatar.vrm")

    db.expire_all()
    assert ledger.get_balance(user.id, db) == 25 - HERO_COST
    creation = db.query(Creation).filter_by(id=started["id"]).one()
    assert creation.character_name == "Captain Crayon" and creation.is_public is False


def test_multipart_upload_works_too(client, make_user):
    user = make_user(credits=10)
    key = _key(client, user)["key"]
    r = client.post("/api/v1/heroes", headers=_bearer(key),
                    files={"drawing": ("d.png", _png(), "image/png")}, data={"name": "Multi"})
    assert r.status_code == 202, r.text


def test_too_few_credits_is_402_and_nothing_is_made(client, db, make_user):
    user = make_user(credits=HERO_COST - 1)
    key = _key(client, user)["key"]
    r = client.post("/api/v1/heroes", headers=_bearer(key), json={"image_base64": base64.b64encode(_png()).decode()})
    assert r.status_code == 402
    assert r.json()["detail"]["hero_cost_credits"] == HERO_COST
    assert db.query(Creation).filter_by(user_id=user.id).count() == 0


def test_not_a_picture_is_refused(client, make_user):
    user = make_user(credits=100)
    key = _key(client, user)["key"]
    r = client.post("/api/v1/heroes", headers=_bearer(key), json={"image_base64": base64.b64encode(b"hello").decode()})
    assert r.status_code == 400


def test_image_urls_and_webhooks_inside_our_network_are_refused(client, make_user):
    user = make_user(credits=100)
    key = _key(client, user)["key"]
    for field, url in [("image_url", "https://127.0.0.1/x.png"), ("image_url", "http://example.com/x.png"),
                       ("webhook_url", "https://10.0.0.5/hook")]:
        body = {field: url} if field == "image_url" else {"image_base64": base64.b64encode(_png()).decode(), field: url}
        r = client.post("/api/v1/heroes", headers=_bearer(key), json=body)
        assert r.status_code == 400, (field, url, r.text)


def test_two_drawings_at_once_is_refused(client, make_user):
    key = _key(client, make_user(credits=100))["key"]
    r = client.post("/api/v1/heroes", headers=_bearer(key), json={
        "image_base64": base64.b64encode(_png()).decode(), "image_url": "https://example.com/x.png"})
    assert r.status_code == 400


def test_another_accounts_hero_can_be_read_not_changed(client, make_user):
    a, b = make_user(credits=100), make_user(credits=100)
    ka, kb = _key(client, a)["key"], _key(client, b)["key"]
    hero = client.post("/api/v1/heroes", headers=_bearer(ka), json={
        "image_base64": base64.b64encode(_png()).decode(), "client_ref": "secret-ref"}).json()
    # Anyone may read a hero by its id (its page opens from a shared link),
    # without the owner's fields; only the owner may change it.
    seen = client.get(f"/api/v1/heroes/{hero['id']}", headers=_bearer(kb)).json()
    assert seen["mine"] is False and "owner" not in seen and seen["client_ref"] is None
    assert client.get(f"/api/v1/heroes/{hero['id']}").status_code == 200
    assert client.delete(f"/api/v1/heroes/{hero['id']}", headers=_bearer(kb)).status_code == 404
    assert client.patch(f"/api/v1/heroes/{hero['id']}", headers=_bearer(kb), json={"name": "Mine now"}).status_code == 404


def test_publishable_key_only_from_its_sites_and_capped_per_day(client, make_user):
    user = make_user(credits=1000)
    made = _key(client, user, kind="publishable", allowed_origins=["https://Game.example/"], daily_limit=2)
    assert made["key"].startswith("hm_pk_") and made["allowed_origins"] == ["https://game.example"]
    body = {"image_base64": base64.b64encode(_png()).decode()}
    h = _bearer(made["key"])
    assert client.post("/api/v1/heroes", json=body, headers=h).status_code == 403
    assert client.post("/api/v1/heroes", json=body, headers={**h, "Origin": "https://evil.example"}).status_code == 403
    ok = {**h, "Origin": "https://game.example"}
    assert client.post("/api/v1/heroes", json=body, headers=ok).status_code == 202
    assert client.post("/api/v1/heroes", json=body, headers=ok).status_code == 202
    r = client.post("/api/v1/heroes", json=body, headers=ok)
    assert r.status_code == 429 and r.headers["retry-after"]


def test_publishable_key_needs_an_origin(client, make_user):
    r = client.post("/api/v1/keys", json={"name": "x", "kind": "publishable"}, headers=_jwt(make_user()))
    assert r.status_code == 400


def test_any_website_may_call_it_from_a_browser(client):
    r = client.options("/api/v1/heroes", headers={
        "Origin": "https://simsply.netlify.app", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type"})
    assert r.status_code == 204
    assert r.headers["access-control-allow-origin"] == "https://simsply.netlify.app"
    assert "authorization" in r.headers["access-control-allow-headers"].lower()
    r = client.get("/api/v1/estimates", headers={"Origin": "https://simsply.netlify.app"})
    assert r.headers["access-control-allow-origin"] == "https://simsply.netlify.app"
    assert "access-control-allow-credentials" not in r.headers


def test_estimates_need_no_key(client):
    r = client.get("/api/v1/estimates")
    assert r.status_code == 200
    body = r.json()
    assert [s["stage"] for s in body["stages"]] == ["cleanup", "painting", "model", "rig", "avatar"]
    assert body["total"]["p90_seconds"] >= body["total"]["typical_seconds"] > 0
    assert body["cost_credits"] == HERO_COST


def test_account_shows_credits(client, make_user):
    user = make_user(credits=35)
    key = _key(client, user)["key"]
    body = client.get("/api/v1/account", headers=_bearer(key)).json()
    assert body["credits"] == 35 and body["heroes_affordable"] == 3


def test_list_and_delete(client, make_user):
    user = make_user(credits=100)
    key = _key(client, user)["key"]
    hero = client.post("/api/v1/heroes", headers=_bearer(key), json={
        "image_base64": base64.b64encode(_png()).decode(), "client_ref": "abc"}).json()
    listed = client.get("/api/v1/heroes?client_ref=abc", headers=_bearer(key)).json()["data"]
    assert [h["id"] for h in listed] == [hero["id"]]
    assert client.delete(f"/api/v1/heroes/{hero['id']}", headers=_bearer(key)).json()["deleted"] is True
    assert client.get(f"/api/v1/heroes/{hero['id']}", headers=_bearer(key)).status_code == 404


def test_webhook_events_and_signature():
    stages = lambda *st: [{"stage": s, "status": x} for s, x in zip(
        ["drawing", "cleanup", "painting", "model", "rig", "avatar"], ("completed",) + st)]
    before = {"status": "processing", "stages": stages("completed", "processing", "pending", "pending", "pending")}
    after = {"status": "completed", "stages": stages(*["completed"] * 5)}
    assert api_heroes._events(before, after) == [
        "stage.completed:painting", "stage.completed:model", "stage.completed:rig", "stage.completed:avatar",
        "hero.completed"]
    sig = api_keys.sign("whsec_x", "1700000000", b'{"a":1}')
    import hashlib, hmac
    assert sig == "sha256=" + hmac.new(b"whsec_x", b'1700000000.{"a":1}', hashlib.sha256).hexdigest()


def test_progress_and_time_left_while_running(db, make_user, make_creation):
    from datetime import datetime, timedelta

    user = make_user()
    c = make_creation(user.id, steps={"image_processing": "completed", "openai_render": "completed",
                                      "meshy_3d": "processing", "meshy_rig": "pending", "convert_vrm": "pending"})
    step = next(s for s in c.steps if s.step_name == "meshy_3d")
    step.started_at = datetime.utcnow() - timedelta(seconds=60)
    step.estimated_progress = 40
    db.commit()
    db.refresh(c)
    v = api_heroes.view(c, "https://api.test")
    assert v["status"] == "processing" and v["stage"] == "model"
    assert 0 < v["progress"] < 100
    assert v["eta"]["seconds_left"] > 0 and v["eta"]["seconds_left_p90"] >= v["eta"]["seconds_left"]
    assert v["files"]["painting"] and v["files"]["model"] is None


def test_openapi_lists_the_public_api_only(client):
    spec = client.get("/api/v1/openapi.json").json()
    paths = set(spec["paths"])
    assert {"/api/v1/heroes", "/api/v1/heroes/{hero_id}", "/api/v1/estimates", "/api/v1/account"} <= paths
    assert not any(p.startswith(("/api/admin", "/api/auth", "/api/v1/keys")) for p in paths)
    body = spec["paths"]["/api/v1/heroes"]["post"]["requestBody"]["content"]
    assert "multipart/form-data" in body and "application/json" in body
    assert "CreateHero" in spec["components"]["schemas"]
# --- One API for every client: the app's login works here too, with more access.

def test_the_app_login_makes_and_lists_heroes_like_a_key(client, db, make_user):
    user = make_user(credits=20)
    h = _jwt(user)
    r = client.post("/api/v1/heroes", headers=h, json={"image_base64": base64.b64encode(_png()).decode(), "name": "From the app"})
    assert r.status_code == 202, r.text
    hero_id = r.json()["id"]
    assert _wait_done_jwt(client, h, hero_id)["status"] == "completed"
    assert [x["id"] for x in client.get("/api/v1/heroes", headers=h).json()["data"]] == [hero_id]
    assert db.query(ApiHero).filter_by(creation_id=hero_id).count() == 0  # no key involved
    assert client.get("/api/v1/account", headers=h).json()["key"] is None


def test_a_key_sees_the_accounts_app_heroes_too(client, make_user):
    user = make_user(credits=20)
    made = client.post("/api/v1/heroes", headers=_jwt(user), json={"image_base64": base64.b64encode(_png()).decode()}).json()
    key = _key(client, user)["key"]
    assert client.get(f"/api/v1/heroes/{made['id']}", headers=_bearer(key)).status_code == 200


def test_a_key_cannot_manage_keys(client, make_user):
    user = make_user()
    key = _key(client, user)["key"]
    assert client.get("/api/v1/keys", headers=_bearer(key)).status_code == 403
    assert client.post("/api/v1/keys", headers=_bearer(key), json={"name": "x"}).status_code == 403


def test_webhooks_need_a_key(client, make_user):
    r = client.post("/api/v1/heroes", headers=_jwt(make_user(credits=20)), json={
        "image_base64": base64.b64encode(_png()).decode(), "webhook_url": "https://example.com/hook"})
    assert r.status_code == 400


def test_a_bad_session_is_401(client):
    assert client.get("/api/v1/account", headers={"Authorization": "Bearer not-a-token"}).status_code == 401


def _wait_done_jwt(client, headers, hero_id, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        v = client.get(f"/api/v1/heroes/{hero_id}", headers=headers).json()
        if v["status"] in ("completed", "failed"):
            return v
        time.sleep(0.05)
    raise AssertionError(v["status"])
