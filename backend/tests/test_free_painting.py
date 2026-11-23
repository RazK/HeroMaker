"""Pay after the reveal (E-006): the first painting free, once per account.

Drives the REAL `pipeline.execute_step`, as the refund tests do: an offer that
changes what a step charges must be proven on the code path that charges.
"""
import asyncio

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import CreditTransaction
from app.services import free_painting, ledger, pipeline
from app.services.auth import create_access_token

RENDER = "openai_render"
RENDER_COST = 2   # app/config/steps.py
MESHY_COST = 5


class _AllFilesExist:
    def file_exists(self, *_a, **_kw):
        return True

    def get_file_path(self, *_a, **_kw):
        return "/dev/null"


@pytest.fixture
def steps_succeed(monkeypatch):
    monkeypatch.setattr(pipeline, "get_storage", lambda: _AllFilesExist())

    async def fine(*_a, **_kw):
        return None
    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda _n: fine)


@pytest.fixture
def offer_on(monkeypatch):
    monkeypatch.setenv("FREE_PAINTING", "on")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _grants(db, user_id):
    return db.query(CreditTransaction).filter(
        CreditTransaction.user_id == user_id, CreditTransaction.external_ref == f"free-painting:{user_id}",
    ).all()


def test_off_by_default_the_painting_needs_credits(db, make_user, make_creation, steps_succeed, monkeypatch):
    monkeypatch.delenv("FREE_PAINTING", raising=False)
    user = make_user(credits=0)
    hero = make_creation(user.id, steps={RENDER: "pending"})
    with pytest.raises(ValueError, match="Insufficient credits"):
        _run(pipeline.execute_step(hero.id, user.id, RENDER, db))
    assert _grants(db, user.id) == []


def test_a_first_painting_is_free_and_the_balance_ends_at_zero(db, make_user, make_creation, steps_succeed, offer_on):
    user = make_user(credits=0)
    hero = make_creation(user.id, steps={RENDER: "pending", "meshy_3d": "pending"})

    result = _run(pipeline.execute_step(hero.id, user.id, RENDER, db))

    assert result["status"] == "completed"
    db.refresh(user)
    assert user.credits == 0                       # granted 2, spent 2
    assert len(_grants(db, user.id)) == 1
    # The pause: the 3D step after it needs paying for.
    with pytest.raises(ValueError, match="Insufficient credits"):
        _run(pipeline.execute_step(hero.id, user.id, "meshy_3d", db))


def test_only_once_per_account(db, make_user, make_creation, steps_succeed, offer_on):
    user = make_user(credits=0)
    first = make_creation(user.id, steps={RENDER: "pending"})
    second = make_creation(user.id, steps={RENDER: "pending"})
    _run(pipeline.execute_step(first.id, user.id, RENDER, db))

    with pytest.raises(ValueError, match="Insufficient credits"):
        _run(pipeline.execute_step(second.id, user.id, RENDER, db))
    assert len(_grants(db, user.id)) == 1
    assert free_painting.eligible(db, user.id) is False


def test_an_account_that_has_bought_pays_as_always(db, make_user, make_creation, steps_succeed, offer_on):
    user = make_user(credits=0)
    ledger.record_purchase(user.id, 30, db, external_ref="order-1")
    ledger.spend_credits(user.id, 30, db)  # spent it all
    hero = make_creation(user.id, steps={RENDER: "pending"})

    assert free_painting.eligible(db, user.id) is False
    with pytest.raises(ValueError, match="Insufficient credits"):
        _run(pipeline.execute_step(hero.id, user.id, RENDER, db))
    assert _grants(db, user.id) == []


def test_an_account_with_credits_spends_its_own(db, make_user, make_creation, steps_succeed, offer_on):
    user = make_user(credits=10)  # a class seat, a gift: it can pay
    hero = make_creation(user.id, steps={RENDER: "pending"})
    _run(pipeline.execute_step(hero.id, user.id, RENDER, db))
    db.refresh(user)
    assert user.credits == 10 - RENDER_COST
    assert _grants(db, user.id) == []
    assert free_painting.eligible(db, user.id) is True  # still due, unused


def test_a_failed_free_painting_is_refunded_into_a_retry(db, make_user, make_creation, offer_on, monkeypatch):
    monkeypatch.setattr(pipeline, "get_storage", lambda: _AllFilesExist())

    async def boom(*_a, **_kw):
        raise RuntimeError("provider exploded")
    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda _n: boom)
    user = make_user(credits=0)
    hero = make_creation(user.id, steps={RENDER: "pending"})

    with pytest.raises(RuntimeError):
        _run(pipeline.execute_step(hero.id, user.id, RENDER, db))
    db.refresh(user)
    # The refund gives the painting's credits back: the retry is still free.
    assert user.credits == RENDER_COST
    assert len(_grants(db, user.id)) == 1


def test_me_says_whether_the_free_painting_is_due(db, make_user, offer_on):
    user = make_user(credits=0)
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {create_access_token(user.id)}"}
    assert client.get("/api/v1/me", headers=headers).json()["free_painting"] is True
    ledger.record_purchase(user.id, 30, db, external_ref="order-2")
    assert client.get("/api/v1/me", headers=headers).json()["free_painting"] is False


# --- Starting a hero with no credits: the app, never an API key -------------

import base64  # noqa: E402
import io  # noqa: E402

from PIL import Image  # noqa: E402


@pytest.fixture
def client(monkeypatch):
    """The app with the REAL task manager, so a started hero runs the real
    pipeline (only the providers stood in for), as in test_public_api.py."""
    async def fine(*_a, **_kw):
        return None
    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda _n: fine)
    monkeypatch.setattr(pipeline, "get_storage", lambda: _AllFilesExist())
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


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


def _key(client, user):
    r = client.post("/api/v1/keys", json={"name": "test"}, headers=_bearer(create_access_token(user.id)))
    assert r.status_code == 201, r.text
    return r.json()


def _start(client, headers):
    return client.post("/api/v1/heroes", headers=headers,
                       json={"image_base64": base64.b64encode(_png()).decode()})


def test_the_app_starts_a_first_hero_with_no_credits(client, make_user, offer_on):
    user = make_user(credits=0)
    r = _start(client, {"Authorization": f"Bearer {create_access_token(user.id)}"})
    assert r.status_code == 202, r.text


def test_an_api_key_never_gets_the_free_painting(client, make_user, offer_on):
    user = make_user(credits=0)
    key = _key(client, user)["key"]
    assert _start(client, _bearer(key)).status_code == 402


def test_without_the_offer_the_app_still_needs_credits(client, make_user, monkeypatch):
    monkeypatch.delenv("FREE_PAINTING", raising=False)
    user = make_user(credits=0)
    assert _start(client, {"Authorization": f"Bearer {create_access_token(user.id)}"}).status_code == 402


def _upload_then_start(client, headers, **body):
    up = client.post("/api/v1/heroes", headers=headers, files={"drawing": ("d.png", _png(), "image/png")},
                     data={"start": "false"})
    assert up.status_code in (200, 201, 202), up.text
    return client.post(f"/api/v1/heroes/{up.json()['id']}/start", headers=headers, json=body)


def test_the_apps_upload_then_start_works_with_no_credits(client, make_user, offer_on):
    user = make_user(credits=0)
    r = _upload_then_start(client, {"Authorization": f"Bearer {create_access_token(user.id)}"})
    assert r.status_code == 202, r.text


def test_resuming_after_the_painting_still_needs_paying(client, make_user, offer_on):
    user = make_user(credits=0)
    r = _upload_then_start(client, {"Authorization": f"Bearer {create_access_token(user.id)}"}, from_stage="model")
    assert r.status_code == 402


def test_upload_then_start_without_the_offer_needs_credits(client, make_user, monkeypatch):
    monkeypatch.delenv("FREE_PAINTING", raising=False)
    user = make_user(credits=0)
    r = _upload_then_start(client, {"Authorization": f"Bearer {create_access_token(user.id)}"})
    assert r.status_code == 402
