"""
Every new hero gets a name from its drawing.

Drives the REAL code path: `pipeline.execute_step("image_processing")`, which
starts `hero_naming.name_creation`, which calls the real
`openai.suggest_hero_name`, which records usage through the real
`usage.track`. Only the wire is fake: the OpenAI SDK client. Storage is a real
LocalFileStorage in a temp directory, the database the throwaway test one.
"""
import asyncio
import importlib.util
import io
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import openai as openai_sdk
import pytest
from PIL import Image

from app.config import pricing
from app.database import SessionLocal
from app.models import Creation, UsageEvent
from app.services import hero_naming, pipeline, result_cache
from app.services import openai as openai_service
from app.utils.storage import LocalFileStorage


def _drawing(colour=(200, 30, 30)) -> bytes:
    img = Image.new("RGB", (1200, 900), (255, 255, 255))
    img.paste(Image.new("RGB", (400, 600), colour), (400, 150))
    out = io.BytesIO()
    img.save(out, format="JPEG")
    return out.getvalue()


DRAWING = _drawing()


class FakeOpenAI:
    """Stands in for openai.OpenAI. Records every call; answers as configured."""

    instances = []
    calls = []
    answer = '{"name": "Ruby Rocket"}'
    error = None
    during_call = None  # callable run while the "request" is in flight

    def __init__(self, api_key=None, **kwargs):
        FakeOpenAI.instances.append(kwargs)
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))
        self.images = SimpleNamespace(edit=self._edit)

    @classmethod
    def reset(cls):
        cls.instances, cls.calls = [], []
        cls.answer, cls.error, cls.during_call = '{"name": "Ruby Rocket"}', None, None

    def _create(self, **kwargs):
        FakeOpenAI.calls.append(kwargs)
        if FakeOpenAI.during_call:
            FakeOpenAI.during_call()
        if FakeOpenAI.error is not None:
            raise FakeOpenAI.error
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=FakeOpenAI.answer))],
            usage=SimpleNamespace(prompt_tokens=600, completion_tokens=10),
            _request_id="req_name_1",
        )

    def _edit(self, **kwargs):
        import base64
        return SimpleNamespace(
            data=[SimpleNamespace(b64_json=base64.b64encode(b"render").decode())],
            _request_id="req_render_1",
        )


@pytest.fixture(autouse=True)
def fake_openai(monkeypatch):
    FakeOpenAI.reset()
    monkeypatch.setattr(openai_service, "OpenAI", FakeOpenAI)
    monkeypatch.setattr(openai_service, "OPENAI_API_KEY", "test-key")
    monkeypatch.delenv(result_cache.ENV_FLAG, raising=False)
    return FakeOpenAI


@pytest.fixture
def storage(tmp_path, monkeypatch):
    store = LocalFileStorage()
    store.files_root = tmp_path / "files"
    store.files_root.mkdir()
    for module in (pipeline, result_cache, hero_naming):
        monkeypatch.setattr(module, "get_storage", lambda: store)
    monkeypatch.setattr("app.utils.file_utils.get_storage", lambda: store, raising=False)
    return store


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _new_hero(make_creation, storage, user, character_name=None, drawing=DRAWING, steps=None):
    creation = make_creation(user.id, steps=steps or {"image_processing": "pending"})
    if character_name is not None:
        s = SessionLocal()
        s.query(Creation).filter(Creation.id == creation.id).update(
            {Creation.character_name: character_name})
        s.commit()
        s.close()
    storage.upload_file(user.id, creation.id, "original.jpg", drawing)
    return creation


def _process(db, creation, user):
    """Run the real image_processing step and wait for the naming it started."""
    result = _run(pipeline.execute_step(creation.id, user.id, "image_processing", db))
    _run(pipeline.wait_for_hero_naming(creation.id))
    return result


def _name_of(creation_id):
    s = SessionLocal()
    try:
        return s.query(Creation).filter(Creation.id == creation_id).first().character_name
    finally:
        s.close()


def _events(creation_id):
    s = SessionLocal()
    try:
        return s.query(UsageEvent).filter(UsageEvent.creation_id == creation_id).all()
    finally:
        s.close()


# ---------------------------------------------------------------------------
# A name is set when empty
# ---------------------------------------------------------------------------

def test_an_unnamed_hero_is_named_from_its_drawing(db, make_user, make_creation, storage):
    user = make_user(credits=10)
    creation = _new_hero(make_creation, storage, user)

    assert _process(db, creation, user) == {"status": "completed"}

    assert _name_of(creation.id) == "Ruby Rocket"
    assert storage.file_exists(user.id, creation.id, "processed.jpg")

    # The request: the configured model, Structured Outputs, the drawing,
    # the generic prompt, a short timeout and no SDK retries.
    (call,) = FakeOpenAI.calls
    assert call["model"] == openai_service.HERO_NAME_MODEL == "gpt-4.1-mini"
    assert call["response_format"]["type"] == "json_schema"
    assert call["response_format"]["json_schema"]["schema"]["required"] == ["name"]
    text, image = call["messages"][0]["content"]
    assert text["text"] == openai_service.HERO_NAME_PROMPT
    assert image["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert call["timeout"] <= 10
    assert FakeOpenAI.instances[-1] == {"timeout": openai_service.HERO_NAME_TIMEOUT_S, "max_retries": 0}

    db.refresh(user)
    assert user.credits == 10, "naming must not cost the user credits"


def test_an_empty_or_blank_name_counts_as_unnamed(db, make_user, make_creation, storage):
    user = make_user()
    creation = _new_hero(make_creation, storage, user, character_name="   ")
    _process(db, creation, user)
    assert _name_of(creation.id) == "Ruby Rocket"


# ---------------------------------------------------------------------------
# A user-given name is never overwritten
# ---------------------------------------------------------------------------

def test_a_name_the_user_gave_is_kept_and_no_call_is_made(db, make_user, make_creation, storage):
    user = make_user()
    creation = _new_hero(make_creation, storage, user, character_name="Captain Noodle")

    assert _process(db, creation, user) == {"status": "completed"}

    assert _name_of(creation.id) == "Captain Noodle"
    assert FakeOpenAI.calls == []
    assert _events(creation.id) == []


def test_a_rename_during_the_call_wins(db, make_user, make_creation, storage):
    """The user types a name while OpenAI is still thinking: theirs stays."""
    user = make_user()
    creation = _new_hero(make_creation, storage, user)

    def user_renames():
        s = SessionLocal()
        s.query(Creation).filter(Creation.id == creation.id).update(
            {Creation.character_name: "Mister Sprinkles"})
        s.commit()
        s.close()

    FakeOpenAI.during_call = user_renames
    _process(db, creation, user)

    assert len(FakeOpenAI.calls) == 1
    assert _name_of(creation.id) == "Mister Sprinkles"


def test_backfill_leaves_a_named_hero_alone(make_user, make_creation, storage):
    user = make_user()
    creation = _new_hero(make_creation, storage, user, character_name="Zed")
    assert hero_naming.name_creation(creation.id, user.id) is None
    assert _name_of(creation.id) == "Zed"
    assert FakeOpenAI.calls == []


# ---------------------------------------------------------------------------
# Failure leaves the name empty and the pipeline carries on
# ---------------------------------------------------------------------------

try:   # the OpenAI SDK's HTTP client, under whichever name this version ships
    httpx = importlib.import_module("httpx2")
except ImportError:   # pragma: no cover
    httpx = importlib.import_module("httpx")

_REQ = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")


@pytest.mark.parametrize("error", [
    openai_sdk.APITimeoutError(request=_REQ),
    openai_sdk.APIStatusError("boom", response=httpx.Response(500, request=_REQ), body=None),
    openai_sdk.RateLimitError("slow down", response=httpx.Response(429, request=_REQ), body=None),
    RuntimeError("anything at all"),
], ids=["timeout", "500", "429", "unexpected"])
def test_an_openai_failure_leaves_the_name_empty_and_the_pipeline_continues(
        db, make_user, make_creation, storage, error):
    user = make_user(credits=10)
    creation = _new_hero(
        make_creation, storage, user,
        steps={"image_processing": "pending", "openai_render": "pending"},
    )
    FakeOpenAI.error = error

    assert _process(db, creation, user) == {"status": "completed"}
    assert _name_of(creation.id) is None

    # The next step runs as if nothing happened.
    assert _run(pipeline.execute_step(creation.id, user.id, "openai_render", db)) == {"status": "completed"}

    # The failed call is still on the books, at zero cost.
    (event,) = [e for e in _events(creation.id) if e.operation == pricing.OP_OPENAI_HERO_NAME]
    assert event.status == "failed"
    assert event.cost_usd_micros == 0


def test_no_api_key_means_no_name_and_no_call(db, make_user, make_creation, storage, monkeypatch):
    monkeypatch.setattr(openai_service, "OPENAI_API_KEY", None)
    user = make_user()
    creation = _new_hero(make_creation, storage, user)
    assert _process(db, creation, user) == {"status": "completed"}
    assert _name_of(creation.id) is None
    assert FakeOpenAI.calls == []


def test_naming_does_not_hold_up_the_step(db, make_user, make_creation, storage):
    """The step finishes while the naming call is still in flight."""
    import threading
    release = threading.Event()
    FakeOpenAI.during_call = lambda: release.wait(5)
    user = make_user()
    creation = _new_hero(make_creation, storage, user)

    result = _run(pipeline.execute_step(creation.id, user.id, "image_processing", db))
    assert result == {"status": "completed"}
    assert _name_of(creation.id) is None  # not yet

    release.set()
    _run(pipeline.wait_for_hero_naming(creation.id))
    assert _name_of(creation.id) == "Ruby Rocket"


# ---------------------------------------------------------------------------
# Output is sanitized
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("raw, expected", [
    ("  Prickle Pete  ", "Prickle Pete"),
    ('"Brick Bo"', "Brick Bo"),
    ("“Ruby Rocket”", "Ruby Rocket"),
    ("Captain O'Toole", "Captain O Toole"),
    ("Zoom \U0001F680 Zara", "Zoom Zara"),
    ("Robo 3000", "Robo"),
    ("One Two Three Four Five", "One Two Three"),
    ("Sparkleberry Thunderpants Magnificent", "Sparkleberry"),
    ("Supercalifragilisticexpialidocious", "Supercalifragilisticexpi"),
    ("Zig-Zag Zed!", "Zig-Zag Zed"),
    ("--Dash--", "Dash"),
    ("\U0001F680\U0001F680", None),
    ("   ", None),
    ("", None),
    (None, None),
    (42, None),
])
def test_sanitize_hero_name(raw, expected):
    name = openai_service.sanitize_hero_name(raw)
    assert name == expected
    if name:
        assert name == name.strip()
        assert len(name.split()) <= 3
        assert len(name) <= 24
        assert not any(q in name for q in "\"'“”‘’")


def test_the_pipeline_stores_the_sanitized_name(db, make_user, make_creation, storage):
    FakeOpenAI.answer = json.dumps({"name": '  "Zippy \U0001F680 Zap 3000 Extra Words"  '})
    user = make_user()
    creation = _new_hero(make_creation, storage, user)
    _process(db, creation, user)
    assert _name_of(creation.id) == "Zippy Zap Extra"


def test_an_unusable_answer_leaves_the_name_empty(db, make_user, make_creation, storage):
    FakeOpenAI.answer = json.dumps({"name": "\U0001F680 123 !!"})
    user = make_user()
    creation = _new_hero(make_creation, storage, user)
    _process(db, creation, user)
    assert _name_of(creation.id) is None


# ---------------------------------------------------------------------------
# The usage event is recorded
# ---------------------------------------------------------------------------

def test_the_naming_call_is_recorded_as_a_usage_event(db, make_user, make_creation, storage):
    user = make_user()
    creation = _new_hero(make_creation, storage, user)
    _process(db, creation, user)

    (event,) = _events(creation.id)
    assert event.provider == pricing.PROVIDER_OPENAI
    assert event.operation == pricing.OP_OPENAI_HERO_NAME
    assert event.status == "succeeded"
    assert event.user_id == user.id
    assert event.step_name == hero_naming.USAGE_STEP
    assert event.provider_ref == "req_name_1"
    # Costed from the reported tokens: 600 in, 10 out at gpt-4.1-mini rates.
    assert event.cost_usd_micros == pricing.hero_name_cost_usd_micros(600, 10) == 256
    assert event.cost_usd_micros <= pricing.OPENAI_HERO_NAME_USD_MICROS
    assert event.metadata_json["model"] == "gpt-4.1-mini"
    assert event.metadata_json["prompt_tokens"] == 600


# ---------------------------------------------------------------------------
# The staging result cache
# ---------------------------------------------------------------------------

def test_the_same_drawing_is_named_from_the_cache(db, make_user, make_creation, storage, monkeypatch):
    monkeypatch.setenv(result_cache.ENV_FLAG, "1")
    monkeypatch.delenv("RAILWAY_ENVIRONMENT_NAME", raising=False)
    monkeypatch.delenv("RAILWAY_ENVIRONMENT", raising=False)
    user = make_user()

    first = _new_hero(make_creation, storage, user)
    _process(db, first, user)
    second = _new_hero(make_creation, storage, user)
    _process(db, second, user)

    assert len(FakeOpenAI.calls) == 1, "the repeated drawing must not be paid for twice"
    assert _name_of(first.id) == _name_of(second.id) == "Ruby Rocket"
    (hit,) = _events(second.id)
    assert hit.status == "cache_hit" and hit.cost_usd_micros == 0
    assert hit.metadata_json["skipped_operation"] == pricing.OP_OPENAI_HERO_NAME

    # A different drawing is a miss.
    third = _new_hero(make_creation, storage, user, drawing=_drawing((20, 20, 200)))
    _process(db, third, user)
    assert len(FakeOpenAI.calls) == 2


def test_the_cache_is_off_by_default(db, make_user, make_creation, storage):
    user = make_user()
    for _ in range(2):
        _process(db, _new_hero(make_creation, storage, user), user)
    assert len(FakeOpenAI.calls) == 2


# ---------------------------------------------------------------------------
# The backfill script
# ---------------------------------------------------------------------------

def _load_backfill():
    path = Path(__file__).resolve().parent.parent / "scripts" / "backfill_hero_names.py"
    spec = importlib.util.spec_from_file_location("backfill_hero_names", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["backfill_hero_names"] = module
    spec.loader.exec_module(module)
    return module


def test_backfill_names_only_completed_unnamed_heroes(make_user, make_creation, storage, completed_steps):
    backfill = _load_backfill()
    user = make_user()
    unnamed = _new_hero(make_creation, storage, user, steps=completed_steps)
    named = _new_hero(make_creation, storage, user, character_name="Kept Name", steps=completed_steps)
    unfinished = _new_hero(make_creation, storage, user, steps={"image_processing": "completed",
                                                                "openai_render": "pending"})
    lines = []

    dry = backfill.run(dry_run=True, out=lines.append)
    assert dry["candidates"] == 1 and dry["named"] == 0
    assert FakeOpenAI.calls == [], "a dry run makes no calls"
    assert _name_of(unnamed.id) is None, "a dry run writes nothing"

    real = backfill.run(out=lines.append)
    assert real == {"candidates": 1, "named": 1, "skipped": 0, "dry_run": False}
    assert _name_of(unnamed.id) == "Ruby Rocket"
    assert _name_of(named.id) == "Kept Name"
    assert _name_of(unfinished.id) is None
    assert len(_events(unnamed.id)) == 1


def test_backfill_refuses_to_run_without_a_database(monkeypatch, capsys):
    backfill = _load_backfill()
    monkeypatch.delenv("DATABASE_URL", raising=False)  # restored after the test
    assert backfill.main(["--dry-run"]) == 2
    assert "no database" in capsys.readouterr().err
