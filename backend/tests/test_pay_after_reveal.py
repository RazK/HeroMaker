"""Pay after the reveal (E-006), end to end, with the grow_sandbox provider.

One story, every hop on the product's own code path, nothing written to the
ledger by the test:

    new account, 0 credits
    -> POST /api/v1/heroes (upload) + POST /heroes/{id}/start     the app's two calls
    -> pipeline.run_pipeline -> execute_step: cleanup (0), painting FREE (granted 2, spent 2)
    -> meshy_3d: NOT_ENOUGH_CREDITS, nothing charged, the run stops (the pause)
    -> POST /api/v1/checkout {"pack": "single"}                   our stored order, ₪10
    -> POST /api/payments/sandbox/checkout/<order>/pay            the SERVER signs the callback
                                                                  -> payments.handle_grow_callback
                                                                  -> ledger.record_purchase (+10)
    -> POST /heroes/{id}/start {"from_stage": "model"}            HeroScreen's "Try again"
    -> meshy_3d (5) + meshy_rig (2) + convert_vrm (1) = 8 charged, hero completed, balance 2

Only the providers are stood in for (get_step_coroutine), as in
test_free_painting.py and test_step_refunds.py; execute_step, run_pipeline, the
task manager, the v1 API, the sandbox page and the callback handler are real.
"""
import io
import time
from urllib.parse import urlsplit

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import packs as packs_config
from app.config.steps import calculate_steps_cost, get_step_cost
from app.main import app
from app.models import CheckoutOrder, CreditTransaction
from app.services import free_painting, ledger, pipeline, step_errors
from app.services.auth import create_access_token

FRONTEND = "https://app.test"
HERO = packs_config.creation_credit_price()          # 10: one full hero
PAINT = get_step_cost("openai_render")               # 2
AFTER_PAINT = calculate_steps_cost(["meshy_3d", "meshy_rig", "convert_vrm"])  # 8


class _AllFilesExist:
    def file_exists(self, *_a, **_kw):
        return True

    def get_file_path(self, *_a, **_kw):
        return "/dev/null"


@pytest.fixture
def providers(monkeypatch):
    """Stand-ins for OpenAI, Meshy and the converter. Records each call, and
    meshy_3d leaves its task id where meshy_rig reads it, as the real one does."""
    calls = []

    def fake(name):
        async def step(creation_id, user_id, db):
            calls.append(name)
            if name == "meshy_3d":
                s = pipeline.find_step(db, creation_id, "meshy_3d")
                s.metadata_json = {"meshy_3d_task_id": "fake-task"}
                db.commit()
        return step

    monkeypatch.setattr(pipeline, "get_step_coroutine", fake)
    monkeypatch.setattr(pipeline, "get_storage", lambda: _AllFilesExist())
    return calls


@pytest.fixture
def sandbox(monkeypatch):
    """Staging as Raz will demo it: grow_sandbox armed, FREE_PAINTING on."""
    monkeypatch.setenv("PAYMENTS_PROVIDER", "grow_sandbox")
    monkeypatch.setenv("GROW_SANDBOX_SECRET", "test-sandbox-secret")
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "staging")
    monkeypatch.setenv("FRONTEND_URL", FRONTEND)
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    monkeypatch.setenv("FREE_PAINTING", "on")


@pytest.fixture
def client(providers):
    """The app with the REAL task manager, so a started hero runs the real pipeline."""
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


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _balance(db, user_id):
    db.expire_all()
    cached, summed = ledger.get_balance(user_id, db), ledger.get_ledger_balance(user_id, db)
    assert cached == summed, f"cached balance {cached} disagrees with the ledger sum {summed}"
    return cached


def _wait_settled(client, headers, hero_id, timeout=10):
    end = time.time() + timeout
    v = None
    while time.time() < end:
        v = client.get(f"/api/v1/heroes/{hero_id}", headers=headers).json()
        if v["status"] in ("completed", "failed"):
            return v
        time.sleep(0.05)
    raise AssertionError(f"hero still {v and v['status']}")


def _rows(db, user_id):
    db.expire_all()
    return (db.query(CreditTransaction).filter(CreditTransaction.user_id == user_id)
            .order_by(CreditTransaction.created_at, CreditTransaction.id).all())


def _spent(db, user_id, step):
    return [r for r in _rows(db, user_id)
            if r.reason == "spend" and (r.metadata_json or {}).get("step_name") == step]


def _stage(view, name):
    return next(s for s in view["stages"] if s["stage"] == name)


def test_a_new_account_sees_its_painting_pays_once_and_gets_its_hero(sandbox, client, db, make_user, providers):
    user = make_user(credits=0)
    headers = _auth(user)
    assert client.get("/api/v1/me", headers=headers).json()["free_painting"] is True

    # 1. The app uploads the drawing, then starts it: 0 credits is enough.
    up = client.post("/api/v1/heroes", headers=headers,
                     files={"drawing": ("d.png", _png(), "image/png")}, data={"start": "false"})
    assert up.status_code in (200, 201, 202), up.text
    hero_id = up.json()["id"]
    r = client.post(f"/api/v1/heroes/{hero_id}/start", headers=headers, json={})
    assert r.status_code == 202, r.text

    # 2. The reveal, then the pause at the 3D step.
    paused = _wait_settled(client, headers, hero_id)
    assert paused["status"] == "failed"
    assert _stage(paused, "painting")["status"] == "completed"
    model = _stage(paused, "model")
    assert model["status"] == "failed"
    assert model["error"]["code"] == step_errors.NOT_ENOUGH_CREDITS   # "not_enough_credits"
    assert _stage(paused, "rig")["status"] == "pending"
    assert providers == ["image_processing", "openai_render"]   # Meshy never called

    rows = _rows(db, user.id)
    assert [(r.reason, r.delta) for r in rows] == [("coupon", PAINT), ("spend", -PAINT)]
    assert rows[0].external_ref == f"free-painting:{user.id}"
    assert _spent(db, user.id, "meshy_3d") == []                 # the pause charged nothing
    assert not [r for r in rows if r.reason == "refund"]         # and so refunded nothing
    assert _balance(db, user.id) == 0
    assert client.get("/api/v1/me", headers=headers).json()["free_painting"] is False

    # Trying to resume before paying is refused up front, and charges nothing.
    early = client.post(f"/api/v1/heroes/{hero_id}/start", headers=headers, json={"from_stage": "model"})
    assert early.status_code == 402
    assert _balance(db, user.id) == 0

    # 3. Buy "single" (₪10) through the sandbox: open a checkout...
    out = client.post("/api/v1/checkout", headers=headers,
                      json={"pack": "single", "redirect_url": f"{FRONTEND}/hero/{hero_id}?purchased=1"})
    assert out.status_code == 200, out.text
    out = out.json()
    assert out["price_display"] == "₪10" and out["test_mode"] is True
    path = urlsplit(out["checkout_url"]).path
    assert path.startswith("/api/payments/sandbox/checkout/")
    order_id = path.rsplit("/", 1)[-1]
    assert _balance(db, user.id) == 0                            # opening a checkout grants nothing

    # ...then press Pay on the sandbox page. The server signs the callback.
    paid = client.post(f"{path}/pay", follow_redirects=False)
    assert paid.status_code == 303
    assert paid.headers["location"] == f"{FRONTEND}/hero/{hero_id}?purchased=1"
    db.expire_all()
    order = db.query(CheckoutOrder).filter(CheckoutOrder.id == order_id).one()
    assert order.status == "paid" and order.amount_minor == 1000 and order.credits == HERO
    assert _balance(db, user.id) == HERO
    purchases = [r for r in _rows(db, user.id) if r.reason == "purchase"]
    assert len(purchases) == 1 and purchases[0].delta == HERO
    receipts = client.get("/api/v1/receipts", headers=headers).json()
    assert [x["credits"] for x in receipts] == [HERO]

    # 4. "Try again" resumes from the first unfinished stage, as HeroScreen does.
    r = client.post(f"/api/v1/heroes/{hero_id}/start", headers=headers, json={"from_stage": "model"})
    assert r.status_code == 202, r.text
    done = _wait_settled(client, headers, hero_id)
    assert done["status"] == "completed", done
    assert all(s["status"] == "completed" for s in done["stages"])

    # The painting is not made (or paid for) again; each remaining step once.
    assert providers == ["image_processing", "openai_render", "meshy_3d", "meshy_rig", "convert_vrm"]
    assert len(_spent(db, user.id, "openai_render")) == 1
    for step in ("meshy_3d", "meshy_rig", "convert_vrm"):
        assert [-r.delta for r in _spent(db, user.id, step)] == [get_step_cost(step)]
    assert not [r for r in _rows(db, user.id) if r.reason == "refund"]
    assert _balance(db, user.id) == HERO - AFTER_PAINT == 2
    assert ledger.verify_user_balance(user.id, db).consistent

    # The free painting stays spent: the next hero pays in full.
    assert free_painting.eligible(db, user.id) is False


def test_without_the_offer_a_zero_credit_account_cannot_start(sandbox, client, db, make_user, providers, monkeypatch):
    monkeypatch.delenv("FREE_PAINTING", raising=False)
    user = make_user(credits=0)
    headers = _auth(user)
    assert client.get("/api/v1/me", headers=headers).json()["free_painting"] is False

    started = client.post("/api/v1/heroes", headers=headers,
                          files={"drawing": ("d.png", _png(), "image/png")}, data={"start": "true"})
    assert started.status_code == 402

    up = client.post("/api/v1/heroes", headers=headers,
                     files={"drawing": ("d.png", _png(), "image/png")}, data={"start": "false"})
    assert up.status_code in (200, 201, 202), up.text
    r = client.post(f"/api/v1/heroes/{up.json()['id']}/start", headers=headers, json={})
    assert r.status_code == 402
    assert providers == []
    assert _rows(db, user.id) == []
    assert _balance(db, user.id) == 0
