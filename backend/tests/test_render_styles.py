"""
Painting styles: the user picks a look before Go, and that look is what OpenAI
is asked for.

Drives the REAL code path: the real endpoints through FastAPI's TestClient,
`pipeline.execute_step` -> `step_openai_render` -> `openai.render_image` -> the
real OpenAI SDK. Only the HTTP transport under the SDK is replaced, so what the
tests read is the multipart body that would have gone over the wire.
"""
import asyncio
import base64
import hashlib
import importlib
import importlib.util
import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.migrations import m011_creation_style
from app.models import Creation
from app.schemas.creation import CreationResponse
from app.services import openai as openai_service
from app.services import pipeline, result_cache
from app.services.auth import create_access_token
from app.services.task_manager import get_task_manager
from app.utils.storage import get_storage

try:   # the OpenAI SDK's HTTP client, under whichever name this version ships
    _http = importlib.import_module("httpx2")
except ImportError:   # pragma: no cover
    _http = importlib.import_module("httpx")

KEYS = ["pixar", "lego", "minecraft", "anime"]
LABELS = ["Pixar", "Lego", "Minecraft", "Anime"]
# Offered once, retired (it came out flat). Old heroes still carry it.
RETIRED = "original"

# sha256 of RENDER_PROMPT on main before styles existed. Pixar's look must stay
# byte-identical to it, or every hero made so far changes look on "Make it again".
PRE_STYLES_PROMPT_SHA256 = "9f065032cc5652819dcef9146e6c97894ae3057a6f58a500e8c225da469f1a52"
# sha256 of Pixar's result-cache version. Until the framing fix this was
# "3315c5cd..." (the pre-styles version, kept so old cache entries kept hitting).
# It changed ON PURPOSE with the framing fix: those entries were made without
# the framing and some are cropped, so they must miss. The look did not change:
# the Pixar prompt above is still byte for byte the same, with the shared
# FRAMING_PROMPT after it. Change this pin again only as deliberately.
PIXAR_VERSION_SHA256 = "cee1068bef4297c16ea8d9d30fec94a760c2f1995a6a56d22e4791e5b42d955d"

DRAWING = b"\xff\xd8\xff crayon kid drawing"


def _jpeg(tag: bytes) -> bytes:
    """A real (tiny) JPEG, `tag` after its end: an upload must be a picture
    (creations.require_picture), and each test's drawing stays its own bytes."""
    from PIL import Image
    out = io.BytesIO()
    Image.new("RGB", (4, 4), (200, 30, 30)).save(out, format="JPEG")
    return out.getvalue() + tag


PICTURE = _jpeg(b" crayon kid drawing")   # what an upload must be


def _png() -> bytes:
    """A small transparent painting: a figure in the middle, nothing around it."""
    from PIL import Image
    im = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    im.paste((40, 80, 220, 255), (20, 8, 44, 60))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


PAINTING = _png()


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ---------------------------------------------------------------------------
# The wire: a real OpenAI client whose transport records each request.
# ---------------------------------------------------------------------------

def _multipart_field(body: bytes, content_type: str, name: str) -> str:
    boundary = content_type.split("boundary=", 1)[1].strip('"').encode()
    for part in body.split(b"--" + boundary):
        head, _, value = part.partition(b"\r\n\r\n")
        if f'name="{name}"'.encode() in head:
            return value[: -len(b"\r\n")].decode("utf-8") if value.endswith(b"\r\n") else value.decode("utf-8")
    raise AssertionError(f"no {name!r} field in the request")


@pytest.fixture
def wire(monkeypatch):
    sent = []

    def handler(request):
        body = request.read()
        sent.append({
            "url": str(request.url),
            "prompt": _multipart_field(body, request.headers["content-type"], "prompt"),
        })
        png = base64.b64encode(PAINTING).decode()
        return _http.Response(200, json={"created": 1, "data": [{"b64_json": png}]})

    real_openai = openai_service.OpenAI

    def client_on_mock_wire(api_key):
        return real_openai(
            api_key=api_key, max_retries=0,
            http_client=_http.Client(transport=_http.MockTransport(handler)),
        )

    monkeypatch.setattr(openai_service, "OpenAI", client_on_mock_wire)
    monkeypatch.setattr(openai_service, "OPENAI_API_KEY", "sk-test")
    return sent


def _hero(db, make_user, make_creation, style=None, drawing=DRAWING):
    user = make_user(credits=100)
    creation = make_creation(user.id, {"openai_render": "pending"})
    if style is not None:
        creation.style = style
        db.commit()
    get_storage().upload_file(user.id, creation.id, "processed.jpg", drawing)
    return user, creation


def _paint(db, user, creation):
    assert _run(pipeline.execute_step(creation.id, user.id, "openai_render", db)) == {"status": "completed"}


# ---------------------------------------------------------------------------
# The registry
# ---------------------------------------------------------------------------

def test_the_four_styles_in_picker_order():
    assert list(openai_service.STYLES) == KEYS
    assert openai_service.list_styles() == [{"key": k, "label": l} for k, l in zip(KEYS, LABELS)]
    assert openai_service.DEFAULT_STYLE == "pixar"
    assert openai_service.DEFAULT_STYLE in openai_service.STYLES


def test_original_is_retired_not_offered():
    assert RETIRED not in openai_service.STYLES
    assert not openai_service.is_valid_style(RETIRED)
    assert openai_service.is_retired_style(RETIRED)
    assert RETIRED not in {s["key"] for s in openai_service.list_styles()}
    assert not hasattr(openai_service, "ORIGINAL_PROMPT")
    # Every retired id means the default, wherever it is read.
    for key in openai_service.RETIRED_STYLES:
        assert key not in openai_service.STYLES
        assert openai_service.resolve_style(key) == openai_service.DEFAULT_STYLE


def test_pixar_is_the_pre_styles_prompt_byte_for_byte():
    prompt = openai_service.STYLES["pixar"]["prompt"]
    assert prompt is openai_service.RENDER_PROMPT
    assert hashlib.sha256(prompt.encode("utf-8")).hexdigest() == PRE_STYLES_PROMPT_SHA256


@pytest.mark.parametrize("key", KEYS)
def test_every_prompt_keeps_what_meshy_needs(key):
    p = openai_service.STYLES[key]["prompt"]
    for must in (
        "T-pose", "arms extended horizontally", "legs straight",
        "Front view, full body visible", "without cropping",
        "Transparent background", "no floor", "no ground shadow",
    ):
        assert must in p, f"{key}: missing {must!r}"
    if key != "pixar":   # pixar is frozen; the new ones also forbid text
        assert "No added text" in p
        assert "One single character" in p


# ---------------------------------------------------------------------------
# The style reaches OpenAI
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("key", KEYS)
def test_the_heros_style_is_the_prompt_sent_to_openai(db, make_user, make_creation, wire, key):
    user, creation = _hero(db, make_user, make_creation, style=key)
    _paint(db, user, creation)

    assert len(wire) == 1
    assert wire[0]["url"].endswith("/images/edits")
    assert wire[0]["prompt"] == openai_service.render_prompt(key)
    # The style's own prompt, byte for byte, then the framing every style shares.
    assert wire[0]["prompt"] == openai_service.STYLES[key]["prompt"] + "\n\n" + openai_service.FRAMING_PROMPT
    painted = get_storage().download_file(user.id, creation.id, "rendered.png")
    assert painted == PAINTING


def test_null_style_means_pixar(db, make_user, make_creation, wire):
    user, creation = _hero(db, make_user, make_creation, style=None)
    assert creation.style is None
    _paint(db, user, creation)

    assert wire[0]["prompt"].startswith(openai_service.RENDER_PROMPT)
    assert wire[0]["prompt"] == openai_service.render_prompt("pixar")
    db.refresh(creation)
    assert CreationResponse.from_creation(creation).style == "pixar"
    assert openai_service.render_cache_version(None) == openai_service.render_cache_version("pixar")


def test_a_retired_style_on_an_old_hero_falls_back_to_pixar(db, make_user, make_creation, wire):
    user, creation = _hero(db, make_user, make_creation, style="watercolour")
    _paint(db, user, creation)
    assert wire[0]["prompt"] == openai_service.render_prompt("pixar")


def test_an_original_hero_repaints_as_pixar_and_keeps_its_stored_style(db, make_user, make_creation, wire):
    user, creation = _hero(db, make_user, make_creation, style=RETIRED)
    _paint(db, user, creation)

    assert wire[0]["prompt"] == openai_service.render_prompt("pixar")
    assert openai_service.render_cache_version(RETIRED) == openai_service.render_cache_version("pixar")
    db.refresh(creation)
    assert creation.style == RETIRED          # nothing rewrote the hero's row
    assert CreationResponse.from_creation(creation).style == "pixar"


# ---------------------------------------------------------------------------
# The cache key carries the style
# ---------------------------------------------------------------------------

def test_cache_keys_differ_per_style():
    keys = {k: result_cache.compute_key("openai_render", DRAWING, openai_service.render_cache_version(k))
            for k in KEYS}
    assert len(set(keys.values())) == len(KEYS), keys


def test_pixar_cache_version_is_pinned():
    v = openai_service.render_cache_version("pixar")
    assert set(v) == {"prompt", *openai_service.RENDER_PARAMS, "framing"}
    assert v["prompt"] == openai_service.render_prompt("pixar")
    assert result_cache.version_hash(v) == PIXAR_VERSION_SHA256
    assert result_cache.version_hash(openai_service.render_cache_version(None)) == PIXAR_VERSION_SHA256


def test_renders_cached_before_the_framing_fix_miss():
    pre_fix = "3315c5cdeccabe17158f0a596d91098e917ddca94e7aa77b4c0393cc78b555e6"
    for key in KEYS:
        assert result_cache.version_hash(openai_service.render_cache_version(key)) != pre_fix


# ---------------------------------------------------------------------------
# The API
# ---------------------------------------------------------------------------

class _Tasks:
    """Stands in for the app's task manager: records runs, starts none."""
    def __init__(self):
        self.created = []

    def running_for_creation(self, creation_id):
        return []

    def create_task(self, creation_id, key, coro, timeout=None):
        coro.close()
        self.created.append((creation_id, key))

    def cancel_all_tasks_for_creation(self, creation_id):
        return 0


@pytest.fixture
def api():
    tasks = _Tasks()
    app.dependency_overrides[get_task_manager] = lambda: tasks
    try:
        yield TestClient(app), tasks
    finally:
        app.dependency_overrides.pop(get_task_manager, None)


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def test_get_styles_is_public_and_ordered(api):
    client, _ = api
    r = client.get("/api/styles")
    assert r.status_code == 200
    assert r.json() == [{"key": k, "label": l} for k, l in zip(KEYS, LABELS)]
    assert [s["key"] for s in r.json()] == ["pixar", "lego", "minecraft", "anime"]   # exactly four
    assert RETIRED not in r.text
    assert "prompt" not in r.text


def test_create_stores_the_style_and_answers_it(db, make_user, api):
    client, _ = api
    user = make_user(credits=0)
    r = client.post("/api/creations/create", headers=_auth(user),
                    files={"image_file": ("d.jpg", PICTURE, "image/jpeg")}, data={"style": "lego"})
    assert r.status_code == 201, r.text
    assert r.json()["style"] == "lego"
    assert db.query(Creation).filter_by(id=r.json()["id"]).one().style == "lego"


def test_create_without_a_style_is_pixar(db, make_user, api):
    client, _ = api
    user = make_user(credits=0)
    r = client.post("/api/creations/create", headers=_auth(user),
                    files={"image_file": ("d.jpg", PICTURE, "image/jpeg")})
    assert r.status_code == 201, r.text
    assert r.json()["style"] == "pixar"
    assert db.query(Creation).filter_by(id=r.json()["id"]).one().style is None


def test_create_with_an_unknown_style_is_400_and_makes_nothing(db, make_user, api):
    client, _ = api
    user = make_user(credits=0)
    r = client.post("/api/creations/create", headers=_auth(user),
                    files={"image_file": ("d.jpg", PICTURE, "image/jpeg")}, data={"style": "cubism"})
    assert r.status_code == 400
    assert "cubism" in r.json()["detail"]
    assert db.query(Creation).count() == 0


def test_create_with_the_retired_style_is_made_in_the_default(db, make_user, api):
    client, _ = api
    user = make_user(credits=0)
    r = client.post("/api/creations/create", headers=_auth(user),
                    files={"image_file": ("d.jpg", PICTURE, "image/jpeg")}, data={"style": RETIRED})
    assert r.status_code == 201, r.text
    assert r.json()["style"] == "pixar"
    assert db.query(Creation).filter_by(id=r.json()["id"]).one().style is None


def test_an_original_hero_loads_everywhere(db, make_user, make_creation, completed_steps, api):
    """Its page, its owner's gallery, Editors' choice and an admin's All
    heroes: every list and page that reads it answers it, as the default."""
    client, _ = api
    user = make_user(credits=0)
    creation = make_creation(user.id, completed_steps)
    creation.style = RETIRED
    creation.featured = True
    db.commit()

    page = client.get(f"/api/creations/{creation.id}")
    assert page.status_code == 200, page.text
    assert page.json()["style"] == "pixar"
    admin = make_user(is_admin=True)
    for url, headers in (("/api/creations/?mine_only=true", _auth(user)),
                         ("/api/creations/?featured_only=true", {}),
                         ("/api/creations/", _auth(admin))):
        r = client.get(url, headers=headers)
        assert r.status_code == 200, (url, r.text)
        listed = {c["id"]: c for c in r.json()}
        assert listed[creation.id]["style"] == "pixar", url


@pytest.mark.parametrize("query", ["", "&style=original"])
def test_retrying_an_original_hero_is_accepted_and_paints_pixar(
        db, make_user, make_creation, api, wire, query):
    """"Try again" on a failed step of an old Original hero, with or without
    its old id in the request (a tab opened before the style was retired)."""
    client, tasks = api
    user, creation = _hero(db, make_user, make_creation, style=RETIRED)

    r = client.post(f"/api/creations/{creation.id}/run-pipeline?from_step=openai_render{query}",
                    headers=_auth(user))
    assert r.status_code == 200, r.text
    assert len(tasks.created) == 1
    db.refresh(creation)
    assert creation.style == RETIRED

    _paint(db, user, creation)
    assert wire[-1]["prompt"] == openai_service.render_prompt("pixar")


def test_run_pipeline_with_an_unknown_style_is_400_and_starts_nothing(db, make_user, make_creation, api):
    client, tasks = api
    user = make_user(credits=100)
    creation = make_creation(user.id, {"openai_render": "pending"})
    r = client.post(f"/api/creations/{creation.id}/run-pipeline?style=LEGO", headers=_auth(user))
    assert r.status_code == 400
    assert tasks.created == []
    db.refresh(creation)
    assert creation.style is None


def test_go_with_a_style_stores_it_and_make_it_again_keeps_it(
        db, make_user, make_creation, api, wire):
    client, tasks = api
    user, creation = _hero(db, make_user, make_creation)

    # Go, with Minecraft picked in the sheet.
    r = client.post(f"/api/creations/{creation.id}/run-pipeline?style=minecraft", headers=_auth(user))
    assert r.status_code == 200, r.text
    db.refresh(creation)
    assert creation.style == "minecraft"
    assert client.get(f"/api/creations/{creation.id}", headers=_auth(user)).json()["style"] == "minecraft"

    # "Make it again" / "Try again" send no style: the hero keeps its own.
    r = client.post(f"/api/creations/{creation.id}/run-pipeline", headers=_auth(user))
    assert r.status_code == 200, r.text
    r = client.post(f"/api/creations/{creation.id}/run-pipeline?from_step=openai_render", headers=_auth(user))
    assert r.status_code == 200, r.text
    db.refresh(creation)
    assert creation.style == "minecraft"
    assert len(tasks.created) == 3

    # ...and that is what gets painted.
    _paint(db, user, creation)
    assert wire[-1]["prompt"] == openai_service.render_prompt("minecraft")


def test_every_style_costs_the_same(api):
    client, _ = api
    # Price is per step, never per style: the cost endpoint takes no style.
    r = client.get("/api/creations/cost")
    assert r.status_code == 200
    assert "style" not in r.text


# ---------------------------------------------------------------------------
# The migration
# ---------------------------------------------------------------------------

def test_migration_adds_a_nullable_style_column_once(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/old.db")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE creations (id VARCHAR PRIMARY KEY, user_id VARCHAR)"))
        conn.execute(text("INSERT INTO creations (id, user_id) VALUES ('old-hero', 'u')"))
    session = sessionmaker(bind=engine)()
    try:
        m011_creation_style.migrate(session)
        m011_creation_style.migrate(session)   # idempotent
        assert "style" in {c["name"] for c in inspect(engine).get_columns("creations")}
        assert session.execute(text("SELECT style FROM creations WHERE id='old-hero'")).scalar() is None
    finally:
        session.close()
        engine.dispose()


def test_migration_is_registered():
    from app.migrations.registry import MIGRATIONS
    assert ("011_creation_style", m011_creation_style.migrate) in MIGRATIONS


# ---------------------------------------------------------------------------
# The sample maker uses the real render, once per style
# ---------------------------------------------------------------------------

def _samples_script():
    path = Path(__file__).resolve().parent.parent / "scripts" / "make_style_samples.py"
    spec = importlib.util.spec_from_file_location("make_style_samples", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_sample_maker_renders_every_style_with_its_own_prompt(tmp_path, wire):
    from PIL import Image
    drawing = tmp_path / "drawing.jpg"
    drawing.write_bytes(PAINTING)   # any real image: the script also thumbnails it
    out = tmp_path / "styles"

    assert _samples_script().main(["--drawing", str(drawing), "--out-dir", str(out)]) == 0

    assert [w["prompt"] for w in wire] == [openai_service.render_prompt(k) for k in KEYS]
    for key in KEYS:
        thumb = Image.open(out / f"{key}.webp")
        assert thumb.size == (256, 256)
        assert thumb.mode == "RGBA"
    assert (out / "drawing.webp").exists()   # the picker's fallback


def test_sample_maker_can_reuse_an_existing_painting(tmp_path, wire):
    existing = tmp_path / "pixar.png"
    existing.write_bytes(PAINTING)
    out = tmp_path / "styles"
    rc = _samples_script().main(["--only", "pixar", "--use", f"pixar={existing}", "--out-dir", str(out)])
    assert rc == 0
    assert wire == []
    assert (out / "pixar.webp").exists()
