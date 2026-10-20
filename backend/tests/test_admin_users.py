"""
The admin console's user page: a user's heroes, removing and restoring one,
giving and taking back credits, and the audit log.

Everything goes through the real endpoints (FastAPI's TestClient) and so the
real services: moderation.remove_hero sets the m009 deleted_at that every
listing already honours, change_credits posts through ledger.post. Nothing is
re-implemented here; the listings checked are the ones visitors, owners and
teachers actually call.
"""
import os
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.migrations import m017_admin_actions
from app.models import AdminAction, ClassGuest, ClassRoom, ClassSession, Creation, CreditTransaction, User
from app.services import ledger, moderation
from app.services.auth import create_access_token
from app.services.task_manager import get_task_manager
from app.utils.storage import get_storage


class _NoTasks:
    def __init__(self):
        self.cancelled = []

    def cancel_all_tasks_for_creation(self, creation_id):
        self.cancelled.append(creation_id)
        return 0


@pytest.fixture
def tasks():
    t = _NoTasks()
    before = app.dependency_overrides.get(get_task_manager)
    app.dependency_overrides[get_task_manager] = lambda: t
    yield t
    if before is None:
        app.dependency_overrides.pop(get_task_manager, None)
    else:
        app.dependency_overrides[get_task_manager] = before


@pytest.fixture(autouse=True)
def _clean_classes(db):
    yield
    db.query(ClassGuest).delete()
    db.query(ClassSession).delete()
    db.query(Creation).update({Creation.class_id: None})
    db.query(ClassRoom).delete()
    db.commit()


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _ids(response):
    assert response.status_code == 200, response.text
    return [c["id"] for c in response.json()]


@pytest.fixture
def admin(make_user):
    return make_user(username="raz", is_admin=True)


@pytest.fixture
def client():
    return TestClient(app)


def _remove(client, admin, creation_id, reason="inappropriate", note=None):
    body = {"reason": reason}
    if note is not None:
        body["note"] = note
    return client.post(f"/api/admin/creations/{creation_id}/remove", json=body, headers=_auth(admin))


def _restore(client, admin, creation_id):
    return client.post(f"/api/admin/creations/{creation_id}/restore", headers=_auth(admin))


def _detail(client, admin, user_id):
    r = client.get(f"/api/admin/users/{user_id}", headers=_auth(admin))
    assert r.status_code == 200, r.text
    return r.json()


def _class_with_hero(db, teacher, steps):
    """A class of `teacher`'s with one student whose hero is finished, as
    classes.py lays it out: the hero is owned by the class's wallet."""
    wallet = User(username=f"wallet-{teacher.id[:8]}", kind="class_wallet", credits=0)
    db.add(wallet)
    db.commit()
    classroom = ClassRoom(owner_id=teacher.id, wallet_user_id=wallet.id, title="Grade 2B", seats=3, seats_used=1)
    db.add(classroom)
    db.commit()
    session = ClassSession(class_id=classroom.id, pin="123456", ends_at=datetime.utcnow() + timedelta(hours=1))
    db.add(session)
    db.commit()
    hero = Creation(user_id=wallet.id, class_id=classroom.id, character_name="Class Dragon")
    db.add(hero)
    db.commit()
    from app.models import CreationStep
    for name, status in steps.items():
        db.add(CreationStep(creation_id=hero.id, step_name=name, status=status))
    db.add(ClassGuest(class_id=classroom.id, session_id=session.id, first_name="Maya", age=7,
                      token_hash="h" * 64, creation_id=hero.id))
    db.commit()
    return classroom, hero


# ---------------------------------------------------------------------------
# Security: every new door is admin-only, on the server
# ---------------------------------------------------------------------------

NEW_ROUTES = [
    ("get", "/api/admin/users/{user}", None),
    ("post", "/api/admin/creations/{hero}/remove", {"reason": "inappropriate"}),
    ("post", "/api/admin/creations/{hero}/restore", None),
    ("post", "/api/admin/users/{user}/credits", {"amount": 5, "note": "because"}),
]


@pytest.mark.parametrize("method,path,body", NEW_ROUTES)
def test_a_non_admin_gets_403_on_every_new_endpoint(client, db, make_user, make_creation, completed_steps,
                                                    tasks, method, path, body):
    owner = make_user(credits=5)
    hero = make_creation(owner.id, completed_steps)
    plain = make_user(username="plain")
    url = path.format(user=owner.id, hero=hero.id)
    kwargs = {"json": body} if body is not None else {}

    assert getattr(client, method)(url, **kwargs).status_code == 401
    r = getattr(client, method)(url, headers=_auth(plain), **kwargs)
    assert r.status_code == 403, r.text
    # The owner of the hero is no admin either.
    assert getattr(client, method)(url, headers=_auth(owner), **kwargs).status_code == 403

    db.expire_all()
    assert db.get(Creation, hero.id).deleted_at is None
    assert ledger.get_balance(owner.id, db) == 5
    assert db.query(AdminAction).count() == 0


# ---------------------------------------------------------------------------
# A user's heroes
# ---------------------------------------------------------------------------

def test_admin_lists_a_users_heroes_in_every_state_and_removed_ones(client, db, admin, make_user, make_creation,
                                                                    completed_steps, tasks):
    owner = make_user(credits=12, username="dana")
    owner.name = "Dana"
    db.commit()
    ready = make_creation(owner.id, completed_steps)
    making = make_creation(owner.id, {"image_processing": "completed", "openai_render": "processing"})
    failed = make_creation(owner.id, {"image_processing": "failed"})
    removed = make_creation(owner.id, completed_steps)
    deleted_by_owner = make_creation(owner.id, completed_steps)
    deleted_by_owner.deleted_at = datetime.utcnow()
    db.commit()
    someone_else = make_creation(make_user().id, completed_steps)

    assert _remove(client, admin, removed.id, "not_a_drawing").status_code == 200

    page = _detail(client, admin, owner.id)
    assert page["user"]["username"] == "dana"
    assert page["user"]["name"] == "Dana"
    assert page["user"]["credits"] == 12
    heroes = {h["id"]: h for h in page["heroes"]}
    assert set(heroes) == {ready.id, making.id, failed.id, removed.id}
    assert deleted_by_owner.id not in heroes and someone_else.id not in heroes
    assert heroes[ready.id]["status"] == "completed" and heroes[ready.id]["removed"] is None
    assert heroes[making.id]["status"] == "processing"
    assert heroes[failed.id]["status"] == "failed"
    assert heroes[removed.id]["removed"]["reason"] == "not_a_drawing"
    assert heroes[removed.id]["removed"]["by"] == "raz"
    assert {k: page["counts"][k] for k in ("heroes", "removed")} == {"heroes": 3, "removed": 1}


def test_a_teachers_page_shows_their_school_and_their_class_heroes(client, db, admin, make_user, completed_steps):
    teacher = make_user(username="ms-levi")
    teacher.is_teacher = True
    teacher.school_name, teacher.school_city, teacher.school_type = "Oak School", "Haifa", "primary"
    db.commit()
    _, hero = _class_with_hero(db, teacher, completed_steps)

    page = _detail(client, admin, teacher.id)
    assert page["user"]["is_teacher"] is True
    assert page["user"]["school"]["name"] == "Oak School"
    assert page["user"]["classes"] == 1
    assert [(h["id"], h["class_title"]) for h in page["heroes"]] == [(hero.id, "Grade 2B")]


# ---------------------------------------------------------------------------
# Removing: gone from every public place, back after a restore
# ---------------------------------------------------------------------------

def test_a_removed_hero_vanishes_everywhere_and_comes_back_after_restore(client, db, admin, make_user, make_creation,
                                                                         completed_steps, tasks):
    owner = make_user()
    hero = make_creation(owner.id, completed_steps)
    other = make_creation(owner.id, completed_steps)
    hero.featured = other.featured = True
    db.commit()

    def visible():
        return {
            "featured": hero.id in _ids(client.get("/api/creations/?featured_only=true")),
            "all (admin)": hero.id in _ids(client.get("/api/creations/", headers=_auth(admin))),
            "my heroes": hero.id in _ids(client.get("/api/creations/?mine_only=true", headers=_auth(owner))),
            "its page": client.get(f"/api/creations/{hero.id}").status_code == 200,
        }

    assert all(visible().values())

    r = _remove(client, admin, hero.id, "inappropriate", note="Rude words on it")
    assert r.status_code == 200, r.text
    assert tasks.cancelled == [hero.id]
    assert not any(visible().values()), visible()
    # The rest of the gallery is untouched.
    assert other.id in _ids(client.get("/api/creations/?featured_only=true"))
    # The admin can still open its page from the user's page.
    assert client.get(f"/api/creations/{hero.id}", headers=_auth(admin)).status_code == 200
    # Removing twice is refused, not recorded twice.
    assert _remove(client, admin, hero.id).status_code == 409

    r = _restore(client, admin, hero.id)
    assert r.status_code == 200, r.text
    assert all(visible().values()), visible()
    db.expire_all()
    assert db.get(Creation, hero.id).featured is True   # back in Editors' choice as it was

    actions = [a["action"] for a in _detail(client, admin, owner.id)["audit"]]
    assert actions == ["restore_hero", "remove_hero"]


def test_a_removed_class_hero_leaves_the_class_page_and_stage(client, db, admin, make_user, completed_steps, tasks):
    teacher = make_user(username="teacher")
    classroom, hero = _class_with_hero(db, teacher, completed_steps)

    def on_class_page():
        view = client.get(f"/api/classes/{classroom.id}", headers=_auth(teacher)).json()
        stage = client.get(f"/api/classes/{classroom.id}/stage", headers=_auth(teacher)).json()
        return {
            "roster": any(s["hero"] and s["hero"]["creation_id"] == hero.id for s in view["roster"]),
            "preview": any(p["creation_id"] == hero.id for p in view["preview"]),
            "stage": any(h["creationId"] == hero.id for h in stage["heroes"]),
        }

    assert all(on_class_page().values())
    assert _remove(client, admin, hero.id, "duplicate").status_code == 200
    assert not any(on_class_page().values())
    # Recorded on the teacher's page: the wallet that owns it is nobody's account.
    assert [a["action"] for a in _detail(client, admin, teacher.id)["audit"]] == ["remove_hero"]

    assert _restore(client, admin, hero.id).status_code == 200
    assert all(on_class_page().values())


def test_a_removed_heros_files_are_not_public_but_the_admin_still_sees_them(client, db, admin, make_user,
                                                                            make_creation, completed_steps, tasks):
    owner = make_user()
    hero = make_creation(owner.id, completed_steps)
    get_storage().upload_file(owner.id, hero.id, "original.jpg", b"\xff\xd8\xff a drawing")
    url = f"/api/files/{owner.id}/{hero.id}/original.jpg"
    visitor = TestClient(app)
    assert visitor.get(url).status_code == 200

    assert _remove(client, admin, hero.id).status_code == 200
    assert visitor.get(url).status_code == 404
    assert visitor.get(f"/api/files/{owner.id}/{hero.id}/thumb_original.jpg").status_code == 404
    # The owner's own browser carries no pass: their removed hero is gone for them too.
    assert TestClient(app).get(url, headers=_auth(owner)).status_code == 404

    # The admin's user page hands their browser the file pass, scoped to /api/files.
    seen = client.get(f"/api/admin/users/{owner.id}", headers=_auth(admin))
    cookie = seen.headers["set-cookie"]
    assert moderation.FILE_PASS_COOKIE in cookie and "Path=/api/files" in cookie and "HttpOnly" in cookie
    assert client.get(url).status_code == 200

    # A pass is not a sign-in: it never works as a Bearer token.
    pass_value = client.cookies.get(moderation.FILE_PASS_COOKIE)
    assert visitor.get("/api/auth/me", headers={"Authorization": f"Bearer {pass_value}"}).status_code == 401
    # Forged, or an admin's who is no longer one: refused.
    forged = pass_value.rsplit(".", 1)[0] + "." + "0" * 64
    assert TestClient(app, cookies={moderation.FILE_PASS_COOKIE: forged}).get(url).status_code == 404
    plain = make_user(username="plain")
    demoted = TestClient(app, cookies={moderation.FILE_PASS_COOKIE: moderation.issue_file_pass(plain.id)})
    assert demoted.get(url).status_code == 404

    assert _restore(client, admin, hero.id).status_code == 200
    assert visitor.get(url).status_code == 200


def test_a_reason_is_required_to_remove(client, db, admin, make_user, make_creation, completed_steps, tasks):
    hero = make_creation(make_user().id, completed_steps)
    for body in ({}, {"reason": ""}, {"reason": "ugly"}, {"reason": "other"}, {"reason": "other", "note": "   "}):
        r = client.post(f"/api/admin/creations/{hero.id}/remove", json=body, headers=_auth(admin))
        assert r.status_code == 422, (body, r.text)
    db.expire_all()
    assert db.get(Creation, hero.id).deleted_at is None
    assert db.query(AdminAction).count() == 0

    r = _remove(client, admin, hero.id, "other", note="A photo of a TV screen")
    assert r.status_code == 200
    assert r.json()["note"] == "A photo of a TV screen"


def test_a_hero_its_owner_deleted_cannot_be_restored(client, db, admin, make_user, make_creation, completed_steps):
    hero = make_creation(make_user().id, completed_steps)
    hero.deleted_at = datetime.utcnow()
    db.commit()
    assert _restore(client, admin, hero.id).status_code == 409
    assert client.get(f"/api/creations/{hero.id}", headers=_auth(admin)).status_code == 404
    db.expire_all()
    assert db.get(Creation, hero.id).deleted_at is not None


# ---------------------------------------------------------------------------
# Credits: through the ledger, never revenue
# ---------------------------------------------------------------------------

def test_giving_credits_moves_the_balance_and_writes_a_ledger_row_and_an_audit_row(client, db, admin, make_user):
    owner = make_user(credits=7)
    r = client.post(f"/api/admin/users/{owner.id}/credits", json={"amount": 10, "note": "Sorry about the outage"},
                    headers=_auth(admin))
    assert r.status_code == 200, r.text
    assert r.json()["credits"] == 17

    db.expire_all()
    check = ledger.verify_user_balance(owner.id, db)
    assert check.cached == check.ledger == 17          # sum(delta) == balance
    tx = db.query(CreditTransaction).filter(CreditTransaction.user_id == owner.id,
                                            CreditTransaction.reason == "admin_adjust").one()
    assert tx.delta == 10 and tx.balance_after == 17
    audit = db.query(AdminAction).one()
    assert (audit.action, audit.amount, audit.note, audit.admin_id) == ("grant_credits", 10, "Sorry about the outage", admin.id)
    assert audit.details["balance_after"] == 17
    assert tx.external_ref == f"admin_action:{audit.id}"
    assert tx.metadata_json["note"] == "Sorry about the outage"

    # Not revenue: no payment, so the Money page's income stays at zero, and
    # the credits count among those still owed (the cost of serving them).
    money = client.get("/api/admin/money/summary?period=all", headers=_auth(admin)).json()
    assert money["income"]["live"]["count"] == 0 and money["income"]["live"]["net_usd_micros"] == 0
    assert money["credits_held"]["credits"] == 17

    page = _detail(client, admin, owner.id)
    assert page["user"]["credits"] == 17
    assert page["audit"][0]["action"] == "grant_credits"
    assert page["audit"][0]["admin"]["username"] == "raz"


def test_taking_back_credits_stops_at_zero(client, db, admin, make_user):
    owner = make_user(credits=5)
    r = client.post(f"/api/admin/users/{owner.id}/credits", json={"amount": -6, "note": "Duplicate grant"},
                    headers=_auth(admin))
    assert r.status_code == 409, r.text
    assert "5" in r.json()["detail"]
    db.expire_all()
    assert ledger.get_balance(owner.id, db) == 5
    assert db.query(AdminAction).count() == 0

    r = client.post(f"/api/admin/users/{owner.id}/credits", json={"amount": -5, "note": "Duplicate grant"},
                    headers=_auth(admin))
    assert r.status_code == 200, r.text
    assert r.json()["credits"] == 0
    db.expire_all()
    check = ledger.verify_user_balance(owner.id, db)
    assert check.cached == check.ledger == 0
    assert db.query(AdminAction).one().action == "take_credits"


@pytest.mark.parametrize("body", [
    {"amount": 5},                          # no note
    {"amount": 5, "note": "  "},
    {"amount": 0, "note": "nothing"},
    {"amount": 100000, "note": "a typo"},
])
def test_a_credit_change_needs_a_note_and_a_sane_amount(client, db, admin, make_user, body):
    owner = make_user(credits=3)
    r = client.post(f"/api/admin/users/{owner.id}/credits", json=body, headers=_auth(admin))
    assert r.status_code == 422, r.text
    db.expire_all()
    assert ledger.get_balance(owner.id, db) == 3
    assert db.query(AdminAction).count() == 0


def test_the_older_set_credits_and_admin_toggle_are_audited_too(client, db, admin, make_user):
    owner = make_user(credits=4)
    assert client.patch(f"/api/admin/users/{owner.id}", json={"credits": 9}, headers=_auth(admin)).status_code == 200
    assert client.patch(f"/api/admin/users/{owner.id}", json={"is_admin": True}, headers=_auth(admin)).status_code == 200
    actions = [(a["action"], a["amount"]) for a in _detail(client, admin, owner.id)["audit"]]
    assert actions == [("make_admin", None), ("set_credits", 5)]


def test_the_user_list_counts_only_live_heroes(client, db, admin, make_user, make_creation, completed_steps, tasks):
    owner = make_user(username="counted")
    keep = make_creation(owner.id, completed_steps)
    gone = make_creation(owner.id, completed_steps)
    assert _remove(client, admin, gone.id).status_code == 200
    row = next(u for u in client.get("/api/admin/users?include_test=true", headers=_auth(admin)).json()
               if u["id"] == owner.id)
    assert row["creation_stats"]["completed"] == 1
    assert keep.id


def test_the_user_list_and_the_user_page_count_the_same_heroes(client, db, admin, make_user, make_creation,
                                                                completed_steps, tasks):
    """Support compares the card with the page: "4 heroes" on one and "9" on
    the other read as heroes gone missing. Both count every live hero, class
    heroes too, and split them the same way. A drawing never started
    (Creation.never_started) is in neither: not a hero, least of all "making"."""
    teacher = make_user(username="counted2")
    make_creation(teacher.id, completed_steps)
    make_creation(teacher.id, {"image_processing": "completed", "openai_render": "failed"})
    make_creation(teacher.id, {"image_processing": "completed", "openai_render": "processing"})
    make_creation(teacher.id, {"image_processing": "pending", "openai_render": "pending"})
    gone = make_creation(teacher.id, completed_steps)
    assert _remove(client, admin, gone.id).status_code == 200
    _class_with_hero(db, teacher, completed_steps)

    row = next(u for u in client.get("/api/admin/users?include_test=true", headers=_auth(admin)).json()
               if u["id"] == teacher.id)
    stats = row["creation_stats"]
    assert stats == {"total": 4, "completed": 2, "failed": 1, "in_progress": 1}
    counts = _detail(client, admin, teacher.id)["counts"]
    assert counts["heroes"] == stats["total"] == 4 and counts["removed"] == 1
    assert {k: counts[k] for k in stats} == stats


# ---------------------------------------------------------------------------
# The migration
# ---------------------------------------------------------------------------

def test_m017_makes_the_table_on_an_existing_database(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/old.db")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT)"))
    db = sessionmaker(bind=engine)()
    try:
        m017_admin_actions.migrate(db)
        m017_admin_actions.migrate(db)     # idempotent
        cols = {c["name"] for c in inspect(engine).get_columns("admin_actions")}
        assert {"admin_id", "target_user_id", "creation_id", "action", "reason", "note", "amount",
                "details", "created_at"} <= cols
        indexes = {i["name"] for i in inspect(engine).get_indexes("admin_actions")}
        assert "ix_admin_actions_target_user_id" in indexes
    finally:
        db.close()


@pytest.mark.skipif(not os.getenv("TEST_POSTGRES_URL"), reason="set TEST_POSTGRES_URL to run m017 on Postgres")
def test_m017_on_postgres():
    from app.database import Base
    import app.models  # noqa: F401

    engine = create_engine(os.environ["TEST_POSTGRES_URL"])
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS admin_actions"))
    db = sessionmaker(bind=engine)()
    try:
        m017_admin_actions.migrate(db)
        m017_admin_actions.migrate(db)
        cols = {c["name"]: c for c in inspect(engine).get_columns("admin_actions")}
        assert "details" in cols and "JSON" in str(cols["details"]["type"]).upper()
    finally:
        db.close()
        engine.dispose()
