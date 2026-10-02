"""
The staging result cache: same input, same step, same prompt -> no second bill.

Drives the REAL `pipeline.execute_step` (credits, usage capture, the real step
coroutines, the real `openai.render_image` and `MeshyClient` methods). Only the
wire is stubbed: the OpenAI SDK client and MeshyClient's HTTP layer. Storage is
a real LocalFileStorage in a temp directory.
"""
import asyncio
import base64
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.config import pricing
from app.database import SessionLocal
from app.models import CreationStep, CreditTransaction, UsageEvent
from app.services import openai as openai_service
from app.services import pipeline, result_cache
from app.services.meshy import MeshyClient
from app.utils.storage import LocalFileStorage

PAID_STEPS = ("openai_render", "meshy_3d", "meshy_rig")
PAID_STEPS_CREDITS = 2 + 5 + 2          # app/config/steps.py
DRAWING = b"\xff\xd8\xff crayon kid drawing, byte for byte the same every run"


# ---------------------------------------------------------------------------
# Fakes: only the network is fake.
# ---------------------------------------------------------------------------

class Providers:
    """Counts real provider calls and answers them with fresh bytes each time."""

    def __init__(self):
        self.openai_calls = []
        self.meshy_posts = []
        self.downloads = 0


@pytest.fixture
def providers(monkeypatch):
    calls = Providers()

    class FakeImages:
        def edit(self, **kwargs):
            calls.openai_calls.append(kwargs)
            png = f"render #{len(calls.openai_calls)}".encode()
            return SimpleNamespace(
                data=[SimpleNamespace(b64_json=base64.b64encode(png).decode())],
                _request_id=f"req_{len(calls.openai_calls)}",
            )

    class FakeOpenAI:
        def __init__(self, api_key):
            self.images = FakeImages()

    monkeypatch.setattr(openai_service, "OpenAI", FakeOpenAI)
    monkeypatch.setattr(openai_service, "OPENAI_API_KEY", "test-key")

    class FakeMeshy(MeshyClient):
        def __init__(self, api_key=None):
            super().__init__(api_key="test-key")

        def _request(self, method, endpoint, **kwargs):
            if method == "POST":
                calls.meshy_posts.append(endpoint)
                return {"result": f"task-{len(calls.meshy_posts)}"}
            task = endpoint.rsplit("/", 1)[-1]
            if "/rigging/" in endpoint:
                return {"status": "SUCCEEDED", "progress": 100, "result": {
                    "rigged_character_glb_url": f"https://fake/{task}/rigged.glb",
                    "basic_animations": {"walking_glb_url": f"https://fake/{task}/walking.glb"},
                }}
            return {"status": "SUCCEEDED", "progress": 100,
                    "model_urls": {"glb": f"https://fake/{task}/model.glb"}}

        def download_file(self, url, output_path):
            calls.downloads += 1
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)
            Path(output_path).write_bytes(f"downloaded {url}".encode())
            return output_path

    monkeypatch.setattr(pipeline, "MeshyClient", FakeMeshy)
    monkeypatch.setattr(pipeline.time, "sleep", lambda *_a: None)
    return calls


@pytest.fixture
def storage(tmp_path, monkeypatch):
    store = LocalFileStorage()
    store.files_root = tmp_path / "files"
    store.files_root.mkdir()
    for module in (pipeline, result_cache):
        monkeypatch.setattr(module, "get_storage", lambda: store)
    monkeypatch.setattr("app.utils.file_utils.get_storage", lambda: store, raising=False)
    return store


@pytest.fixture
def cache_on(monkeypatch):
    monkeypatch.setenv(result_cache.ENV_FLAG, "1")
    monkeypatch.delenv("RAILWAY_ENVIRONMENT_NAME", raising=False)
    monkeypatch.delenv("RAILWAY_ENVIRONMENT", raising=False)


@pytest.fixture
def cache_off(monkeypatch):
    monkeypatch.delenv(result_cache.ENV_FLAG, raising=False)


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _new_hero(db, make_creation, storage, user, drawing=DRAWING):
    creation = make_creation(user.id, steps={s: "pending" for s in PAID_STEPS})
    storage.upload_file(user.id, creation.id, "processed.jpg", drawing)
    return creation


def _make_hero(db, creation, user):
    for step in PAID_STEPS:
        result = _run(pipeline.execute_step(creation.id, user.id, step, db))
        assert result == {"status": "completed"}, step


def _events(creation_id):
    s = SessionLocal()
    try:
        return s.query(UsageEvent).filter(UsageEvent.creation_id == creation_id).all()
    finally:
        s.close()


def _paid_events(creation_id):
    return [e for e in _events(creation_id)
            if e.provider in (pricing.PROVIDER_OPENAI, pricing.PROVIDER_MESHY)]


def _spent(db, creation_id):
    return -sum(t.delta for t in db.query(CreditTransaction).filter(
        CreditTransaction.creation_id == creation_id,
        CreditTransaction.reason == "spend").all())


def _outputs(storage, user_id, creation_id):
    return {name: storage.download_file(user_id, creation_id, name)
            for name in ("rendered.png", "model.glb", "rigged.glb", "walking.glb")}


def _cache_dir(storage):
    return storage.files_root / result_cache.CACHE_OWNER


# ---------------------------------------------------------------------------

def test_second_identical_run_does_not_call_the_providers(
        db, make_user, make_creation, storage, providers, cache_on):
    user = make_user(credits=100)

    first = _new_hero(db, make_creation, storage, user)
    _make_hero(db, first, user)
    assert len(providers.openai_calls) == 1
    assert providers.meshy_posts == ["/openapi/v1/image-to-3d", "/openapi/v1/rigging"]
    assert len(_paid_events(first.id)) == 3

    # A different user, same drawing: the staging robot's second run.
    other = make_user(credits=100)
    second = _new_hero(db, make_creation, storage, other)
    _make_hero(db, second, other)

    # No provider was touched...
    assert len(providers.openai_calls) == 1
    assert len(providers.meshy_posts) == 2
    # ...and the hero is the same hero, file for file.
    assert _outputs(storage, other.id, second.id) == _outputs(storage, user.id, first.id)

    # meshy_rig's dependency and the walking animation came along.
    s3d = db.query(CreationStep).filter_by(creation_id=second.id, step_name="meshy_3d").one()
    srig = db.query(CreationStep).filter_by(creation_id=second.id, step_name="meshy_rig").one()
    f3d = db.query(CreationStep).filter_by(creation_id=first.id, step_name="meshy_3d").one()
    assert s3d.metadata_json["meshy_3d_task_id"] == f3d.metadata_json["meshy_3d_task_id"]
    assert s3d.metadata_json["result_cache"]["hit"] is True
    assert srig.metadata_json["walking_glb_url"] == "walking.glb"


def test_a_hit_still_charges_the_user_but_books_no_provider_cost(
        db, make_user, make_creation, storage, providers, cache_on):
    user = make_user(credits=100)
    _make_hero(db, _new_hero(db, make_creation, storage, user), user)
    second = _new_hero(db, make_creation, storage, user)
    _make_hero(db, second, user)

    # The user pays exactly as before - only our spend is saved.
    assert _spent(db, second.id) == PAID_STEPS_CREDITS
    db.refresh(user)
    assert user.credits == 100 - 2 * PAID_STEPS_CREDITS
    assert db.query(CreditTransaction).filter_by(creation_id=second.id, reason="refund").count() == 0

    # No paid usage_event; one zero-cost, clearly-marked row per cached step.
    assert _paid_events(second.id) == []
    hits = _events(second.id)
    assert sorted(e.step_name for e in hits) == sorted(PAID_STEPS)
    for e in hits:
        assert e.provider == pricing.PROVIDER_INTERNAL
        assert e.operation == pricing.OP_RESULT_CACHE_HIT
        assert e.status == "cache_hit"
        assert e.cost_usd_micros == 0
        assert e.metadata_json["cache_hit"] is True
    avoided = {e.step_name: e.metadata_json["avoided_list_price_usd_micros"] for e in hits}
    assert avoided["openai_render"] == pricing.OPENAI_IMAGE_USD_MICROS
    assert avoided["meshy_3d"] == pricing.meshy_credits_to_usd_micros(pricing.MESHY_IMAGE_TO_3D_CREDITS)


def test_changing_the_prompt_misses(
        db, make_user, make_creation, storage, providers, cache_on, monkeypatch):
    user = make_user(credits=100)
    _make_hero(db, _new_hero(db, make_creation, storage, user), user)

    monkeypatch.setattr(openai_service, "RENDER_PROMPT", openai_service.RENDER_PROMPT + " Bigger eyes.")
    second = _new_hero(db, make_creation, storage, user)
    _make_hero(db, second, user)

    assert len(providers.openai_calls) == 2
    assert providers.openai_calls[1]["prompt"].endswith("Bigger eyes.")
    # A new render is new input for Meshy, so the whole chain is paid again.
    assert len(providers.meshy_posts) == 4
    assert len(_paid_events(second.id)) == 3


def test_changing_a_meshy_parameter_misses_only_meshy(
        db, make_user, make_creation, storage, providers, cache_on, monkeypatch):
    user = make_user(credits=100)
    _make_hero(db, _new_hero(db, make_creation, storage, user), user)

    monkeypatch.setitem(pipeline.MESHY_3D_PARAMS, "enable_pbr", True)
    second = _new_hero(db, make_creation, storage, user)
    _make_hero(db, second, user)

    assert len(providers.openai_calls) == 1          # render still cached
    assert providers.meshy_posts.count("/openapi/v1/image-to-3d") == 2


def test_a_different_drawing_misses(
        db, make_user, make_creation, storage, providers, cache_on):
    user = make_user(credits=100)
    _make_hero(db, _new_hero(db, make_creation, storage, user), user)
    _make_hero(db, _new_hero(db, make_creation, storage, user, drawing=DRAWING + b"!"), user)
    assert len(providers.openai_calls) == 2


def test_flag_off_means_no_cache_at_all(
        db, make_user, make_creation, storage, providers, cache_off):
    user = make_user(credits=100)
    first = _new_hero(db, make_creation, storage, user)
    _make_hero(db, first, user)
    second = _new_hero(db, make_creation, storage, user)
    _make_hero(db, second, user)

    assert len(providers.openai_calls) == 2
    assert len(providers.meshy_posts) == 4
    assert not _cache_dir(storage).exists(), "nothing may be written when the flag is off"
    assert all(e.operation != pricing.OP_RESULT_CACHE_HIT
               for e in _events(first.id) + _events(second.id))


@pytest.mark.parametrize("value", ["", "0", "false", "no"])
def test_only_a_truthy_flag_turns_it_on(monkeypatch, value):
    monkeypatch.setenv(result_cache.ENV_FLAG, value)
    assert result_cache.enabled() is False


@pytest.mark.parametrize("var", ["RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT"])
def test_never_on_in_production_even_if_the_flag_is_set(
        db, make_user, make_creation, storage, providers, cache_on, monkeypatch, var):
    monkeypatch.setenv(var, "production")
    assert result_cache.enabled() is False

    user = make_user(credits=100)
    _make_hero(db, _new_hero(db, make_creation, storage, user), user)
    _make_hero(db, _new_hero(db, make_creation, storage, user), user)
    assert len(providers.openai_calls) == 2
    assert not _cache_dir(storage).exists()


def test_a_half_written_entry_is_a_miss(
        db, make_user, make_creation, storage, providers, cache_on):
    """The manifest is written last; without it, the files are not trusted."""
    user = make_user(credits=100)
    _make_hero(db, _new_hero(db, make_creation, storage, user), user)
    for manifest in _cache_dir(storage).glob("openai_render-*/manifest.json"):
        manifest.unlink()

    _make_hero(db, _new_hero(db, make_creation, storage, user), user)
    assert len(providers.openai_calls) == 2


def test_a_broken_cache_falls_back_to_the_provider(
        db, make_user, make_creation, storage, providers, cache_on, monkeypatch):
    user = make_user(credits=100)
    _make_hero(db, _new_hero(db, make_creation, storage, user), user)

    def broken(*_a, **_kw):
        raise OSError("bucket unreachable")
    monkeypatch.setattr(result_cache, "_load_manifest", broken)

    second = _new_hero(db, make_creation, storage, user)
    _make_hero(db, second, user)
    assert len(providers.openai_calls) == 2
    assert _spent(db, second.id) == PAID_STEPS_CREDITS


def test_a_failed_provider_call_is_refunded_and_not_cached(
        db, make_user, make_creation, storage, providers, cache_on, monkeypatch):
    """The refund path is untouched, and a failure never becomes a cache entry."""
    user = make_user(credits=100)
    creation = _new_hero(db, make_creation, storage, user)

    class Refusing:
        def __init__(self, api_key):
            self.images = self

        def edit(self, **_kw):
            raise RuntimeError("moderation_blocked")
    monkeypatch.setattr(openai_service, "OpenAI", Refusing)

    with pytest.raises(Exception):
        _run(pipeline.execute_step(creation.id, user.id, "openai_render", db))

    db.refresh(user)
    assert user.credits == 100
    assert db.query(CreditTransaction).filter_by(creation_id=creation.id, reason="refund").count() == 1
    assert list(storage.files_root.glob(f"{result_cache.CACHE_OWNER}/openai_render-*/manifest.json")) == []


def test_key_depends_on_step_input_and_version():
    v = openai_service.render_cache_version()
    k = result_cache.compute_key("openai_render", DRAWING, v)
    assert k == result_cache.compute_key("openai_render", DRAWING, dict(v))
    assert k != result_cache.compute_key("meshy_3d", DRAWING, v)
    assert k != result_cache.compute_key("openai_render", DRAWING + b" ", v)
    assert k != result_cache.compute_key("openai_render", DRAWING, {**v, "quality": "medium"})
    assert k != result_cache.compute_key("openai_render", DRAWING, {**v, "prompt": v["prompt"] + "."})
