"""The hero as an action figure: a jointed print split, the hero page's fourth slide.

Anyone who can open the hero sees it once made; admins make it, free. The
paid path (the owner buys one with credits) is kept behind
packs.ACTION_FIGURE_FOR_SALE, and its tests turn that on (`for_sale`).

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
def for_sale(monkeypatch):
    from app.config import packs
    monkeypatch.setattr(packs, "ACTION_FIGURE_FOR_SALE", True)


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


def test_it_costs_credits_once_and_ends_as_jointed_parts(for_sale, client, db, owner, hero, hi3d):
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


def test_a_split_that_fails_gives_the_credits_back_once(for_sale, client, db, owner, hero, hi3d):
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


def test_an_admin_reading_the_failure_first_still_refunds_the_owner(for_sale, client, db, make_user, owner, hero, hi3d):
    client.post(f"/api/v1/heroes/{hero.id}/action-figure", headers=_jwt(owner))
    hi3d.task = {"state": "failed"}
    admin = make_user(is_admin=True)
    assert client.get(f"/api/v1/heroes/{hero.id}/print-split", headers=_jwt(admin)).json()["status"] == "failed"
    assert _balance(db, owner) == 20


def test_hi3d_refusing_to_start_refunds_at_once(for_sale, client, db, owner, hero, hi3d, monkeypatch):
    def broke(**kw):
        raise hi3d_module.Hi3dError("余额不足", code=1004)

    monkeypatch.setattr(hi3d, "create_character_split", broke)
    r = client.post(f"/api/v1/heroes/{hero.id}/action-figure", headers=_jwt(owner))
    assert r.status_code == 503 and r.json()["detail"]["code"] == "unavailable"
    assert "credits are back" in r.json()["detail"]["message"]
    assert _balance(db, owner) == 20


def test_without_enough_credits_it_is_402_and_hi3d_is_not_called(for_sale, client, db, make_user, make_creation,
                                                                  completed_steps, hi3d):
    poor = make_user(credits=ACTION_FIGURE_CREDITS - 1)
    creation = make_creation(poor.id, completed_steps)
    db.commit()
    get_storage().upload_file(poor.id, creation.id, "model.glb", b"glTF", content_type="model/gltf-binary")
    r = client.post(f"/api/v1/heroes/{creation.id}/action-figure", headers=_jwt(poor))
    assert r.status_code == 402 and r.json()["detail"]["code"] == "insufficient_credits"
    assert hi3d.created == [] and _balance(db, poor) == ACTION_FIGURE_CREDITS - 1


def test_only_the_owner_may_buy_it(for_sale, client, db, make_user, owner, hero, hi3d):
    stranger = make_user(credits=20)
    r = client.post(f"/api/v1/heroes/{hero.id}/action-figure", headers=_jwt(stranger))
    assert r.status_code in (403, 404)  # 404: hero ids do not leak (v1._own_hero)
    seen = client.get(f"/api/v1/heroes/{hero.id}/action-figure", headers=_jwt(stranger)).json()
    assert seen["status"] == "none" and seen["can_make"] is False and "price_credits" not in seen
    assert hi3d.created == [] and _balance(db, stranger) == 20 and _balance(db, owner) == 20


def test_without_hi3d_keys_nothing_is_charged(for_sale, client, db, owner, hero, monkeypatch):
    monkeypatch.delenv("HI3D_CLIENT_ID", raising=False)
    monkeypatch.delenv("HI3D_CLIENT_SECRET", raising=False)
    r = client.post(f"/api/v1/heroes/{hero.id}/action-figure", headers=_jwt(owner))
    assert r.status_code == 503 and _balance(db, owner) == 20


def test_an_unfinished_hero_cannot_be_bought(for_sale, client, db, owner, make_creation, hi3d):
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


# -- Not for sale (the default): anyone sees it once made, admins make it ---

def test_an_admin_makes_it_free_and_a_signed_out_visitor_sees_it(client, db, make_user, owner, hero, hi3d):
    admin = make_user(is_admin=True, credits=7)
    url = f"/api/v1/heroes/{hero.id}/action-figure"
    before = client.get(url, headers=_jwt(admin)).json()
    assert before["status"] == "none" and before["can_make"] is True and "price_credits" not in before

    r = client.post(url, headers=_jwt(admin))
    assert r.status_code == 202, r.text
    hi3d.task = {"state": "success", "url": "https://hi3d/parts.glb", "cover_url": "https://hi3d/cover.png"}
    assert client.get(url, headers=_jwt(admin)).json()["status"] == "succeeded"
    assert hi3d.created[0]["part"] == "a" and hi3d.created[0]["joint"] == "ball"
    assert _balance(db, admin) == 7 and _balance(db, owner) == 20  # nobody paid

    hero.featured = True
    db.commit()
    seen = client.get(url).json()  # signed out
    assert seen["status"] == "succeeded" and seen["can_make"] is False
    assert seen["files"]["parts"] and seen["files"]["parts_view"] and seen["files"]["parts_3mf"]
    assert seen["joint"] == "ball" and seen["part_count"] == 6
    for secret in ("cost_meshy_credits", "price_credits", "by", "task_id", "started_at", "error"):
        assert secret not in seen
    # The owner sees it too, without a price.
    mine = client.get(url, headers=_jwt(owner)).json()
    assert mine["status"] == "succeeded" and mine["can_make"] is False and "price_credits" not in mine
    # Asking again does not cut it again.
    client.post(url, headers=_jwt(admin))
    assert len(hi3d.created) == 1


def test_a_non_admin_cannot_make_one(client, db, make_user, owner, hero, hi3d):
    url = f"/api/v1/heroes/{hero.id}/action-figure"
    assert client.post(url, headers=_jwt(owner)).status_code == 403
    assert client.post(url, headers=_jwt(make_user(credits=20))).status_code == 403
    assert hi3d.created == [] and _balance(db, owner) == 20


def test_before_it_is_made_a_visitor_sees_nothing(client, make_user, hero, hi3d):
    url = f"/api/v1/heroes/{hero.id}/action-figure"
    first = client.get(url).json()
    assert first["status"] == "none" and first["can_make"] is False
    client.post(url, headers=_jwt(make_user(is_admin=True)))  # running now
    running = client.get(url).json()
    assert running["status"] == "none" and running["files"]["parts"] is None and running["progress"] == 0
