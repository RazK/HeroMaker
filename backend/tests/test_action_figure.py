"""The hero as an action figure: the owner pays credits for a jointed print split.

The real routes, ledger and refund code run; only Hi3D is a stand-in (as in
test_print_split.py). Every way the paid split can end badly must give the
credits back, exactly once (CLAUDE.md, "Payments").
"""
import pytest

from app.config.packs import ACTION_FIGURE_CREDITS
from app.services import hi3d as hi3d_module
from app.services import ledger, print_split
from app.utils.storage import get_storage
from test_print_split import FakeHi3d, _two_part_glb
from test_public_api import _jwt, client  # noqa: F401


@pytest.fixture
def hi3d(monkeypatch):
    fake = FakeHi3d()
    monkeypatch.setattr(hi3d_module, "Hi3dClient", lambda: fake)
    glb = _two_part_glb()
    monkeypatch.setattr(print_split, "_download", lambda url: glb if url.endswith(".glb") else b"png")
    monkeypatch.setattr(print_split, "POLL_SECONDS", 0)
    return fake


@pytest.fixture
def owner(make_user):
    return make_user(credits=20)


@pytest.fixture
def hero(db, owner, make_creation, completed_steps):
    creation = make_creation(owner.id, completed_steps)
    db.commit()
    get_storage().upload_file(owner.id, creation.id, "model.glb", b"glTF hero", content_type="model/gltf-binary")
    return creation


def _balance(db, user):
    db.expire_all()
    return ledger.get_balance(user.id, db)


def test_it_costs_credits_once_and_ends_as_jointed_parts(client, db, owner, hero, hi3d):
    url = f"/api/v1/heroes/{hero.id}/action-figure"
    first = client.get(url, headers=_jwt(owner)).json()
    assert first["status"] == "none" and first["price_credits"] == ACTION_FIGURE_CREDITS

    r = client.post(url, headers=_jwt(owner))
    assert r.status_code == 202, r.text
    assert r.json()["status"] == "pending" and r.json()["joint"] == "ball"
    assert _balance(db, owner) == 20 - ACTION_FIGURE_CREDITS
    assert hi3d.created[0]["part"] == "a" and hi3d.created[0]["joint"] == "ball"

    # Asking again while it runs, or once it is done, is the same figure, not a second charge.
    client.post(url, headers=_jwt(owner))
    hi3d.task = {"state": "success", "url": "https://hi3d/parts.glb", "cover_url": "https://hi3d/cover.png"}
    done = client.get(url, headers=_jwt(owner)).json()
    assert done["status"] == "succeeded" and done["files"]["parts"] and done["files"]["parts_3mf"]
    client.post(url, headers=_jwt(owner))
    assert len(hi3d.created) == 1
    assert _balance(db, owner) == 20 - ACTION_FIGURE_CREDITS


def test_a_split_that_fails_gives_the_credits_back_once(client, db, owner, hero, hi3d):
    url = f"/api/v1/heroes/{hero.id}/action-figure"
    client.post(url, headers=_jwt(owner))
    assert _balance(db, owner) == 20 - ACTION_FIGURE_CREDITS

    hi3d.task = {"state": "failed", "msg": "generate failed"}
    body = client.get(url, headers=_jwt(owner)).json()
    assert body["status"] == "failed" and "credits are back" in body["error"]
    assert _balance(db, owner) == 20
    client.get(url, headers=_jwt(owner))  # read again: no second refund
    assert _balance(db, owner) == 20

    # And it may be tried again, which charges again.
    hi3d.task = {"state": "processing"}
    assert client.post(url, headers=_jwt(owner)).status_code == 202
    assert _balance(db, owner) == 20 - ACTION_FIGURE_CREDITS


def test_an_admin_reading_the_failure_first_still_refunds_the_owner(client, db, make_user, owner, hero, hi3d):
    client.post(f"/api/v1/heroes/{hero.id}/action-figure", headers=_jwt(owner))
    hi3d.task = {"state": "failed"}
    admin = make_user(is_admin=True)
    assert client.get(f"/api/v1/heroes/{hero.id}/print-split", headers=_jwt(admin)).json()["status"] == "failed"
    assert _balance(db, owner) == 20


def test_hi3d_refusing_to_start_refunds_at_once(client, db, owner, hero, hi3d, monkeypatch):
    def broke(**kw):
        raise hi3d_module.Hi3dError("余额不足", code=1004)

    monkeypatch.setattr(hi3d, "create_character_split", broke)
    r = client.post(f"/api/v1/heroes/{hero.id}/action-figure", headers=_jwt(owner))
    assert r.status_code == 503 and r.json()["detail"]["code"] == "unavailable"
    assert "credits are back" in r.json()["detail"]["message"]
    assert _balance(db, owner) == 20


def test_without_enough_credits_it_is_402_and_hi3d_is_not_called(client, db, make_user, make_creation,
                                                                  completed_steps, hi3d):
    poor = make_user(credits=ACTION_FIGURE_CREDITS - 1)
    creation = make_creation(poor.id, completed_steps)
    db.commit()
    get_storage().upload_file(poor.id, creation.id, "model.glb", b"glTF", content_type="model/gltf-binary")
    r = client.post(f"/api/v1/heroes/{creation.id}/action-figure", headers=_jwt(poor))
    assert r.status_code == 402 and r.json()["detail"]["code"] == "insufficient_credits"
    assert hi3d.created == [] and _balance(db, poor) == ACTION_FIGURE_CREDITS - 1


def test_only_the_owner_may_buy_it(client, db, make_user, owner, hero, hi3d):
    stranger = make_user(credits=20)
    r = client.post(f"/api/v1/heroes/{hero.id}/action-figure", headers=_jwt(stranger))
    assert r.status_code in (403, 404)  # 404: hero ids do not leak (v1._own_hero)
    assert client.get(f"/api/v1/heroes/{hero.id}/action-figure", headers=_jwt(stranger)).status_code in (403, 404)
    assert hi3d.created == [] and _balance(db, stranger) == 20 and _balance(db, owner) == 20


def test_without_hi3d_keys_nothing_is_charged(client, db, owner, hero, monkeypatch):
    monkeypatch.delenv("HI3D_CLIENT_ID", raising=False)
    monkeypatch.delenv("HI3D_CLIENT_SECRET", raising=False)
    r = client.post(f"/api/v1/heroes/{hero.id}/action-figure", headers=_jwt(owner))
    assert r.status_code == 503 and _balance(db, owner) == 20


def test_an_unfinished_hero_cannot_be_bought(client, db, owner, make_creation, hi3d):
    creation = make_creation(owner.id, {"image_processing": "completed"})
    r = client.post(f"/api/v1/heroes/{creation.id}/action-figure", headers=_jwt(owner))
    assert r.status_code == 409 and _balance(db, owner) == 20


def test_an_admins_empty_hi3d_balance_is_said_plainly(client, make_user, hero, hi3d, monkeypatch):
    def broke(**kw):
        raise hi3d_module.Hi3dError("余额不足", code=1004)

    monkeypatch.setattr(hi3d, "create_character_split", broke)
    r = client.post(f"/api/v1/heroes/{hero.id}/print-split", json={"provider": "hi3d"},
                    headers=_jwt(make_user(is_admin=True)))
    assert r.status_code == 402 and r.json()["detail"]["code"] == "hi3d_balance"
