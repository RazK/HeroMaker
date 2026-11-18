"""
Analytics collection (docs/analytics/REQUIREMENTS.md).

Two promises are tested here.

1. NO PERSONAL DATA. The schema is an allow-list of names and of property
   kinds, none of which can hold a name, an email or a sentence.
   `test_no_event_property_can_hold_personal_data` fails the moment someone
   adds a free-text kind or loosens a slug; the endpoint tests show that what
   is not on the list is dropped, not stored.

2. THE BACKEND'S OWN EVENTS COME FROM THE REAL CODE PATHS (the payments trap
   in CLAUDE.md): `purchase_done` from the signed Lemon Squeezy webhook,
   `hero_ready` / `hero_failed` from `pipeline.execute_step` and the task
   manager's timeout, `class_created` / `class_joined` from the class
   endpoints. Each test goes red if its emit is removed.
"""
import asyncio
import hashlib
import hmac
import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker

from app.config.steps import get_all_step_names, get_step_by_name
from app.database import SessionLocal
from app.main import app
from app.migrations import m020_analytics_events
from app.models import AnalyticsEvent, ClassGuest, ClassRoom, ClassSession, Creation, CreationStep
from app.services import analytics, classes, pipeline, step_errors
from app.services.auth import create_access_token
from app.services.task_manager import get_task_manager
from app.utils.storage import get_storage

VISITOR = "0f8b0c1e-7a54-4d7e-9a2b-3c5d6e7f8a9b"
OTHER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
WEBHOOK_SECRET = "test-webhook-secret"

# Things a person could type, or a page could leak. None may ever be stored.
PERSONAL = (
    "maya@example.com",
    "Maya Cohen",
    "Maya",
    "+972 50 123 4567",
    "050-123 4567",
    "12 Herzl St., Tel Aviv",
    "My dragon is called Sparky and he is 7",
    "מאיה",
    "https://example.com/u/maya",
    "data:image/png;base64,AAAA",
    "x" * 41,
    "",
)
# Property names that would be personal data whatever their value.
FORBIDDEN_KEYS = {
    "name", "first_name", "last_name", "full_name", "email", "mail", "phone", "address", "age",
    "birthday", "dob", "text", "note", "message", "comment", "title", "drawing", "photo", "image",
    "picture", "file", "url", "ip", "user_agent", "ua", "hero_name", "character_name", "school",
    "username", "password", "token", "lat", "lon", "location",
}


@pytest.fixture(autouse=True)
def _on(monkeypatch):
    """Analytics is off unless an environment turns it on; these tests do."""
    monkeypatch.setenv(analytics.ENV_FLAG, "true")


@pytest.fixture(autouse=True)
def _clean():
    def wipe():
        db = SessionLocal()
        try:
            db.query(AnalyticsEvent).delete()
            db.query(ClassGuest).delete()
            db.query(ClassSession).delete()
            db.query(Creation).update({Creation.class_id: None})
            db.query(ClassRoom).delete()
            db.commit()
        finally:
            db.close()
    wipe()
    classes.reset_throttles()
    analytics.budget.reset()
    yield
    wipe()


@pytest.fixture
def client():
    return TestClient(app)


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _batch(events, visitor=VISITOR, **top):
    return {"visitor": visitor, "device": "phone", "events": events, **top}


def _stored(db, **where):
    db.expire_all()
    query = db.query(AnalyticsEvent)
    for key, value in where.items():
        query = query.filter(getattr(AnalyticsEvent, key) == value)
    return query.order_by(AnalyticsEvent.id).all()


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ---------------------------------------------------------------------------
# 1. No personal data
# ---------------------------------------------------------------------------

def test_no_event_property_can_hold_personal_data():
    """Every property of every event is an enum, a bounded int, a bool or a
    slug, and none of those takes anything a person could be known by."""
    assert set(analytics.KINDS) == {"enum", "int", "bool", "slug"}, (
        "a new property kind was added: prove here it cannot carry personal data"
    )
    for event, props in analytics.EVENTS.items():
        for key, spec in props.items():
            assert spec[0] in analytics.KINDS, f"{event}.{key} has an unknown kind {spec[0]!r}"
            assert key not in FORBIDDEN_KEYS, f"{event}.{key} is a personal-data field"
            for sample in PERSONAL:
                with pytest.raises(ValueError):
                    analytics.clean_value(spec, sample)
            if spec[0] == "enum":
                # A closed list of short machine words, not a place for text.
                assert all(analytics.SLUG_RE.match(v) for v in spec[1]), f"{event}.{key} has a non-slug choice"


def test_the_table_has_no_column_for_an_ip_or_a_user_agent():
    columns = {c.name for c in AnalyticsEvent.__table__.columns}
    assert columns == {
        "id", "created_at", "name", "visitor_id", "user_id", "door", "device",
        "is_robot", "source", "props", "ref",
    }


def test_personal_data_in_a_batch_is_dropped_not_stored(client, db):
    r = client.post("/api/v1/events", json=_batch([
        {"name": "visit", "props": {"returning": False}},
        {"name": "visit", "props": {"email": "maya@example.com"}},            # a property not on the list
        {"name": "move_tapped", "props": {"move": "Maya Cohen"}},             # a value that is not a slug
        {"name": "signin_done", "props": {"method": "maya@example.com"}},     # not one of the choices
        {"name": "hero_named", "props": {}},                                  # an event not on the list
        {"name": "wait_left", "props": {"minutes": "My dragon is called Sparky"}},
        {"name": "visit", "props": {"returning": True}, "note": "Maya Cohen"},  # an extra field on the event
        {"name": "make_started"},
    ]))
    assert r.status_code == 200, r.text
    assert r.json() == {"accepted": 2, "rejected": 6}

    rows = _stored(db)
    assert [e.name for e in rows] == ["visit", "make_started"]
    everything = json.dumps([[e.name, e.visitor_id, e.user_id, e.door, e.device, e.props, e.ref] for e in rows])
    for leaked in ("maya", "Maya", "Sparky", "example.com"):
        assert leaked not in everything


@pytest.mark.parametrize("body", [
    {"visitor": "maya@example.com", "events": []},                             # not a random id
    {"visitor": VISITOR, "events": [], "email": "maya@example.com"},           # an unknown field
    {"visitor": VISITOR, "events": [], "user_id": "someone-else"},             # the body never says who is signed in
    {"visitor": VISITOR, "events": [], "door": "Maya's birthday!"},            # a door that is not a tag
    {"visitor": VISITOR, "events": [], "device": "Maya's iPhone"},
    {"visitor": VISITOR, "events": [], "robot": "no"},
    {"visitor": VISITOR, "events": [{"name": "visit"}] * 51},
    {"visitor": VISITOR},
    [],
])
def test_a_batch_that_does_not_say_who_it_is_from_is_refused(client, db, body):
    r = client.post("/api/v1/events", json=body)
    assert r.status_code == 422, r.text
    assert _stored(db) == []


def test_a_body_that_is_not_json_or_is_huge_is_refused(client, db):
    assert client.post("/api/v1/events", content=b"visit!").status_code == 400
    huge = json.dumps(_batch([{"name": "visit"}] * 10, door="x" * 40) | {"pad": "y" * 40_000})
    assert client.post("/api/v1/events", content=huge).status_code == 413
    assert _stored(db) == []


# ---------------------------------------------------------------------------
# Off until an environment turns it on
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("value", [None, "", "false", "0", "off"])
def test_nothing_is_recorded_unless_it_is_turned_on(client, db, make_user, make_creation, storage_ok,
                                                    store, monkeypatch, value):
    """The privacy policy says "No analytics" until Raz changes it, so an
    environment records nothing unless ANALYTICS_ENABLED says so: not the
    browser's events, and not the backend's own."""
    if value is None:
        monkeypatch.delenv(analytics.ENV_FLAG, raising=False)
    else:
        monkeypatch.setenv(analytics.ENV_FLAG, value)
    user = make_user(credits=100)

    r = client.post("/api/v1/events", json=_batch([{"name": "visit"}]), headers=_auth(user))
    assert r.status_code == 200 and r.json() == {"accepted": 0, "rejected": 0, "off": True}

    raw, headers = _order("order-off", user.id)
    assert client.post("/api/payments/webhook", content=raw, headers=headers).json()["status"] == "ok"

    names = get_all_step_names()
    creation = make_creation(user.id, steps={names[-1]: "pending", "meshy_3d": "pending"})
    _step_does(monkeypatch, _fine)
    _run(pipeline.execute_step(creation.id, user.id, names[-1], db))

    async def boom(*_a, **_kw):
        raise RuntimeError("provider exploded")
    _step_does(monkeypatch, boom)
    with pytest.raises(RuntimeError):
        _run(pipeline.execute_step(creation.id, user.id, "meshy_3d", db))

    client.post("/api/v1/classes", json={"title": "Grade 2B", "seats": 3}, headers=_auth(user))
    assert _stored(db) == []


# ---------------------------------------------------------------------------
# Browser events
# ---------------------------------------------------------------------------

def test_a_batch_is_stored_with_its_door_and_device(client, db):
    r = client.post("/api/v1/events", json=_batch(
        [{"name": "visit", "props": {"returning": False}},
         {"name": "hero_opened", "props": {"from": "gallery"}},
         {"name": "make_choice", "props": {"choice": "both"}},
         {"name": "survey_answered", "props": {"purpose": "gift", "who": "kid"}},
         {"name": "game_ended", "props": {"game": "robot-rumble", "seconds": 42, "score": 900}}],
        door="fair-telaviv-nov",
    ))
    assert r.json() == {"accepted": 5, "rejected": 0}
    rows = _stored(db)
    assert [e.name for e in rows] == ["visit", "hero_opened", "make_choice", "survey_answered", "game_ended"]
    assert {e.door for e in rows} == {"fair-telaviv-nov"}
    assert {e.device for e in rows} == {"phone"}
    assert {e.source for e in rows} == {"browser"}
    assert all(e.user_id is None and e.is_robot is False for e in rows)
    assert rows[4].props == {"game": "robot-rumble", "seconds": 42, "score": 900}


def test_no_door_is_direct(client, db):
    client.post("/api/v1/events", json=_batch([{"name": "visit"}]))
    client.post("/api/v1/events", json=_batch([{"name": "visit"}], visitor=OTHER, door="direct"))
    assert [e.door for e in _stored(db)] == [None, None]


def test_the_account_comes_from_the_session_never_the_body(client, db, make_user):
    user = make_user()
    client.post("/api/v1/events", json=_batch([{"name": "signin_done", "props": {"method": "google"}}]),
                headers=_auth(user))
    client.post("/api/v1/events", json=_batch([{"name": "visit"}]), headers={"Authorization": "Bearer stale"})
    rows = _stored(db)
    assert [e.user_id for e in rows] == [user.id, None]


def test_a_closing_page_can_send_with_send_beacon(client, db):
    """navigator.sendBeacon posts text/plain: the body is read as JSON anyway."""
    r = client.post("/api/v1/events", content=json.dumps(_batch([{"name": "wait_left", "props": {"minutes": 6}}])),
                    headers={"Content-Type": "text/plain;charset=UTF-8"})
    assert r.status_code == 200, r.text
    assert _stored(db)[0].props == {"minutes": 6}


def test_a_browser_cannot_send_the_backends_events(client, db):
    """The browser must never be the one to say a payment happened."""
    r = client.post("/api/v1/events", json=_batch([
        {"name": "purchase_done", "props": {"pack": "studio", "amount_cents": 4000, "test": False}},
        {"name": "hero_ready", "props": {"provider": "meshy", "minutes": 1}},
        {"name": "class_created"},
    ]))
    assert r.json() == {"accepted": 0, "rejected": 3}
    assert _stored(db) == []


def test_robots_are_marked(client, db, make_user):
    client.post("/api/v1/events", json=_batch([{"name": "visit"}], robot=True))
    robot_account = make_user(username="robot_20261118")
    client.post("/api/v1/events", json=_batch([{"name": "visit"}], visitor=OTHER), headers=_auth(robot_account))
    person = make_user()
    client.post("/api/v1/events", json=_batch([{"name": "visit"}], visitor="c" * 32), headers=_auth(person))
    assert [e.is_robot for e in _stored(db)] == [True, True, False]


def test_an_event_can_be_dated_a_little_back(client, db):
    client.post("/api/v1/events", json=_batch([
        {"name": "visit", "ago": 120}, {"name": "make_started", "ago": 0},
        {"name": "photo_taken", "ago": 10**9},      # capped, not trusted
    ]))
    visit, started, photo = _stored(db)
    assert 110 <= (started.created_at - visit.created_at).total_seconds() <= 130
    assert (started.created_at - photo.created_at).total_seconds() <= analytics.MAX_AGO + 5


def test_a_flood_is_cut_off(client, db, monkeypatch):
    monkeypatch.setattr(analytics, "budget", analytics._Budget(limit=3, seconds=60))
    r = client.post("/api/v1/events", json=_batch([{"name": "visit"}] * 5))
    assert r.json() == {"accepted": 3, "rejected": 2}
    assert len(_stored(db)) == 3


def test_a_browser_can_read_back_its_own_events(client, db):
    client.post("/api/v1/events", json=_batch([{"name": "visit"}, {"name": "make_started"}],
                                              door="test-fair", robot=True))
    client.post("/api/v1/events", json=_batch([{"name": "visit"}], visitor=OTHER))
    mine = client.get("/api/v1/events/mine", params={"visitor": VISITOR}).json()["events"]
    assert [e["name"] for e in mine] == ["visit", "make_started"]
    assert all(e["door"] == "test-fair" and e["robot"] is True and e["signed_in"] is False for e in mine)
    assert client.get("/api/v1/events/mine", params={"visitor": "maya@example.com"}).status_code == 422


# ---------------------------------------------------------------------------
# purchase_done: only from the signed webhook
# ---------------------------------------------------------------------------

@pytest.fixture
def store(monkeypatch):
    monkeypatch.setenv("LEMONSQUEEZY_API_KEY", "test-api-key")
    monkeypatch.setenv("LEMONSQUEEZY_STORE_ID", "12345")
    monkeypatch.setenv("LEMONSQUEEZY_WEBHOOK_SECRET", WEBHOOK_SECRET)
    monkeypatch.setenv("LEMONSQUEEZY_TEST_MODE", "true")
    for pack in ("starter", "maker", "studio"):
        monkeypatch.setenv(f"LEMONSQUEEZY_VARIANT_{pack.upper()}", f"variant-{pack}")


def _order(order_id, user_id, pack="maker", total=1500):
    body = {
        "meta": {"event_name": "order_created", "custom_data": {"user_id": str(user_id), "pack": pack}},
        "data": {"type": "orders", "id": str(order_id), "attributes": {
            "order_number": 1001, "status": "paid", "total": total, "total_usd": total, "currency": "USD",
            "user_email": "buyer@example.test", "refunded": False, "test_mode": True,
        }},
    }
    raw = json.dumps(body).encode()
    sig = hmac.new(WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    return raw, {"X-Signature": sig, "Content-Type": "application/json"}


def test_a_paid_order_is_a_purchase_in_the_buyers_funnel(client, db, make_user, store):
    """The real webhook, twice. One purchase, on the visitor who checked out."""
    user = make_user()
    client.post("/api/v1/events", json=_batch(
        [{"name": "visit"}, {"name": "checkout_started", "props": {"pack": "maker"}}], door="gift-noa-7"),
        headers=_auth(user))

    raw, headers = _order("order-77", user.id, pack="maker", total=1500)
    assert client.post("/api/payments/webhook", content=raw, headers=headers).status_code == 200
    assert client.post("/api/payments/webhook", content=raw, headers=headers).status_code == 200   # redelivered

    bought = _stored(db, name="purchase_done")
    assert len(bought) == 1, "a redelivered webhook must be one purchase"
    event = bought[0]
    assert event.source == "server"
    assert event.props == {"pack": "maker", "amount_cents": 1500, "test": True}
    assert event.user_id == user.id
    assert event.visitor_id == VISITOR and event.door == "gift-noa-7" and event.device == "phone"
    # No trace of the buyer's email, which the webhook body carries.
    assert "buyer@example.test" not in json.dumps([event.props, event.ref, event.door])


def test_an_unsigned_order_is_not_a_purchase(client, db, make_user, store):
    user = make_user()
    raw, headers = _order("order-78", user.id)
    headers["X-Signature"] = "0" * 64
    assert client.post("/api/payments/webhook", content=raw, headers=headers).status_code == 401
    assert _stored(db, name="purchase_done") == []


def test_a_purchase_by_someone_never_seen_in_a_browser_still_counts(client, db, make_user, store):
    user = make_user()
    raw, headers = _order("order-79", user.id, pack="starter", total=500)
    client.post("/api/payments/webhook", content=raw, headers=headers)
    event, = _stored(db, name="purchase_done")
    assert event.user_id == user.id and event.visitor_id is None and event.door is None


# ---------------------------------------------------------------------------
# hero_ready / hero_failed: from the real pipeline
# ---------------------------------------------------------------------------

class _AllFilesExist:
    def file_exists(self, *_a, **_kw):
        return True

    def get_file_path(self, *_a, **_kw):
        return "/dev/null"


@pytest.fixture
def storage_ok(monkeypatch):
    monkeypatch.setattr(pipeline, "get_storage", lambda: _AllFilesExist())


def _step_does(monkeypatch, body):
    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda _n: body)


async def _fine(creation_id, user_id, db):
    """A provider that delivers. The 3D step leaves the task id the rig reads."""
    from sqlalchemy.orm.attributes import flag_modified
    step = db.query(CreationStep).filter(CreationStep.creation_id == creation_id,
                                         CreationStep.step_name == "meshy_3d",
                                         CreationStep.status == "processing").first()
    if step is not None:
        step.metadata_json = {"meshy_3d_task_id": "task-1"}
        flag_modified(step, "metadata_json")
        db.commit()


def test_the_last_step_completing_is_a_hero_ready(db, make_user, make_creation, storage_ok, monkeypatch, client):
    user = make_user(credits=100)
    client.post("/api/v1/events", json=_batch([{"name": "make_started"}], door="fair-telaviv-nov"),
                headers=_auth(user))
    names = get_all_step_names()
    creation = make_creation(user.id, steps={n: "pending" for n in names})
    _step_does(monkeypatch, _fine)

    for name in names[:-1]:
        _run(pipeline.execute_step(creation.id, user.id, name, db))
        assert _stored(db, name="hero_ready") == [], "only the last step makes a hero ready"
    _run(pipeline.execute_step(creation.id, user.id, names[-1], db))
    _run(pipeline.execute_step(creation.id, user.id, names[-1], db))     # run again: still one hero

    ready = _stored(db, name="hero_ready")
    assert len(ready) == 1
    event = ready[0]
    assert event.props["provider"] == "meshy" and event.props["minutes"] >= 0
    assert event.user_id == user.id and event.visitor_id == VISITOR and event.door == "fair-telaviv-nov"
    assert event.source == "server"
    assert _stored(db, name="hero_failed") == []


def test_a_provider_failure_is_a_hero_failed(db, make_user, make_creation, storage_ok, monkeypatch):
    user = make_user(credits=100)
    creation = make_creation(user.id, steps={"meshy_3d": "pending"})

    async def boom(*_a, **_kw):
        raise RuntimeError("Meshy: rate limit, try again later (request for maya@example.com)")
    _step_does(monkeypatch, boom)

    with pytest.raises(RuntimeError):
        _run(pipeline.execute_step(creation.id, user.id, "meshy_3d", db))

    event, = _stored(db, name="hero_failed")
    assert event.props == {"step": "meshy_3d", "provider": "meshy", "code": step_errors.PROVIDER_BUSY}
    assert event.user_id == user.id
    # The provider's raw text is for admins (step.error_message); none of it is an event.
    assert "maya" not in json.dumps(event.props)
    assert _stored(db, name="hero_ready") == []


def test_a_timed_out_step_is_a_hero_failed(db, make_user, make_creation, storage_ok, monkeypatch):
    """A timeout cancels the task: CancelledError never reaches execute_step's
    handler, so the task manager says it, where it also refunds."""
    from app.services.task_manager import TaskManager

    user = make_user(credits=100)
    creation = make_creation(user.id, steps={"meshy_3d": "pending"})

    async def hangs(*_a, **_kw):
        await asyncio.sleep(30)
    _step_does(monkeypatch, hangs)

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
    event, = _stored(db, name="hero_failed")
    assert event.props == {"step": "meshy_3d", "provider": "meshy", "code": step_errors.PROVIDER_BUSY}


def test_a_step_cut_off_by_a_restart_is_a_hero_failed(db, make_user, make_creation):
    from app.services.startup_reconcile import reconcile_stuck_steps

    user = make_user(credits=100)
    creation = make_creation(user.id, steps={"openai_render": "processing"})
    reconcile_stuck_steps(db, note="test restart")
    event, = _stored(db, name="hero_failed")
    assert event.props == {"step": "openai_render", "provider": "openai", "code": step_errors.INTERRUPTED}


def test_recording_never_breaks_the_step(db, make_user, make_creation, storage_ok, monkeypatch):
    """An analytics failure is logged and swallowed: the hero still completes."""
    user = make_user(credits=100)
    names = get_all_step_names()
    creation = make_creation(user.id, steps={names[-1]: "pending"})
    _step_does(monkeypatch, _fine)

    def broken(*_a, **_kw):
        raise RuntimeError("analytics table is gone")
    monkeypatch.setattr(analytics, "clean_props", broken)

    assert _run(pipeline.execute_step(creation.id, user.id, names[-1], db)) == {"status": "completed"}
    step = db.query(CreationStep).filter_by(creation_id=creation.id).one()
    assert step.status == "completed"
    assert _stored(db) == []


# ---------------------------------------------------------------------------
# Classes: created, joined, and a student's hero in the student's funnel
# ---------------------------------------------------------------------------

def _jpeg() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (4, 4), (200, 30, 30)).save(out, format="JPEG")
    return out.getvalue() + b" a crayon dragon"


class _Tasks:
    """Keeps each pipeline run, to run to the end inside the test."""

    def __init__(self):
        self.pending = []

    def running_for_creation(self, creation_id):
        return []

    def create_task(self, creation_id, key, coro, timeout=None):
        self.pending.append(coro)

    def cancel_all_tasks_for_creation(self, creation_id):
        return 0

    def cancel_task(self, creation_id, step_name):
        return False

    def run_all(self):
        loop = asyncio.new_event_loop()
        try:
            while self.pending:
                loop.run_until_complete(self.pending.pop(0))
        finally:
            loop.close()


@pytest.fixture
def api():
    tasks = _Tasks()
    before = app.dependency_overrides.get(get_task_manager)
    app.dependency_overrides[get_task_manager] = lambda: tasks
    try:
        yield TestClient(app), tasks
    finally:
        if before is None:
            app.dependency_overrides.pop(get_task_manager, None)
        else:
            app.dependency_overrides[get_task_manager] = before


async def _provider_delivers(creation_id, user_id, db):
    from sqlalchemy.orm.attributes import flag_modified
    step = db.query(CreationStep).filter(CreationStep.creation_id == creation_id,
                                         CreationStep.status == "processing").one()
    get_storage().upload_file(user_id, creation_id, get_step_by_name(step.step_name)["output"],
                              b"out:" + step.step_name.encode())
    if step.step_name == "meshy_3d":
        step.metadata_json = {"meshy_3d_task_id": "task-1"}
        flag_modified(step, "metadata_json")
        db.commit()


def test_a_class_and_its_students_are_in_the_funnel(db, make_user, api, monkeypatch):
    """Through the endpoints and the real pipeline: the teacher's class_created,
    the student's class_joined, and the student's hero_ready on the browser
    that joined, all behind the class's own door."""
    client, tasks = api
    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda name: _provider_delivers)
    teacher = make_user(credits=100)
    client.post("/api/v1/events", json=_batch([{"name": "visit"}], visitor=OTHER, device="desktop"),
                headers=_auth(teacher))

    r = client.post("/api/v1/classes", json={"title": "Grade 2B", "seats": 3}, headers=_auth(teacher))
    assert r.status_code == 201, r.text
    class_id = r.json()["id"]
    created, = _stored(db, name="class_created")
    assert created.user_id == teacher.id and created.visitor_id == OTHER and created.device == "desktop"
    assert created.props == {}

    r = client.post(f"/api/v1/classes/{class_id}/start", json={"minutes": 45}, headers=_auth(teacher))
    pin = r.json()["live"]["pin"]
    door = analytics.class_door(class_id)
    assert door.startswith("class-") and analytics.SLUG_RE.match(door)

    tablet = TestClient(app)
    assert tablet.get(f"/api/v1/class/join/{pin}").json()["door"] == door
    r = tablet.post("/api/v1/class/join", json={"pin": pin, "first_name": "Maya", "age": 7, "visitor": VISITOR})
    assert r.status_code == 200, r.text
    assert r.json()["door"] == door
    tablet.post("/api/v1/class/join", json={"pin": pin, "first_name": "Maya", "age": 7, "visitor": VISITOR})  # back again

    joined = _stored(db, name="class_joined")
    assert len(joined) == 1, "the same student coming back is one join"
    assert joined[0].visitor_id == VISITOR and joined[0].door == door and joined[0].user_id is None
    assert joined[0].props == {}
    # The child's first name and age went to the class, never to an event.
    assert "Maya" not in json.dumps([[e.props, e.ref, e.door] for e in _stored(db)])

    r = tablet.post("/api/v1/class/me/hero", files={"image_file": ("d.jpg", _jpeg(), "image/jpeg")})
    assert r.status_code == 201, r.text
    tasks.run_all()                                         # the real pipeline, to the end

    ready, = _stored(db, name="hero_ready")
    assert ready.visitor_id == VISITOR, "a class student's hero belongs in the student's funnel"
    assert ready.door == door and ready.user_id is None


def test_a_join_with_a_made_up_visitor_is_still_a_join(db, make_user, api):
    client, _ = api
    teacher = make_user(credits=100)
    class_id = client.post("/api/v1/classes", json={"title": "Grade 2B", "seats": 3},
                           headers=_auth(teacher)).json()["id"]
    pin = client.post(f"/api/v1/classes/{class_id}/start", json={"minutes": 45},
                      headers=_auth(teacher)).json()["live"]["pin"]
    r = TestClient(app).post("/api/v1/class/join", json={"pin": pin, "first_name": "Noa", "visitor": "Noa Levi"})
    assert r.status_code == 200, r.text
    event, = _stored(db, name="class_joined")
    assert event.visitor_id is None and event.door == analytics.class_door(class_id)


# ---------------------------------------------------------------------------
# The migration
# ---------------------------------------------------------------------------

def test_migration_makes_the_table_on_a_database_that_predates_it(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/old.db")
    s = sessionmaker(bind=engine)()
    m020_analytics_events.migrate(s)
    m020_analytics_events.migrate(s)       # idempotent
    assert "analytics_events" in set(inspect(engine).get_table_names())
    made = {c["name"] for c in inspect(engine).get_columns("analytics_events")}
    assert made == {c.name for c in AnalyticsEvent.__table__.columns}
    indexed = {i["column_names"][0] for i in inspect(engine).get_indexes("analytics_events")}
    assert {"created_at", "name", "visitor_id", "user_id", "door", "is_robot", "ref"} <= indexed
    # The model can write to the table the migration made.
    s.add(AnalyticsEvent(name="visit", visitor_id=VISITOR, props={}))
    s.commit()
    assert s.query(AnalyticsEvent).count() == 1
