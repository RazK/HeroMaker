"""
A failed step tells its user one short, useful line, and only an admin the raw
provider error.

On staging a painting failed and the hero's page showed OpenAI's whole
response (`Error code: 400 - {'error': {'message': 'Your request was rejected
by the safety system... 'code': 'moderation_blocked' ...`) under "Painting it
failed". These tests drive the real failure paths (pipeline.execute_step, the
task manager's timeout) and the real endpoints, and check that a non-admin
response never carries the raw text on any of them.
"""
import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import ClassRoom, Creation, CreationStep
from app.services import classes, pipeline, step_errors
from app.services.auth import create_access_token
from app.services.provider_errors import ProviderOutOfCredits

# What staging's hero page showed, as pipeline.execute_step stored it.
MODERATION = (
    "OpenAI API error: Error code: 400 - {'error': {'message': 'Your request was rejected by the "
    "safety system. If you believe this is an error, contact us at help.openai.com and include the "
    "request ID req_8f3c2a91b7d04e6fa1c2.', 'type': 'image_generation_user_error', 'param': None, "
    "'code': 'moderation_blocked', 'moderation_details': {'moderation_stage': 'output', "
    "'categories': ['other']}}}\n"
    "The image or prompt was rejected by OpenAI's safety system. This can happen if the content "
    "violates OpenAI's usage policies. Try using a different image or contact OpenAI support if "
    "you believe this is an error."
)
# Fragments that must never reach a non-admin, whatever the path.
RAW_MARKERS = ("OpenAI", "moderation", "req_8f3c", "Error code", "image_generation_user_error",
               "timed out after", "server restarted", "Meshy", "NoMorePendingTasks", "Traceback")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _assert_safe(payload):
    text = json.dumps(payload)
    for marker in RAW_MARKERS:
        assert marker not in text, f"raw provider text {marker!r} reached a non-admin: {text[:400]}"


class _AllFilesExist:
    def file_exists(self, *_a, **_kw):
        return True

    def get_file_path(self, *_a, **_kw):
        return "/dev/null"


@pytest.fixture
def storage_ok(monkeypatch):
    monkeypatch.setattr(pipeline, "get_storage", lambda: _AllFilesExist())


def _fail_with(monkeypatch, exc):
    async def boom(*_a, **_kw):
        raise exc
    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda _n: boom)


def _step(db, creation_id, name):
    db.expire_all()
    return db.query(CreationStep).filter(CreationStep.creation_id == creation_id,
                                         CreationStep.step_name == name).one()


# ---------------------------------------------------------------------------
# Classifying
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("raw, code", [
    (MODERATION, step_errors.SAFETY_BLOCKED),
    ("Task 0192-abc failed: The input image violates our content policy", step_errors.SAFETY_BLOCKED),
    ("OpenAI API rate limit exceeded: Error code: 429 - rate_limit_exceeded", step_errors.PROVIDER_BUSY),
    ("OpenAI API gateway error (503): Service Unavailable", step_errors.PROVIDER_BUSY),
    ("OpenAI API server error (500): boom", step_errors.PROVIDER_BUSY),
    ("Step timed out after 300 seconds", step_errors.PROVIDER_BUSY),
    ("Task 9 timed out after 1800 seconds", step_errors.PROVIDER_BUSY),
    ("VRM conversion service unavailable at http://vrm:8001: Connection refused", step_errors.PROVIDER_BUSY),
    ("Meshy service unavailable: our account is out of credits. Provider said: NoMorePendingTasks",
     step_errors.OUT_OF_CREDITS_PROVIDER),
    ("Error code: 429 - {'error': {'code': 'insufficient_quota'}}", step_errors.OUT_OF_CREDITS_PROVIDER),
    ("cannot identify image file <_io.BytesIO object at 0x7f>", step_errors.BAD_INPUT),
    ("OpenAI API bad request (400): ... unsupported image format or size", step_errors.BAD_INPUT),
    ("Insufficient credits. Need 5, have 1", step_errors.NOT_ENOUGH_CREDITS),
    ("Step cancelled by user", step_errors.CANCELLED),
    ("Step was processing when server restarted. Please retry.", step_errors.UNKNOWN),
    ("Input file not found: processed.jpg", step_errors.UNKNOWN),
    ("", step_errors.UNKNOWN),
    (None, step_errors.UNKNOWN),
])
def test_classify(raw, code):
    assert step_errors.classify(raw) == code


def test_classify_exceptions():
    assert step_errors.classify(ProviderOutOfCredits("openai", "no credits")) == step_errors.OUT_OF_CREDITS_PROVIDER
    assert step_errors.classify(TimeoutError()) == step_errors.PROVIDER_BUSY
    assert step_errors.classify(RuntimeError(MODERATION)) == step_errors.SAFETY_BLOCKED


def test_request_id():
    assert step_errors.request_id(MODERATION) == "req_8f3c2a91b7d04e6fa1c2"
    assert step_errors.request_id("Step timed out after 300 seconds") is None
    assert step_errors.request_id(None) is None


@pytest.mark.parametrize("code", step_errors.CODES)
@pytest.mark.parametrize("step_name", ["image_processing", "openai_render", "meshy_3d", "meshy_rig", "convert_vrm"])
@pytest.mark.parametrize("refunded", [False, True])
def test_every_line_is_short_and_says_credits_only_when_true(code, step_name, refunded):
    """Brand book: one line of 12 words or fewer, never blaming the user."""
    line = step_errors.user_message(code, step_name, refunded)
    assert len(line.split()) <= 12, line
    assert ("Credits returned" in line) == (refunded and code not in (
        step_errors.NOT_ENOUGH_CREDITS, step_errors.CANCELLED)), line
    for marker in RAW_MARKERS:
        assert marker not in line


def test_the_painting_lines():
    assert step_errors.user_message(step_errors.SAFETY_BLOCKED, "openai_render", True) == \
        "We couldn't paint this picture. Credits returned. Try another drawing or photo."
    assert step_errors.user_message(step_errors.PROVIDER_BUSY, "openai_render", False) == \
        "Our painter is busy right now. Try again in a minute."


# ---------------------------------------------------------------------------
# The real failure paths store a code, the raw text and whether it refunded
# ---------------------------------------------------------------------------

def test_execute_step_failure_stores_code_raw_and_refund(db, make_user, make_creation, storage_ok, monkeypatch):
    user = make_user(credits=100)
    creation = make_creation(user.id, steps={"openai_render": "pending"})
    _fail_with(monkeypatch, Exception(MODERATION))

    with pytest.raises(Exception):
        _run(pipeline.execute_step(creation.id, user.id, "openai_render", db))

    step = _step(db, creation.id, "openai_render")
    assert step.status == "failed"
    assert step.error_code == step_errors.SAFETY_BLOCKED
    assert step.error_message == MODERATION          # kept whole, for admins
    assert step.metadata_json[step_errors.REFUND_KEY] == 2


def test_a_step_failed_before_its_charge_never_says_credits_returned(db, make_user, make_creation, storage_ok, monkeypatch):
    user = make_user(credits=1)                       # meshy_3d costs 5
    creation = make_creation(user.id, steps={"meshy_3d": "pending"})

    with pytest.raises(ValueError):
        _run(pipeline.execute_step(creation.id, user.id, "meshy_3d", db))

    step = _step(db, creation.id, "meshy_3d")
    assert step.error_code == step_errors.NOT_ENOUGH_CREDITS
    fields = step_errors.response_fields(step, admin=False)
    assert fields["credits_refunded"] is False
    assert "Credits returned" not in fields["error_user"]


def test_timeout_stores_busy_and_refund(db, make_user, make_creation, storage_ok, monkeypatch):
    from app.services.task_manager import TaskManager

    user = make_user(credits=100)
    creation = make_creation(user.id, steps={"meshy_3d": "pending"})

    async def hangs(*_a, **_kw):
        await asyncio.sleep(30)
    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda _n: hangs)

    async def scenario():
        manager = TaskManager()
        task = manager.create_task(
            creation.id, "meshy_3d",
            pipeline.execute_step(creation.id, user.id, "meshy_3d", db, task_manager=manager),
            timeout=1,
        )
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=10)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            pass
        await asyncio.sleep(1.0)

    _run(scenario())

    step = _step(db, creation.id, "meshy_3d")
    assert step.error_code == step_errors.PROVIDER_BUSY
    assert "timed out" in step.error_message
    assert step.metadata_json.get(step_errors.REFUND_KEY) == 5
    fields = step_errors.response_fields(step, admin=False)
    assert fields["error_user"] == "Our sculptor is busy. Credits returned. Try again in a minute."
    _assert_safe(fields)


def test_a_retry_clears_the_old_code(db, make_user, make_creation, storage_ok, monkeypatch):
    user = make_user(credits=100)
    creation = make_creation(user.id, steps={"openai_render": "pending"})
    _fail_with(monkeypatch, Exception(MODERATION))
    with pytest.raises(Exception):
        _run(pipeline.execute_step(creation.id, user.id, "openai_render", db))

    async def fine(*_a, **_kw):
        return None
    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda _n: fine)
    _run(pipeline.execute_step(creation.id, user.id, "openai_render", db))

    step = _step(db, creation.id, "openai_render")
    assert step.status == "completed"
    assert step.error_code is None and step.error_message is None
    assert step_errors.REFUND_KEY not in (step.metadata_json or {})


# ---------------------------------------------------------------------------
# What every endpoint serves
# ---------------------------------------------------------------------------

# One raw message per way a step can fail, each as its path stores it.
PATHS = {
    "provider error (execute_step)": (MODERATION, None, True),
    "timeout (task_manager)": ("Step timed out after 300 seconds", step_errors.PROVIDER_BUSY, True),
    "server restart (main.lifespan)": ("Step was processing when server restarted. Please retry.",
                                       step_errors.UNKNOWN, False),
    "our provider account is empty": (str(ProviderOutOfCredits("meshy", "NoMorePendingTasks")), None, True),
    "cancelled (cancel endpoint)": (step_errors.CANCELLED_MESSAGE, step_errors.CANCELLED, False),
    "before the charge (execute_step)": ("Insufficient credits. Need 2, have 0",
                                         step_errors.NOT_ENOUGH_CREDITS, False),
}


@pytest.fixture
def failed_hero(db, make_user):
    """A hero whose painting failed, stored the way `path` stores it."""
    def _make(path, legacy=False, class_id=None):
        raw, code, refunded = PATHS[path]
        owner = make_user(credits=10)
        creation = Creation(user_id=owner.id, class_id=class_id)
        db.add(creation)
        db.commit()
        db.add(CreationStep(creation_id=creation.id, step_name="image_processing", status="completed"))
        step = CreationStep(creation_id=creation.id, step_name="openai_render", status="pending",
                            metadata_json={step_errors.REFUND_KEY: 2} if refunded else {})
        step_errors.mark_failed(step, raw, code=code)
        if legacy:                       # failed before error_code existed
            step.error_code = None
        db.add(step)
        db.commit()
        return owner, creation, raw
    return _make


@pytest.mark.parametrize("path", list(PATHS))
@pytest.mark.parametrize("legacy", [False, True])
def test_no_non_admin_response_carries_the_raw_error(path, legacy, failed_hero, make_user):
    owner, creation, raw = failed_hero(path, legacy=legacy)
    stranger = make_user()
    client = TestClient(app)
    cid = creation.id

    seen = [
        client.get(f"/api/creations/{cid}"),                                   # anyone, signed out
        client.get(f"/api/creations/{cid}", headers={"Authorization": "Bearer stale"}),
        client.get(f"/api/creations/{cid}", headers=_auth(owner)),
        client.get(f"/api/creations/{cid}", headers=_auth(stranger)),
        client.get(f"/api/creations/{cid}/steps/openai_render"),
        client.get(f"/api/creations/{cid}/steps/openai_render", headers=_auth(owner)),
        client.get("/api/creations/?mine_only=true", headers=_auth(owner)),
        client.patch(f"/api/creations/{cid}", json={"character_name": "Zed"}, headers=_auth(owner)),
    ]
    for r in seen:
        assert r.status_code == 200, r.text
        _assert_safe(r.json())

    hero = seen[2].json()
    step = next(s for s in hero["steps"] if s["step_name"] == "openai_render")
    assert step["error_code"] in step_errors.CODES
    assert step["error_user"] and step["error_message"] == step["error_user"]
    assert step["error_detail"] is None and step["error_request_id"] is None
    assert hero["error_message"] == step["error_user"]


def test_the_screenshot_hero_as_its_owner(failed_hero):
    owner, creation, _ = failed_hero("provider error (execute_step)")
    r = TestClient(app).get(f"/api/creations/{creation.id}", headers=_auth(owner))
    step = next(s for s in r.json()["steps"] if s["step_name"] == "openai_render")
    assert step["error_code"] == "safety_blocked"
    assert step["credits_refunded"] is True
    assert step["error_user"] == "We couldn't paint this picture. Credits returned. Try another drawing or photo."


@pytest.mark.parametrize("path", list(PATHS))
def test_an_admin_also_gets_the_raw_error_and_request_id(path, failed_hero, make_user):
    _, creation, raw = failed_hero(path)
    admin = make_user(is_admin=True)
    client = TestClient(app)
    for r in (client.get(f"/api/creations/{creation.id}", headers=_auth(admin)),
              client.get("/api/creations/", headers=_auth(admin))):
        assert r.status_code == 200
        heroes = r.json() if isinstance(r.json(), list) else [r.json()]
        hero = next(h for h in heroes if h["id"] == creation.id)
        step = next(s for s in hero["steps"] if s["step_name"] == "openai_render")
        assert step["error_detail"] == raw
        assert step["error_message"] == raw          # the admin step view reads it
        assert step["error_user"]
    single = client.get(f"/api/creations/{creation.id}/steps/openai_render", headers=_auth(admin)).json()
    assert single["error_detail"] == raw
    if raw == MODERATION:
        assert single["error_request_id"] == "req_8f3c2a91b7d04e6fa1c2"


def test_featuring_answers_an_admin_with_the_raw_error(failed_hero, make_user):
    _, creation, raw = failed_hero("provider error (execute_step)")
    admin = make_user(is_admin=True)
    r = TestClient(app).put(f"/api/creations/{creation.id}/featured", json={"featured": False},
                            headers=_auth(admin))
    if r.status_code == 200:            # a failed hero may be refused; if answered, it is raw for an admin
        step = next(s for s in r.json()["steps"] if s["step_name"] == "openai_render")
        assert step["error_detail"] == raw


def test_a_class_heros_line_never_mentions_credits(db, failed_hero, make_user):
    teacher, wallet = make_user(), make_user()
    room = ClassRoom(owner_id=teacher.id, wallet_user_id=wallet.id, title="2B", seats=3)
    db.add(room)
    db.commit()
    _, creation, _ = failed_hero("provider error (execute_step)", class_id=room.id)

    r = TestClient(app).get(f"/api/creations/{creation.id}")    # the child's page: no account
    step = next(s for s in r.json()["steps"] if s["step_name"] == "openai_render")
    assert step["error_code"] == "safety_blocked"
    assert "credit" not in step["error_user"].lower()
    _assert_safe(r.json())

    # The roster, the stage and the claim link summarise the hero; none has room for the raw text.
    db.expire_all()
    view = classes.hero_view(db.get(Creation, creation.id))
    assert view["state"] == "failed"
    _assert_safe(view)


def test_migration_adds_error_code_to_an_existing_database(tmp_path):
    from sqlalchemy import create_engine, inspect, text
    from sqlalchemy.orm import sessionmaker
    from app.migrations import m017_step_error_code

    engine = create_engine(f"sqlite:///{tmp_path}/old.db")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE creation_steps (id TEXT PRIMARY KEY, error_message TEXT)"))
    db = sessionmaker(bind=engine)()
    try:
        m017_step_error_code.migrate(db)
        m017_step_error_code.migrate(db)          # idempotent
        assert "error_code" in {c["name"] for c in inspect(engine).get_columns("creation_steps")}
    finally:
        db.close()


def test_admin_users_view_carries_no_step_errors(failed_hero, make_user):
    failed_hero("provider error (execute_step)")
    admin = make_user(is_admin=True)
    r = TestClient(app).get("/api/admin/users", headers=_auth(admin))
    assert r.status_code == 200
    _assert_safe(r.json())
