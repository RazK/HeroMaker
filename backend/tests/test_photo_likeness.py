"""
A photo of a real person is painted as a flattering likeness; a drawing is
painted exactly as before.

Drives the REAL code path: `pipeline.execute_step("openai_render")` ->
`step_openai_render` -> `input_kind.kind_for_creation` ->
`openai.classify_input` and `openai.render_image` -> the real OpenAI SDK, with
usage recorded through the real `usage.track`. Only the HTTP transport under
the SDK is replaced, so what the tests read is what would have gone over the
wire: the classification request (JSON) and the images.edit prompt (multipart).
"""
import asyncio
import base64
import importlib
import io
import json

import pytest
from PIL import Image

from app.config import pricing
from app.config.steps import get_step_cost
from app.models import Creation, CreationStep, UsageEvent
from app.services import input_kind
from app.services import openai as openai_service
from app.services import pipeline, result_cache
from app.services.credits import get_balance
from app.utils.storage import get_storage

try:   # the OpenAI SDK's HTTP client, under whichever name this version ships
    _http = importlib.import_module("httpx2")
except ImportError:   # pragma: no cover
    _http = importlib.import_module("httpx")

PHOTO = openai_service.INPUT_KIND_PHOTO
DRAWING_KIND = openai_service.INPUT_KIND_DRAWING
STYLES = list(openai_service.STYLES)


def _jpeg(colour) -> bytes:
    """A readable upload. What it shows does not matter: the wire answers."""
    img = Image.new("RGB", (600, 800), (240, 240, 235))
    img.paste(Image.new("RGB", (200, 500), colour), (200, 150))
    out = io.BytesIO()
    img.save(out, format="JPEG")
    return out.getvalue()


UPLOAD = _jpeg((40, 60, 160))


def _png() -> bytes:
    im = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    im.paste((40, 80, 220, 255), (20, 8, 44, 60))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


PAINTING = _png()


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _multipart_field(body: bytes, content_type: str, name: str) -> str:
    boundary = content_type.split("boundary=", 1)[1].strip('"').encode()
    for part in body.split(b"--" + boundary):
        head, _, value = part.partition(b"\r\n\r\n")
        if f'name="{name}"'.encode() in head:
            return value[: -len(b"\r\n")].decode("utf-8") if value.endswith(b"\r\n") else value.decode("utf-8")
    raise AssertionError(f"no {name!r} field in the request")


class Wire:
    """The OpenAI API as seen through the SDK's transport."""

    def __init__(self):
        self.kind_answer = json.dumps({"kind": PHOTO})
        self.kind_status = 200
        self.classifications = []   # JSON bodies of chat.completions requests
        self.paintings = []         # prompts of images.edit requests

    def handler(self, request):
        body = request.read()
        url = str(request.url)
        if url.endswith("/chat/completions"):
            self.classifications.append(json.loads(body))
            if self.kind_status != 200:
                return _http.Response(self.kind_status, json={"error": {"message": "boom"}})
            return _http.Response(200, json={
                "id": "chatcmpl-1", "object": "chat.completion", "created": 1,
                "model": openai_service.INPUT_KIND_MODEL,
                "choices": [{"index": 0, "finish_reason": "stop",
                             "message": {"role": "assistant", "content": self.kind_answer}}],
                "usage": {"prompt_tokens": 620, "completion_tokens": 8, "total_tokens": 628},
            })
        assert url.endswith("/images/edits"), url
        self.paintings.append(_multipart_field(body, request.headers["content-type"], "prompt"))
        return _http.Response(200, json={"created": 1, "data": [{"b64_json": base64.b64encode(PAINTING).decode()}]})


@pytest.fixture
def wire(monkeypatch):
    w = Wire()
    real_openai = openai_service.OpenAI

    def client_on_mock_wire(api_key, **kwargs):
        kwargs["max_retries"] = 0
        return real_openai(api_key=api_key, http_client=_http.Client(transport=_http.MockTransport(w.handler)),
                           **kwargs)

    monkeypatch.setattr(openai_service, "OpenAI", client_on_mock_wire)
    monkeypatch.setattr(openai_service, "OPENAI_API_KEY", "sk-test")
    monkeypatch.delenv(result_cache.ENV_FLAG, raising=False)
    return w


def _hero(db, make_user, make_creation, style=None, upload=UPLOAD):
    user = make_user(credits=100)
    creation = make_creation(user.id, {"openai_render": "pending"})
    creation.style = style
    db.commit()
    get_storage().upload_file(user.id, creation.id, "processed.jpg", upload)
    return user, creation


def _paint(db, user, creation):
    assert _run(pipeline.execute_step(creation.id, user.id, "openai_render", db)) == {"status": "completed"}


def _drawing_prompt(style):
    """What every hero's painting was asked for before photos were told apart."""
    return openai_service.STYLES[style]["prompt"] + "\n\n" + openai_service.FRAMING_PROMPT


# ---------------------------------------------------------------------------
# The prompt
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("style", STYLES)
def test_a_photo_of_a_person_gets_the_likeness_clause(db, make_user, make_creation, wire, style):
    user, creation = _hero(db, make_user, make_creation, style=style)
    _paint(db, user, creation)

    assert len(wire.classifications) == 1
    assert wire.paintings == [_drawing_prompt(style) + "\n\n" + openai_service.PHOTO_LIKENESS_PROMPT]
    clause = openai_service.PHOTO_LIKENESS_PROMPT
    for must in ("photograph of a real person", "at least as tall and as slim",
                 "Never make them shorter, wider, heavier or older", "fuller hair"):
        assert must in clause


@pytest.mark.parametrize("style", STYLES)
def test_a_drawing_gets_exactly_todays_prompt(db, make_user, make_creation, wire, style):
    wire.kind_answer = json.dumps({"kind": DRAWING_KIND})
    user, creation = _hero(db, make_user, make_creation, style=style)
    _paint(db, user, creation)

    assert len(wire.classifications) == 1
    assert wire.paintings == [_drawing_prompt(style)]
    assert openai_service.PHOTO_LIKENESS_PROMPT not in wire.paintings[0]


@pytest.mark.parametrize("answer", [
    json.dumps({"kind": "other"}),
    json.dumps({"kind": "selfie"}),
    json.dumps({"nope": 1}),
    "not json at all",
])
def test_anything_but_a_clear_photo_is_painted_as_a_drawing(db, make_user, make_creation, wire, answer):
    wire.kind_answer = answer
    user, creation = _hero(db, make_user, make_creation, style="pixar")
    _paint(db, user, creation)
    assert wire.paintings == [_drawing_prompt("pixar")]


def test_a_failed_classification_paints_a_drawing_and_is_asked_again_next_time(
        db, make_user, make_creation, wire):
    wire.kind_status = 500
    user, creation = _hero(db, make_user, make_creation, style="pixar")
    _paint(db, user, creation)
    assert wire.paintings == [_drawing_prompt("pixar")]
    db.refresh(creation)
    assert "input_kind" not in (creation.metadata_json or {})

    # Not stored, so the next run asks again - and this time it is a photo.
    wire.kind_status = 200
    _paint(db, user, creation)
    assert len(wire.classifications) == 2
    assert wire.paintings[-1].endswith(openai_service.PHOTO_LIKENESS_PROMPT)


def test_an_unreadable_upload_is_a_drawing_and_costs_nothing(db, make_user, make_creation, wire):
    user, creation = _hero(db, make_user, make_creation, style="pixar", upload=b"\xff\xd8\xff not a jpeg")
    _paint(db, user, creation)
    assert wire.classifications == []
    assert wire.paintings == [_drawing_prompt("pixar")]
    assert db.query(UsageEvent).filter(UsageEvent.operation == pricing.OP_OPENAI_INPUT_KIND).count() == 0


def test_the_classification_request(db, make_user, make_creation, wire):
    user, creation = _hero(db, make_user, make_creation)
    _paint(db, user, creation)
    req = wire.classifications[0]
    assert req["model"] == openai_service.INPUT_KIND_MODEL
    assert req["temperature"] == 0
    schema = req["response_format"]["json_schema"]["schema"]
    assert schema["properties"]["kind"]["enum"] == list(openai_service.INPUT_KINDS)
    text, image = req["messages"][0]["content"]
    assert text["text"] == openai_service.INPUT_KIND_PROMPT
    assert image["image_url"]["detail"] == "low"
    assert image["image_url"]["url"].startswith("data:image/jpeg;base64,")
    # Unsure is a drawing, and a photo of a drawing is a drawing.
    assert 'If you are not sure, answer "drawing"' in openai_service.INPUT_KIND_PROMPT
    assert "A photograph of a drawing" in openai_service.INPUT_KIND_PROMPT


# ---------------------------------------------------------------------------
# Once per hero, stored on it, free for the user, visible to finance
# ---------------------------------------------------------------------------

def test_the_kind_is_stored_on_the_creation_and_asked_once(db, make_user, make_creation, wire):
    user, creation = _hero(db, make_user, make_creation, style="pixar")
    _paint(db, user, creation)
    _paint(db, user, creation)        # "Make it again"

    assert len(wire.classifications) == 1
    assert len(wire.paintings) == 2
    assert all(p.endswith(openai_service.PHOTO_LIKENESS_PROMPT) for p in wire.paintings)
    db.refresh(creation)
    assert creation.metadata_json["input_kind"]["kind"] == PHOTO
    assert creation.metadata_json["input_kind"]["source"] == "openai"
    step = db.query(CreationStep).filter_by(creation_id=creation.id, step_name="openai_render").one()
    assert step.metadata_json["input_kind"] == PHOTO


def test_the_classification_is_a_usage_event_and_costs_no_credits(db, make_user, make_creation, wire):
    user, creation = _hero(db, make_user, make_creation, style="pixar")
    before = get_balance(user.id, db)
    _paint(db, user, creation)

    events = db.query(UsageEvent).filter(UsageEvent.creation_id == creation.id).all()
    kinds = [e for e in events if e.operation == pricing.OP_OPENAI_INPUT_KIND]
    assert len(kinds) == 1
    e = kinds[0]
    assert e.provider == pricing.PROVIDER_OPENAI
    assert e.step_name == input_kind.USAGE_STEP
    assert e.cost_usd_micros == pricing.hero_name_cost_usd_micros(620, 8) > 0
    assert e.metadata_json["kind"] == PHOTO
    # The user pays for the painting step only, as before.
    assert before - get_balance(user.id, db) == get_step_cost("openai_render")


def test_the_staging_cache_answers_a_known_upload_for_free(db, make_user, make_creation, wire, monkeypatch):
    monkeypatch.setenv(result_cache.ENV_FLAG, "1")
    user, first = _hero(db, make_user, make_creation, style="lego")
    _paint(db, user, first)
    assert len(wire.classifications) == 1

    other, second = _hero(db, make_user, make_creation, style="anime")
    _paint(db, other, second)
    assert len(wire.classifications) == 1          # answered from the cache
    assert wire.paintings[-1] == _drawing_prompt("anime") + "\n\n" + openai_service.PHOTO_LIKENESS_PROMPT
    db.refresh(second)
    assert second.metadata_json["input_kind"] == {
        "kind": PHOTO, "source": "cache", "model": openai_service.INPUT_KIND_MODEL}
    hit = (db.query(UsageEvent)
           .filter(UsageEvent.creation_id == second.id, UsageEvent.step_name == input_kind.USAGE_STEP).one())
    assert hit.status == "cache_hit" and hit.cost_usd_micros == 0


# ---------------------------------------------------------------------------
# The result cache: drawings keep hitting, photos never get a drawing's painting
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("style", STYLES)
def test_a_drawings_cache_version_is_unchanged(style):
    today = openai_service.render_cache_version(style)
    assert today["prompt"] == _drawing_prompt(style)
    for kind in (None, DRAWING_KIND, openai_service.INPUT_KIND_OTHER):
        assert openai_service.render_cache_version(style, kind) == today
    assert openai_service.render_cache_version(style, PHOTO) != today
