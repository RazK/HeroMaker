"""
Classes: a teacher pays for seats up front, students make one hero each with no
account, a parent claims a child's hero. docs/product/class-sessions.md.

These drive the REAL code paths: the endpoints through FastAPI's TestClient, and
the hero through the real `pipeline.run_pipeline` -> `execute_step`, which
charges each step to the class's wallet and refunds it on failure. Only the
step bodies (the provider calls) are replaced, by ones that write the step's
output file or raise. The task manager is a stand-in that keeps the pipeline
coroutine so the test can run it to the end.
"""
import asyncio
import threading
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app.config.steps import STEPS, get_step_by_name
from app.database import SessionLocal
from app.main import app
from app.migrations import m015_classes, m019_class_seat_returns
from app.models import ClassGuest, ClassRoom, ClassSession, Creation, CreditTransaction, User
from app.services import classes, demo_library, ledger, pipeline
from app.services.account_deletion import delete_account
from app.services.auth import create_access_token
from app.services.task_manager import get_task_manager
from app.utils.storage import get_storage

HERO = sum(s["credit_cost"] for s in STEPS)   # 10 credits
DRAWING = b"\xff\xd8\xff a crayon dragon"


class _Tasks:
    """Stands in for the task manager: keeps each pipeline run to run later."""

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


@pytest.fixture(autouse=True)
def _clean_classes():
    def wipe():
        db = SessionLocal()
        try:
            db.query(ClassGuest).delete()
            db.query(ClassSession).delete()
            db.query(Creation).update({Creation.class_id: None})
            db.query(ClassRoom).delete()
            db.commit()
        finally:
            db.close()
    wipe()
    classes.reset_throttles()
    yield
    wipe()


@pytest.fixture
def api():
    tasks = _Tasks()
    before = app.dependency_overrides.get(get_task_manager)
    app.dependency_overrides[get_task_manager] = lambda: tasks
    try:
        yield TestClient(app), tasks
    finally:
        # Other modules install their own stand-in at import; put it back.
        if before is None:
            app.dependency_overrides.pop(get_task_manager, None)
        else:
            app.dependency_overrides[get_task_manager] = before


def _deliver(db, creation_id, user_id):
    """What a provider does for the running step: write its output (and, for
    the 3D step, the task id the rig step reads)."""
    from sqlalchemy.orm.attributes import flag_modified
    from app.models import CreationStep
    step = db.query(CreationStep).filter(CreationStep.creation_id == creation_id,
                                         CreationStep.status == "processing").one()
    get_storage().upload_file(user_id, creation_id, get_step_by_name(step.step_name)["output"],
                              b"out:" + step.step_name.encode())
    if step.step_name == "meshy_3d":
        step.metadata_json = {"meshy_3d_task_id": "task-1"}
        flag_modified(step, "metadata_json")
        db.commit()


async def _fine(creation_id, user_id, db):
    _deliver(db, creation_id, user_id)


@pytest.fixture
def steps_succeed(monkeypatch):
    """Every step 'calls its provider' by writing its output file."""
    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda name: _fine)


def _current(db, creation_id):
    from app.models import CreationStep
    return db.query(CreationStep).filter(CreationStep.creation_id == creation_id,
                                         CreationStep.status == "processing").one().step_name


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _balance(db, user_id):
    db.expire_all()
    return ledger.get_balance(user_id, db)


def _new_class(client, teacher, seats=3, title="Grade 2B"):
    r = client.post("/api/classes", json={"title": title, "seats": seats}, headers=_auth(teacher))
    assert r.status_code == 201, r.text
    return r.json()


def _start(client, teacher, class_id, minutes=45, approve_first=False):
    r = client.post(f"/api/classes/{class_id}/start", json={"minutes": minutes, "approve_first": approve_first},
                    headers=_auth(teacher))
    assert r.status_code == 200, r.text
    return r.json()["live"]["pin"]


class Student:
    """One browser: its own cookie jar, like a child's tablet."""

    def __init__(self, tasks=None):
        self.client = TestClient(app)

    def join(self, pin, name="Maya", age=7):
        return self.client.post("/api/class/join", json={"pin": pin, "first_name": name, "age": age})

    def make(self, drawing=DRAWING, style=None):
        data = {"style": style} if style else {}
        return self.client.post("/api/class/me/hero", files={"image_file": ("d.jpg", drawing, "image/jpeg")},
                                data=data)

    def me(self):
        return self.client.get("/api/class/me")


# ---------------------------------------------------------------------------
# Paying for a class
# ---------------------------------------------------------------------------

def test_a_class_is_paid_up_front_into_its_own_wallet(db, make_user, api):
    client, _ = api
    teacher = make_user(credits=300)
    c = _new_class(client, teacher, seats=20)

    room = db.query(ClassRoom).filter_by(id=c["id"]).one()
    assert c["seats"] == 20 and c["seats_left"] == 20
    assert _balance(db, teacher.id) == 300 - 20 * HERO
    assert _balance(db, room.wallet_user_id) == 20 * HERO
    for uid in (teacher.id, room.wallet_user_id):
        assert ledger.verify_user_balance(uid, db).consistent
    moves = db.query(CreditTransaction).filter(CreditTransaction.reason == "class_seats").all()
    assert sorted(t.delta for t in moves) == [-200, 200]

    wallet = db.query(User).filter_by(id=room.wallet_user_id).one()
    assert wallet.kind == "class_wallet" and wallet.email is None and wallet.password_hash is None
    db.refresh(teacher)
    assert teacher.is_teacher is True
    # A wallet is not a person: the admin's user list never shows it.
    from app.services.users import list_users_with_stats
    assert wallet.id not in {u["id"] for u in list_users_with_stats(db)}


def test_not_enough_credits_buys_no_class(db, make_user, api):
    client, _ = api
    teacher = make_user(credits=100)
    r = client.post("/api/classes", json={"title": "Grade 2B", "seats": 30}, headers=_auth(teacher))
    assert r.status_code == 402
    assert r.json()["detail"] == "You need 300 credits for 30 heroes. You have 100."
    assert db.query(ClassRoom).count() == 0
    assert _balance(db, teacher.id) == 100


def test_adding_seats_pays_for_them(db, make_user, api):
    client, _ = api
    teacher = make_user(credits=100)
    c = _new_class(client, teacher, seats=5)
    r = client.post(f"/api/classes/{c['id']}/seats", json={"seats": 3}, headers=_auth(teacher))
    assert r.status_code == 200, r.text
    assert r.json()["seats"] == 8
    assert _balance(db, teacher.id) == 100 - 80


def test_only_the_teacher_sees_their_class(db, make_user, api):
    client, _ = api
    teacher, other = make_user(credits=100), make_user(credits=100)
    c = _new_class(client, teacher)
    assert client.get(f"/api/classes/{c['id']}", headers=_auth(other)).status_code == 404
    assert client.get("/api/classes", headers=_auth(other)).json()["classes"] == []
    assert [x["id"] for x in client.get("/api/classes", headers=_auth(teacher)).json()["classes"]] == [c["id"]]


# ---------------------------------------------------------------------------
# A student's one hero, through the real pipeline
# ---------------------------------------------------------------------------

def test_student_makes_one_hero_paid_by_the_class(db, make_user, api, steps_succeed):
    client, tasks = api
    teacher = make_user(credits=100)
    c = _new_class(client, teacher, seats=3)
    pin = _start(client, teacher, c["id"])
    assert len(pin) == 6 and pin.isdigit()

    maya = Student()
    r = maya.join(pin, "Maya", 7)
    assert r.status_code == 200, r.text
    assert r.json()["can_make"] is True
    assert maya.client.cookies.get(classes.GUEST_COOKIE)    # the pass, httpOnly

    r = maya.make()
    assert r.status_code == 201, r.text
    hero = r.json()["hero"]
    tasks.run_all()                                       # the real pipeline, to the end

    room = db.query(ClassRoom).filter_by(id=c["id"]).one()
    creation = db.query(Creation).filter_by(id=hero["creation_id"]).one()
    assert creation.user_id == room.wallet_user_id          # owned and paid by the class
    assert creation.name == "Maya" and creation.age == 7
    assert creation.class_id == room.id and creation.is_public is False
    assert creation.status == "completed"
    assert _balance(db, room.wallet_user_id) == 3 * HERO - HERO
    assert _balance(db, teacher.id) == 100 - 3 * HERO       # nothing more from the teacher
    assert room.seats_used == 1
    assert maya.me().json()["hero"]["state"] == "ready"

    # A class hero is in no gallery: not the teacher's own, not Editors' choice.
    mine = client.get("/api/creations/?mine_only=true", headers=_auth(teacher)).json()
    assert creation.id not in {x["id"] for x in mine}
    featured = client.get("/api/creations/?featured_only=true").json()
    assert creation.id not in {x["id"] for x in featured}
    # An admin's "All heroes" lists it, marked, and it cannot be starred public.
    admin = make_user(is_admin=True)
    everything = {x["id"]: x for x in client.get("/api/creations/", headers=_auth(admin)).json()}
    assert everything[creation.id]["in_class"] is True
    r = client.put(f"/api/creations/{creation.id}/featured", json={"featured": True}, headers=_auth(admin))
    assert r.status_code == 409
    # ...but it is on the class's roster.
    roster = client.get(f"/api/classes/{c['id']}", headers=_auth(teacher)).json()["roster"]
    assert [(s["label"], s["age"], s["hero"]["state"]) for s in roster] == [("Maya", 7, "ready")]
    # The class card shows it, with the versions its thumbnails cache by.
    card = client.get("/api/classes", headers=_auth(teacher)).json()["classes"][0]
    assert [(p["label"], p["creation_id"]) for p in card["preview"]] == [("Maya", creation.id)]
    assert card["preview"][0]["file_versions"] == roster[0]["hero"]["file_versions"]


@pytest.mark.parametrize("sent, stored", [("lego", "lego"), (None, None), ("original", None)])
def test_a_students_style_is_the_heros_and_the_retired_one_is_the_default(
        db, make_user, api, steps_succeed, sent, stored):
    """The class picker's style is the hero's. "original" is retired: a tablet
    still showing it makes the hero in the default style, not an error."""
    client, tasks = api
    teacher = make_user(credits=100)
    c = _new_class(client, teacher, seats=1)
    maya = Student()
    maya.join(_start(client, teacher, c["id"]))
    r = maya.make(style=sent)
    assert r.status_code == 201, r.text
    creation = db.query(Creation).filter_by(id=r.json()["hero"]["creation_id"]).one()
    assert creation.style == stored
    assert client.get(f"/api/creations/{creation.id}").json()["style"] == (stored or "pixar")


def test_a_second_hero_is_refused_kindly(db, make_user, api, steps_succeed):
    client, tasks = api
    teacher = make_user(credits=100)
    c = _new_class(client, teacher, seats=5)
    pin = _start(client, teacher, c["id"])
    maya = Student()
    maya.join(pin)
    assert maya.make().status_code == 201
    tasks.run_all()

    r = maya.make()
    assert r.status_code == 409
    assert r.json()["detail"] == "You already made your hero!"
    # Joining again from the same browser is the same student, not a new pass.
    again = maya.join(pin, "Maya", 7)
    assert again.status_code == 200 and again.json()["pass"] is None
    assert maya.make().status_code == 409
    assert db.query(Creation).count() == 1
    assert db.query(ClassRoom).filter_by(id=c["id"]).one().seats_used == 1


def test_a_second_student_on_the_same_tablet_waits_for_the_teacher(db, make_user, api, steps_succeed):
    client, tasks = api
    teacher = make_user(credits=100)
    c = _new_class(client, teacher, seats=5)
    pin = _start(client, teacher, c["id"])
    tablet = Student()
    tablet.join(pin, "Maya")
    assert tablet.make().status_code == 201

    # "Next student": the app drops Maya's pass; the browser marker stays.
    assert tablet.client.post("/api/class/leave").status_code == 200
    assert tablet.me().status_code == 403
    r = tablet.join(pin, "Noa", 8)
    assert r.status_code == 200
    assert r.json()["guest"]["status"] == "waiting" and r.json()["can_make"] is False
    assert tablet.make().status_code == 409

    noa = next(s for s in client.get(f"/api/classes/{c['id']}", headers=_auth(teacher)).json()["roster"]
               if s["first_name"] == "Noa")
    assert noa["shared_device"] is True
    r = client.post(f"/api/classes/{c['id']}/students/{noa['id']}/approve", headers=_auth(teacher))
    assert r.status_code == 200
    assert tablet.make().status_code == 201


def test_approve_first_makes_everyone_wait(db, make_user, api):
    client, _ = api
    teacher = make_user(credits=100)
    c = _new_class(client, teacher, seats=5)
    pin = _start(client, teacher, c["id"], approve_first=True)
    assert Student().join(pin).json()["guest"]["status"] == "waiting"


def test_seats_bound_the_cost_whatever_the_browsers_do(db, make_user, api, steps_succeed):
    """Fresh browsers (a child clearing site data looks exactly like this) get
    no further than the seats the teacher paid for."""
    client, tasks = api
    teacher = make_user(credits=100)
    c = _new_class(client, teacher, seats=2)
    pin = _start(client, teacher, c["id"])
    results = []
    for name in ("Maya", "Noa", "Itai"):
        s = Student()
        joined = s.join(pin, name)
        results.append(s.make().status_code if joined.status_code == 200 else joined.status_code)
    # The third is told the class is full when joining: no pass, no card.
    assert results == [201, 201, 409]
    tasks.run_all()
    room = db.query(ClassRoom).filter_by(id=c["id"]).one()
    assert room.seats_used == 2
    assert _balance(db, room.wallet_user_id) == 0
    assert db.query(Creation).count() == 2


def test_the_seat_guard_holds_under_a_race(db, make_user, api):
    """Ten students hit 'Make my hero' at once for three seats."""
    client, _ = api
    teacher = make_user(credits=100)
    c = _new_class(client, teacher, seats=3)
    _start(client, teacher, c["id"])
    room_id = c["id"]
    session_id = db.query(ClassSession).filter_by(class_id=room_id).one().id
    guest_ids = []
    for i in range(10):
        g = ClassGuest(class_id=room_id, session_id=session_id, first_name=f"Kid", token_hash=f"t{i}" * 8,
                       status="approved")
        db.add(g)
        db.commit()
        guest_ids.append(g.id)

    won, barrier = [], threading.Barrier(10)

    def go(gid):
        s = SessionLocal()
        try:
            guest = s.query(ClassGuest).filter_by(id=gid).one()
            barrier.wait()
            for _ in range(20):
                try:
                    classes._take_seat(s, guest, datetime.utcnow())
                    won.append(gid)
                    return
                except classes.ClassError:
                    return
                except Exception:      # SQLite "database is locked": try again
                    s.rollback()
        finally:
            s.close()

    threads = [threading.Thread(target=go, args=(g,)) for g in guest_ids]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    db.expire_all()
    assert len(won) == 3
    assert db.query(ClassRoom).filter_by(id=room_id).one().seats_used == 3


def test_a_failed_hero_refunds_the_class_and_can_be_tried_again(db, make_user, api, monkeypatch):
    client, tasks = api
    teacher = make_user(credits=100)
    c = _new_class(client, teacher, seats=2)
    pin = _start(client, teacher, c["id"])
    room = db.query(ClassRoom).filter_by(id=c["id"]).one()
    wallet = room.wallet_user_id

    async def meshy_down(creation_id, user_id, s):
        name = _current(s, creation_id)
        if name == "meshy_3d":
            raise RuntimeError("NoMorePendingTasks")
        _deliver(s, creation_id, user_id)

    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda name: meshy_down)
    maya = Student()
    maya.join(pin)
    assert maya.make().status_code == 201
    tasks.run_all()

    assert maya.me().json()["hero"]["state"] == "failed"
    # The 3D step (5) came back to the class from its own failure handler, and
    # the render (2) with the seat: a failed hero takes nothing from the class.
    assert _balance(db, wallet) == 2 * HERO
    refunds = db.query(CreditTransaction).filter_by(user_id=wallet, reason="refund").all()
    assert sorted(r.delta for r in refunds) == sorted(
        [get_step_by_name("meshy_3d")["credit_cost"], get_step_by_name("openai_render")["credit_cost"]])
    assert ledger.verify_user_balance(wallet, db).consistent
    db.expire_all()
    assert db.query(ClassRoom).filter_by(id=c["id"]).one().seats_used == 0

    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda name: _fine)
    r = maya.client.post("/api/class/me/hero/retry")
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.query(ClassRoom).filter_by(id=c["id"]).one().seats_used == 1   # the seat taken again
    tasks.run_all()
    assert maya.me().json()["hero"]["state"] == "ready"
    db.expire_all()
    assert db.query(ClassRoom).filter_by(id=c["id"]).one().seats_used == 1   # one seat, one hero
    # The retry ran from the 3D step: the painting it kept is on us.
    assert _balance(db, wallet) == 2 * HERO - (HERO - get_step_by_name("openai_render")["credit_cost"])
    assert ledger.verify_user_balance(wallet, db).consistent


async def _meshy_down(creation_id, user_id, s):
    if _current(s, creation_id) == "meshy_3d":
        raise RuntimeError("NoMorePendingTasks")
    _deliver(s, creation_id, user_id)


def _room(db, class_id):
    db.expire_all()
    return db.query(ClassRoom).filter_by(id=class_id).one()


def _roster(client, teacher, class_id):
    r = client.get(f"/api/classes/{class_id}", headers=_auth(teacher))
    assert r.status_code == 200, r.text
    return r.json()


def test_a_failed_hero_gives_its_seat_back_once_for_the_next_child(db, make_user, api, monkeypatch):
    """Daniel's lesson: 1 seat left, a hero fails at 3D. The seat comes back
    by itself (whole, and only once, however often it is looked at), the next
    child takes it, and then Try again needs a seat the teacher adds."""
    client, tasks = api
    teacher = make_user(credits=100)
    c = _new_class(client, teacher, seats=1)
    pin = _start(client, teacher, c["id"])
    wallet = _room(db, c["id"]).wallet_user_id

    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda name: _meshy_down)
    shira = Student()
    shira.join(pin, "Shira")
    assert shira.make().status_code == 201
    assert _room(db, c["id"]).seats_used == 1
    tasks.run_all()

    view = _roster(client, teacher, c["id"])
    assert view["seats_used"] == 0 and view["seats_left"] == 1
    assert view["roster"][0]["hero"]["state"] == "failed" and view["roster"][0]["seat_returned"] is True
    assert _balance(db, wallet) == HERO                      # the seat back whole
    # Looked at again and again, swept again: never a second seat or refund.
    for _ in range(3):
        _roster(client, teacher, c["id"])
    assert classes.release_failed_seats(db, _room(db, c["id"])) == 0
    assert _room(db, c["id"]).seats_used == 0
    assert db.query(CreditTransaction).filter_by(user_id=wallet, reason="refund").count() == 2
    assert _balance(db, wallet) == HERO and ledger.verify_user_balance(wallet, db).consistent

    # The next child takes the seat that came back.
    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda name: _fine)
    noa = Student()
    assert noa.join(pin, "Noa").status_code == 200
    assert noa.make().status_code == 201
    tasks.run_all()
    assert _room(db, c["id"]).seats_used == 1 and _balance(db, wallet) == 0

    # Now Shira's Try again needs a seat, on her tablet and on the board.
    r = shira.client.post("/api/class/me/hero/retry")
    assert r.status_code == 409 and r.json()["detail"] == "This class is full. Ask your teacher for a seat."
    shira_id = view["roster"][0]["id"]
    r = client.post(f"/api/classes/{c['id']}/students/{shira_id}/retry", headers=_auth(teacher))
    assert r.status_code == 409 and r.json()["detail"] == "No seats left. Add a seat to try again."
    assert _room(db, c["id"]).seats_used == 1

    # The teacher adds a seat and tries again from the board, after class too.
    client.post(f"/api/classes/{c['id']}/end", headers=_auth(teacher))
    assert client.post(f"/api/classes/{c['id']}/seats", json={"seats": 1}, headers=_auth(teacher)).status_code == 200
    r = client.post(f"/api/classes/{c['id']}/students/{shira_id}/retry", headers=_auth(teacher))
    assert r.status_code == 200, r.text
    assert r.json()["roster"][0]["hero"]["state"] != "failed"
    tasks.run_all()
    view = _roster(client, teacher, c["id"])
    assert [s["hero"]["state"] for s in view["roster"]] == ["ready", "ready"]
    assert view["seats_used"] == 2 and view["heroes_ready"] == 2
    assert ledger.verify_user_balance(wallet, db).consistent


def test_a_hero_cut_off_by_a_restart_gives_its_seat_back_on_the_next_look(db, make_user, api, monkeypatch):
    """The run's own hand-back never runs when its task is cancelled (a
    timeout, a deploy): CancelledError is a BaseException. The restart sweep
    fails and refunds the step; the next look at the class frees the seat."""
    from app.services import startup_reconcile
    client, tasks = api
    teacher = make_user(credits=100)
    c = _new_class(client, teacher, seats=1)
    pin = _start(client, teacher, c["id"])
    wallet = _room(db, c["id"]).wallet_user_id

    async def cut_off_at_3d(creation_id, user_id, s):
        if _current(s, creation_id) == "meshy_3d":
            raise asyncio.CancelledError()
        _deliver(s, creation_id, user_id)

    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda name: cut_off_at_3d)
    kid = Student()
    kid.join(pin, "Yoni")
    assert kid.make().status_code == 201
    with pytest.raises(asyncio.CancelledError):
        tasks.run_all()
    assert _room(db, c["id"]).seats_used == 1                     # still held: nothing has failed yet

    startup_reconcile.reconcile_stuck_steps(db)
    assert _roster(client, teacher, c["id"])["seats_used"] == 0
    assert _balance(db, wallet) == HERO
    assert ledger.verify_user_balance(wallet, db).consistent


def test_a_cancelled_hero_keeps_its_seat(db, make_user, api):
    """A cancel keeps its charge, as for any hero: so it keeps its seat too."""
    client, tasks = api
    teacher, admin = make_user(credits=100), make_user(is_admin=True)
    c = _new_class(client, teacher, seats=1)
    pin = _start(client, teacher, c["id"])
    kid = Student()
    kid.join(pin)
    creation_id = kid.make().json()["hero"]["creation_id"]
    step = _current(db, creation_id)
    r = client.post(f"/api/creations/{creation_id}/steps/{step}/cancel", headers=_auth(admin))
    assert r.status_code == 200, r.text
    tasks.pending.pop().close()
    view = _roster(client, teacher, c["id"])
    assert view["roster"][0]["hero"]["state"] == "failed"
    assert view["seats_used"] == 1 and view["roster"][0]["seat_returned"] is False


def test_a_full_class_turns_new_students_away_before_the_board(db, make_user, api, steps_succeed):
    client, tasks = api
    teacher = make_user(credits=100)
    c = _new_class(client, teacher, seats=1)
    pin = _start(client, teacher, c["id"])
    maya = Student()
    maya.join(pin, "Maya")
    assert maya.make().status_code == 201
    tasks.run_all()

    late = Student()
    found = late.client.get(f"/api/class/join/{pin}").json()
    assert found["seats_left"] == 0 and found["joined"] is False      # told before the name
    r = late.join(pin, "Itai")
    assert r.status_code == 409 and r.json()["detail"] == "This class is full. Ask your teacher for a seat."
    view = _roster(client, teacher, c["id"])
    assert [s["label"] for s in view["roster"]] == ["Maya"]           # no ghost "Drawing…" card

    # A seat added: the same child gets in.
    client.post(f"/api/classes/{c['id']}/seats", json={"seats": 1}, headers=_auth(teacher))
    assert late.client.get(f"/api/class/join/{pin}").json()["seats_left"] == 1
    assert late.join(pin, "Itai").status_code == 200


def test_a_student_who_joined_before_the_seats_ran_out_needs_a_seat(db, make_user, api, steps_succeed):
    client, tasks = api
    teacher = make_user(credits=100)
    c = _new_class(client, teacher, seats=1)
    pin = _start(client, teacher, c["id"])
    maya, noa = Student(), Student()
    maya.join(pin, "Maya")
    noa.join(pin, "Noa")
    assert _roster(client, teacher, c["id"])["roster"][1]["needs_seat"] is False
    assert maya.make().status_code == 201
    r = noa.make()
    assert r.status_code == 409 and noa.me().json()["reason"] == "class_full"
    assert [s["needs_seat"] for s in _roster(client, teacher, c["id"])["roster"]] == [False, True]


def test_the_same_name_from_another_device_waits_for_the_teacher(db, make_user, api, steps_succeed):
    """Noam on his tablet, then "Noam" on a second phone: the same child, or a
    second Noam? Only the teacher knows. He waits, labelled Noam 2."""
    client, tasks = api
    teacher = make_user(credits=100)
    c = _new_class(client, teacher, seats=5)
    pin = _start(client, teacher, c["id"])
    first, second = Student(), Student()
    assert first.join(pin, "Noam").json()["guest"]["status"] == "approved"
    r = second.join(pin, "noam")
    assert r.json()["guest"]["status"] == "waiting" and r.json()["can_make"] is False
    assert second.make().status_code == 409
    board = _roster(client, teacher, c["id"])["roster"]
    assert [(s["label"], s["same_name"], s["status"]) for s in board] == [
        ("Noam", False, "approved"), ("noam 2", True, "waiting")]


def test_the_teacher_removes_any_student_from_the_board(db, make_user, api, steps_succeed):
    client, tasks = api
    teacher = make_user(credits=100)
    c = _new_class(client, teacher, seats=3)
    pin = _start(client, teacher, c["id"])
    noam, dup, ghost = Student(), Student(), Student()
    noam.join(pin, "Noam")
    assert noam.make().status_code == 201
    tasks.run_all()
    dup.join(pin, "Noam")
    ghost.join(pin, "Alexandra")
    board = _roster(client, teacher, c["id"])["roster"]
    assert len(board) == 3

    # An approved child still drawing, and a waiting duplicate: both off the board.
    for s in board[1:]:
        r = client.post(f"/api/classes/{c['id']}/students/{s['id']}/remove", headers=_auth(teacher))
        assert r.status_code == 200, r.text
    view = _roster(client, teacher, c["id"])
    assert [s["label"] for s in view["roster"]] == ["Noam"]
    assert view["seats_used"] == 1
    # A removed pass cannot make a hero; that browser joins again as someone new.
    assert ghost.make().status_code == 403
    assert ghost.client.get(f"/api/class/join/{pin}").json()["joined"] is False
    again = ghost.join(pin, "Alexandra")
    assert again.status_code == 200 and again.json()["pass"]
    # Another teacher cannot remove anyone; nor can a removed card be removed twice.
    other = make_user(credits=0)
    assert client.post(f"/api/classes/{c['id']}/students/{board[0]['id']}/remove",
                       headers=_auth(other)).status_code == 404
    assert client.post(f"/api/classes/{c['id']}/students/{board[1]['id']}/remove",
                       headers=_auth(teacher)).status_code == 404

    # A made hero's card can go too: off the board, its seat stays used.
    client.post(f"/api/classes/{c['id']}/students/{board[0]['id']}/remove", headers=_auth(teacher))
    view = _roster(client, teacher, c["id"])
    assert [s["label"] for s in view["roster"]] == ["Alexandra"]
    assert view["seats_used"] == 1 and view["heroes_ready"] == 0


def test_removing_a_student_whose_hero_failed_gives_the_seat_back(db, make_user, api, monkeypatch):
    client, tasks = api
    teacher = make_user(credits=100)
    c = _new_class(client, teacher, seats=1)
    pin = _start(client, teacher, c["id"])
    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda name: _meshy_down)
    kid = Student()
    kid.join(pin, "Shira")
    kid.make()
    tasks.run_all()
    sid = _roster(client, teacher, c["id"])["roster"][0]["id"]
    view = client.post(f"/api/classes/{c['id']}/students/{sid}/remove", headers=_auth(teacher)).json()
    assert view["roster"] == [] and view["seats_left"] == 1


def test_a_kept_hero_that_fails_later_is_the_parents_not_the_class(db, make_user, api, monkeypatch):
    """Once a parent keeps the hero, its runs are charged to them. One that
    fails in their account gives the class no seat, and refunds the parent
    only the step that failed."""
    client, tasks = api
    teacher, parent = make_user(credits=100), make_user(credits=30)
    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda name: _fine)
    c, maya, me = _ready_hero(client, tasks, teacher, make_user)
    token = me["claim_path"].rsplit("/", 1)[1]
    assert client.post(f"/api/class/claim/{token}", headers=_auth(parent)).status_code == 200
    creation_id = me["hero"]["creation_id"]

    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda name: _meshy_down)
    r = client.post(f"/api/creations/{creation_id}/run-pipeline?from_step=meshy_3d", headers=_auth(parent))
    assert r.status_code == 200, r.text
    tasks.run_all()
    assert db.query(Creation).filter_by(id=creation_id).one().status == "failed"
    view = _roster(client, teacher, c["id"])
    assert view["seats_used"] == 1 and view["roster"][0]["seat_returned"] is False
    assert _balance(db, parent.id) == 30                 # 3D charged, then refunded: no more
    assert ledger.verify_user_balance(parent.id, db).consistent


def test_no_hero_after_class_time_or_when_blocked(db, make_user, api):
    client, _ = api
    teacher = make_user(credits=100)
    c = _new_class(client, teacher, seats=5)
    pin = _start(client, teacher, c["id"])
    late, blocked = Student(), Student()
    late.join(pin, "Late")
    r = blocked.join(pin, "Bob")
    bob_id = r.json()["guest"]["id"]
    client.post(f"/api/classes/{c['id']}/students/{bob_id}/block", headers=_auth(teacher))
    assert blocked.make().status_code == 403

    client.post(f"/api/classes/{c['id']}/end", headers=_auth(teacher))
    r = late.make()
    assert r.status_code == 410 and r.json()["detail"] == "Class time is over"
    assert Student().join(pin, "Newbie").status_code == 404     # the PIN is dead
    assert db.query(Creation).count() == 0


def test_a_pass_from_last_session_works_in_the_next(db, make_user, api, steps_succeed):
    """Absent or too slow last week: same pass, next session, unused seat."""
    client, _ = api
    teacher = make_user(credits=100)
    c = _new_class(client, teacher, seats=5)
    pin = _start(client, teacher, c["id"])
    maya = Student()
    maya.join(pin)
    client.post(f"/api/classes/{c['id']}/end", headers=_auth(teacher))
    assert maya.make().status_code == 410
    _start(client, teacher, c["id"])
    assert maya.make().status_code == 201


def test_wrong_pins_are_throttled_per_browser(db, make_user, api):
    client, _ = api
    s = Student()
    s.client.get("/api/class/join/000000")     # gets this browser its marker... or a 404
    marker = s.client.cookies.get(classes.DEVICE_COOKIE)
    codes = [s.client.get("/api/class/join/999999", headers={classes.DEVICE_HEADER: marker or "m"}).status_code
             for _ in range(10)]
    assert codes[:7] == [404] * 7 and codes[-1] == 429


def test_names_are_first_names(db, make_user, api):
    client, _ = api
    teacher = make_user(credits=100)
    c = _new_class(client, teacher)
    pin = _start(client, teacher, c["id"])
    assert Student().join(pin, "maya@example.com").status_code == 400
    assert Student().join(pin, "").status_code == 400
    assert Student().join(pin, "Maya", 40).status_code == 400
    r = Student().join(pin, "  נועה  ", None)
    assert r.status_code == 200 and r.json()["guest"]["first_name"] == "נועה"


# ---------------------------------------------------------------------------
# Parents
# ---------------------------------------------------------------------------

def _ready_hero(client, tasks, teacher, make_user):
    c = _new_class(client, teacher, seats=3)
    pin = _start(client, teacher, c["id"])
    maya = Student()
    maya.join(pin, "Maya", 7)
    maya.make()
    tasks.run_all()
    return c, maya, maya.me().json()


def test_a_parent_keeps_the_hero_with_name_and_age(db, make_user, api, steps_succeed):
    client, tasks = api
    teacher = make_user(credits=100)
    c, maya, me = _ready_hero(client, tasks, teacher, make_user)
    token = me["claim_path"].rsplit("/", 1)[1]
    room = db.query(ClassRoom).filter_by(id=c["id"]).one()
    creation_id = me["hero"]["creation_id"]
    charged_before = db.query(CreditTransaction).filter_by(creation_id=creation_id).count()

    seen = client.get(f"/api/class/claim/{token}")
    assert seen.status_code == 200
    assert seen.json()["first_name"] == "Maya" and seen.json()["age"] == 7
    assert seen.json()["class_title"] == "Grade 2B" and seen.json()["claimed"] is False

    assert client.post(f"/api/class/claim/{token}").status_code == 401     # sign up first
    parent = make_user(credits=0)
    r = client.post(f"/api/class/claim/{token}", headers=_auth(parent))
    assert r.status_code == 200, r.text
    assert r.json()["claimed"] is True

    db.expire_all()
    creation = db.query(Creation).filter_by(id=creation_id).one()
    assert creation.user_id == parent.id and creation.class_id is None
    assert (creation.name, creation.age) == ("Maya", 7)
    storage = get_storage()
    assert storage.file_exists(parent.id, creation_id, "avatar.vrm")
    assert storage.file_exists(parent.id, creation_id, "original.jpg")
    assert not storage.file_exists(room.wallet_user_id, creation_id, "avatar.vrm")
    mine = client.get("/api/creations/?mine_only=true", headers=_auth(parent)).json()
    assert [x["id"] for x in mine] == [creation_id]
    assert mine[0]["name"] == "Maya" and mine[0]["age"] == 7
    # The class paid; its ledger rows stay its own.
    assert db.query(CreditTransaction).filter_by(creation_id=creation_id).count() == charged_before
    assert all(t.user_id == room.wallet_user_id
               for t in db.query(CreditTransaction).filter_by(creation_id=creation_id))
    # The teacher still sees it in the class gallery, as kept.
    roster = client.get(f"/api/classes/{c['id']}", headers=_auth(teacher)).json()["roster"]
    assert roster[0]["claimed"] is True and roster[0]["hero"]["user_id"] == parent.id

    # Twice by the same parent is fine; by someone else it is not.
    assert client.post(f"/api/class/claim/{token}", headers=_auth(parent)).status_code == 200
    assert client.post(f"/api/class/claim/{token}", headers=_auth(make_user())).status_code == 409


def test_the_claim_link_gives_the_live_hero_and_nothing_more(db, make_user, api, steps_succeed):
    """The parent's page shows the hero live (HeroLive): it needs to know which
    of the hero's files exist, and their versions. The token is the only
    credential, so the view holds this hero's public files and nothing else."""
    client, tasks = api
    teacher = make_user(credits=100)
    c, maya, me = _ready_hero(client, tasks, teacher, make_user)
    token = me["claim_path"].rsplit("/", 1)[1]

    seen = client.get(f"/api/class/claim/{token}").json()
    assert set(seen) == {"first_name", "age", "class_title", "hero", "claimed", "kept_by_you"}
    hero = seen["hero"]
    assert set(hero) == {"creation_id", "user_id", "character_name", "state", "step", "steps_done",
                         "steps_total", "file_versions", "painting"}
    assert hero["state"] == "ready" and seen["kept_by_you"] is False
    # Everything the live stage loads: the rigged avatar (served as
    # opt_avatar.vrm), the 3D sculpt (opt_model.glb), the painting, the drawing.
    assert {"avatar.vrm", "model.glb", "rendered.png", "original.jpg"} <= set(hero["file_versions"])
    for name in hero["file_versions"]:
        r = client.get(f"/api/files/{hero['user_id']}/{hero['creation_id']}/{name}")
        assert r.status_code == 200, name
    # No teacher, class id, roster or provider detail.
    text = client.get(f"/api/class/claim/{token}").text
    assert teacher.id not in text and teacher.email not in text and c["id"] not in text
    assert "task-1" not in text and "metadata" not in text

    # Kept: the same link knows its keeper, and only its keeper.
    parent = make_user(credits=0)
    kept = client.post(f"/api/class/claim/{token}", headers=_auth(parent)).json()
    assert kept["claimed"] is True and kept["kept_by_you"] is True
    assert kept["hero"]["user_id"] == parent.id and "avatar.vrm" in kept["hero"]["file_versions"]
    assert client.get(f"/api/class/claim/{token}", headers=_auth(parent)).json()["kept_by_you"] is True
    assert client.get(f"/api/class/claim/{token}", headers=_auth(make_user())).json()["kept_by_you"] is False
    assert client.get(f"/api/class/claim/{token}").json()["kept_by_you"] is False
    # A stale token never hides the hero from the page.
    stale = client.get(f"/api/class/claim/{token}", headers={"Authorization": "Bearer not-a-jwt"})
    assert stale.status_code == 200 and stale.json()["kept_by_you"] is False


def test_a_hero_being_made_lists_only_the_files_it_has(db, make_user, api, steps_succeed):
    client, tasks = api
    teacher = make_user(credits=100)
    c = _new_class(client, teacher)
    pin = _start(client, teacher, c["id"])
    maya = Student()
    maya.join(pin)
    maya.make()                        # pipeline not run yet
    token = maya.me().json()["claim_path"].rsplit("/", 1)[1]
    hero = client.get(f"/api/class/claim/{token}").json()["hero"]
    assert hero["state"] == "making"
    assert set(hero["file_versions"]) == {"original.jpg"}


def test_a_hero_still_being_made_cannot_be_claimed(db, make_user, api, steps_succeed):
    client, tasks = api
    teacher = make_user(credits=100)
    c = _new_class(client, teacher)
    pin = _start(client, teacher, c["id"])
    maya = Student()
    maya.join(pin)
    maya.make()                        # pipeline not run yet
    token = maya.me().json()["claim_path"].rsplit("/", 1)[1]
    r = client.post(f"/api/class/claim/{token}", headers=_auth(make_user()))
    assert r.status_code == 409
    assert client.get("/api/class/claim/not-a-token").status_code == 404


def test_stage_lists_the_finished_heroes(db, make_user, api, steps_succeed):
    client, tasks = api
    teacher = make_user(credits=100)
    c, _, me = _ready_hero(client, tasks, teacher, make_user)
    r = client.get(f"/api/classes/{c['id']}/stage", headers=_auth(teacher))
    hero = r.json()["heroes"][0]
    assert hero["name"] == "Maya" and hero["age"] == 7
    assert hero["vrmUrl"].endswith(f"/{me['hero']['creation_id']}/opt_avatar.vrm")


# ---------------------------------------------------------------------------
# The teacher opens a student's hero: the gallery's hero page, read-only
# ---------------------------------------------------------------------------
#
# The hero page reads a hero through GET /api/creations/{id}, its steps and
# /api/files/<owner>/<id>/<file>. Those reads take a hero's id and nothing else
# (every hero's page is a link that can be shared, and an <img> cannot carry a
# bearer token), so the class's teacher reaches a student's hero by the id their
# roster gives them. What keeps another teacher out is that only the class's
# own teacher is given the roster; and nobody but the hero's owner may change it.

def _roster_hero(client, teacher, class_id):
    roster = client.get(f"/api/classes/{class_id}", headers=_auth(teacher)).json()["roster"]
    assert len(roster) == 1
    return roster[0]["hero"]


def _reads_hero_page(client, user, hero, *, file="original.jpg", body=DRAWING):
    """Everything the hero page (tb/HeroScreen.tsx) loads, as `user`."""
    headers = _auth(user)
    page = client.get(f"/api/creations/{hero['creation_id']}", headers=headers)
    assert page.status_code == 200, page.text
    assert client.get(f"/api/creations/{hero['creation_id']}/steps/openai_render", headers=headers).status_code == 200
    f = client.get(f"/api/files/{hero['user_id']}/{hero['creation_id']}/{file}", headers=headers)
    assert f.status_code == 200 and f.content == body
    return page.json()


def _cannot_change_hero(client, user, creation_id):
    """Rename, delete, run, retry, star, download: all refused to `user`."""
    headers = _auth(user)
    assert client.patch(f"/api/creations/{creation_id}", json={"character_name": "Mine now"},
                        headers=headers).status_code == 403
    assert client.post(f"/api/creations/{creation_id}/steps/openai_render/run", headers=headers).status_code == 403
    assert client.post(f"/api/creations/{creation_id}/run-pipeline", headers=headers).status_code == 403
    assert client.put(f"/api/creations/{creation_id}/featured", json={"featured": True},
                      headers=headers).status_code == 403
    assert client.delete(f"/api/creations/{creation_id}", headers=headers).status_code == 403


def test_the_teacher_opens_a_students_hero_read_only(db, make_user, api, steps_succeed):
    client, tasks = api
    teacher, other_teacher = make_user(credits=100), make_user(credits=100)
    c = _new_class(client, teacher, seats=3)
    _new_class(client, other_teacher, seats=1, title="Grade 3A")
    maya = Student()
    maya.join(_start(client, teacher, c["id"]), "Maya", 7)
    maya.make()

    # While it is made: its steps, from the roster's id.
    hero = _roster_hero(client, teacher, c["id"])
    assert hero["state"] == "making"
    page = _reads_hero_page(client, teacher, hero)
    assert page["in_class"] is True and page["status"] != "completed"
    # The roster's versions are the hero page's: one cached thumbnail for both.
    assert hero["file_versions"] == page["file_versions"]
    assert "original.jpg" in hero["file_versions"]

    tasks.run_all()                                       # the real pipeline, to the end
    hero = _roster_hero(client, teacher, c["id"])
    assert hero["state"] == "ready"
    page = _reads_hero_page(client, teacher, hero, file="avatar.vrm", body=b"out:convert_vrm")
    assert page["status"] == "completed"
    assert hero["file_versions"] == page["file_versions"] and "rendered.png" in hero["file_versions"]

    # Read-only: the class pays for the hero, the teacher only looks.
    _cannot_change_hero(client, teacher, hero["creation_id"])
    # Another teacher is never given the roster, nor finds the hero in a list.
    assert client.get(f"/api/classes/{c['id']}", headers=_auth(other_teacher)).status_code == 404
    assert client.get(f"/api/classes/{c['id']}/stage", headers=_auth(other_teacher)).status_code == 404
    for listing in ("/api/creations/?mine_only=true", "/api/creations/", "/api/creations/?featured_only=true"):
        assert hero["creation_id"] not in {x["id"] for x in client.get(listing, headers=_auth(other_teacher)).json()}
    _cannot_change_hero(client, other_teacher, hero["creation_id"])

    db.expire_all()
    creation = db.query(Creation).filter_by(id=hero["creation_id"]).one()
    assert creation.character_name != "Mine now" and creation.deleted_at is None and not creation.featured


def test_the_teacher_still_opens_a_hero_a_parent_kept(db, make_user, api, steps_succeed):
    client, tasks = api
    teacher, other_teacher = make_user(credits=100), make_user(credits=100)
    c, maya, me = _ready_hero(client, tasks, teacher, make_user)
    parent = make_user()
    assert client.post(f"/api/class/claim/{me['claim_path'].rsplit('/', 1)[1]}",
                       headers=_auth(parent)).status_code == 200

    # The roster points at the parent's copy now, and the hero page reads it.
    hero = _roster_hero(client, teacher, c["id"])
    assert hero["user_id"] == parent.id and hero["state"] == "ready"
    page = _reads_hero_page(client, teacher, hero, file="avatar.vrm", body=b"out:convert_vrm")
    assert page["user_id"] == parent.id and page["in_class"] is False
    assert hero["file_versions"] == page["file_versions"]

    # Still read-only for the teacher; still nothing for another teacher.
    _cannot_change_hero(client, teacher, hero["creation_id"])
    assert client.get(f"/api/classes/{c['id']}", headers=_auth(other_teacher)).status_code == 404
    _cannot_change_hero(client, other_teacher, hero["creation_id"])
    # The parent owns it: they may rename it.
    r = client.patch(f"/api/creations/{hero['creation_id']}", json={"character_name": "Sky Dragon"},
                     headers=_auth(parent))
    assert r.status_code == 200 and r.json()["character_name"] == "Sky Dragon"


# ---------------------------------------------------------------------------
# Account deletion
# ---------------------------------------------------------------------------

def test_deleting_the_teacher_deletes_classes_but_not_claimed_heroes(db, make_user, api, steps_succeed):
    client, tasks = api
    teacher = make_user(credits=100)
    c = _new_class(client, teacher, seats=3)
    pin = _start(client, teacher, c["id"])
    kept, left = Student(), Student()
    kept.join(pin, "Maya")
    left.join(pin, "Noa")
    kept.make()
    left.make()
    tasks.run_all()
    token = kept.me().json()["claim_path"].rsplit("/", 1)[1]
    parent = make_user()
    client.post(f"/api/class/claim/{token}", headers=_auth(parent))
    kept_id = kept.me().json()["hero"]["creation_id"]
    left_id = left.me().json()["hero"]["creation_id"]
    wallet_id = db.query(ClassRoom).filter_by(id=c["id"]).one().wallet_user_id

    delete_account(db, db.query(User).filter_by(id=teacher.id).one())

    db.expire_all()
    assert db.query(ClassRoom).count() == 0
    assert db.query(ClassSession).count() == 0
    assert db.query(ClassGuest).count() == 0
    assert db.query(Creation).filter_by(id=left_id).first() is None
    assert not get_storage().file_exists(wallet_id, left_id, "avatar.vrm")
    assert db.query(User).filter_by(id=wallet_id).one().deleted_at is not None
    kept_hero = db.query(Creation).filter_by(id=kept_id).one()
    assert kept_hero.user_id == parent.id and kept_hero.deleted_at is None
    assert get_storage().file_exists(parent.id, kept_id, "avatar.vrm")


def test_deleting_a_parent_lets_go_of_the_claimed_hero(db, make_user, api, steps_succeed):
    client, tasks = api
    teacher = make_user(credits=100)
    c, maya, me = _ready_hero(client, tasks, teacher, make_user)
    parent = make_user()
    client.post(f"/api/class/claim/{me['claim_path'].rsplit('/', 1)[1]}", headers=_auth(parent))
    delete_account(db, db.query(User).filter_by(id=parent.id).one())
    db.expire_all()
    assert db.query(ClassGuest).one().creation_id is None
    roster = client.get(f"/api/classes/{c['id']}", headers=_auth(teacher)).json()["roster"]
    assert roster[0]["hero"] is None


# ---------------------------------------------------------------------------
# Teachers, the demo library, the migration
# ---------------------------------------------------------------------------

def test_anyone_can_say_they_are_a_teacher(db, make_user, api):
    client, _ = api
    r = client.post("/api/auth/signup", json={
        "username": "msLevi", "email": "levi@school.test", "password": "secret1",
        "name": "Dana Levi", "date_of_birth": "1985-03-01", "is_teacher": True})
    assert r.status_code == 201, r.text
    assert r.json()["user"]["is_teacher"] is True
    user = make_user()
    r = client.patch("/api/auth/me", json={"is_teacher": True}, headers=_auth(user))
    assert r.status_code == 200 and r.json()["is_teacher"] is True
    assert client.get("/api/auth/me", headers=_auth(user)).json()["is_teacher"] is True


def test_demo_library_matches_only_the_identical_drawing(db, make_user, make_creation, monkeypatch):
    owner = make_user()
    lib = make_creation(owner.id)
    get_storage().upload_file(owner.id, lib.id, "original.jpg", DRAWING)
    assert demo_library.match(db, DRAWING) is None                    # off by default
    monkeypatch.setenv(demo_library.ENV_LIBRARY, lib.id)
    assert demo_library.match(db, DRAWING).id == lib.id
    assert demo_library.match(db, DRAWING + b"!") is None             # a different drawing: real providers
    monkeypatch.setenv("RAILWAY_ENVIRONMENT_NAME", "production")
    assert demo_library.match(db, DRAWING) is None                    # never in production


def test_migration_adds_the_columns_to_an_existing_database(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path}/old.db")
    s = sessionmaker(bind=engine)()
    s.execute(text("CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, credits INTEGER)"))
    s.execute(text("CREATE TABLE creations (id TEXT PRIMARY KEY, user_id TEXT)"))
    s.execute(text("INSERT INTO users (id, username, credits) VALUES ('u1', 'old', 5)"))
    s.commit()
    m015_classes.migrate(s)
    m015_classes.migrate(s)       # idempotent
    cols = {c["name"] for c in inspect(engine).get_columns("users")}
    assert {"is_teacher", "kind"} <= cols
    assert "class_id" in {c["name"] for c in inspect(engine).get_columns("creations")}
    assert {"classes", "class_sessions", "class_guests"} <= set(inspect(engine).get_table_names())
    assert s.execute(text("SELECT kind, is_teacher FROM users")).one() == ("person", 0)
    assert "seat_returned_at" not in {c["name"] for c in inspect(engine).get_columns("class_guests")}
    m019_class_seat_returns.migrate(s)
    m019_class_seat_returns.migrate(s)   # idempotent
    assert "seat_returned_at" in {c["name"] for c in inspect(engine).get_columns("class_guests")}


# ---------------------------------------------------------------------------
# The real task manager
# ---------------------------------------------------------------------------

@pytest.fixture
def live_client():
    """The app as it runs: its lifespan's own TaskManager (no stand-in), and
    one event loop that outlives each request, so a task an endpoint starts
    really runs in the background. Every other test here swaps the task manager
    for `_Tasks`, which takes a coroutine from any thread - which is how a retry
    that could not start its task at all went unnoticed: a sync endpoint runs
    in a worker thread, and `asyncio.create_task` there has no loop."""
    before = app.dependency_overrides.pop(get_task_manager, None)
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            yield client
    finally:
        if before is not None:
            app.dependency_overrides[get_task_manager] = before


def _settled(db, creation_id, timeout=10.0):
    """Wait until the background run has nothing processing and no task."""
    import time
    from app.models import CreationStep
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        db.expire_all()
        busy = db.query(CreationStep).filter(
            CreationStep.creation_id == creation_id,
            CreationStep.status == "processing",
        ).count()
        if not busy and not get_task_manager().running_for_creation(creation_id):
            return db.query(Creation).filter_by(id=creation_id).one()
        time.sleep(0.05)
    raise AssertionError(f"hero {creation_id} still processing after {timeout}s")


def test_a_retry_runs_on_the_real_task_manager(db, make_user, live_client, monkeypatch):
    """Make, fail, retry, finish: over HTTP, with the lifespan's TaskManager.
    Only the provider calls are stubbed."""
    client = live_client
    teacher = make_user(credits=100)
    c = _new_class(client, teacher, seats=2)
    pin = _start(client, teacher, c["id"])
    wallet = db.query(ClassRoom).filter_by(id=c["id"]).one().wallet_user_id

    async def meshy_down(creation_id, user_id, s):
        if _current(s, creation_id) == "meshy_3d":
            raise RuntimeError("NoMorePendingTasks")
        _deliver(s, creation_id, user_id)

    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda name: meshy_down)
    # This client is the student's browser too: one loop for every request.
    r = client.post("/api/class/join", json={"pin": pin, "first_name": "Maya", "age": 7})
    assert r.status_code == 200, r.text
    r = client.post("/api/class/me/hero", files={"image_file": ("d.jpg", DRAWING, "image/jpeg")})
    assert r.status_code == 201, r.text
    creation_id = r.json()["hero"]["creation_id"]
    assert _settled(db, creation_id).status == "failed"
    # The run gives the seat back as it ends, with every credit it charged.
    assert db.query(ClassRoom).filter_by(id=c["id"]).one().seats_used == 0
    assert _balance(db, wallet) == 2 * HERO

    monkeypatch.setattr(pipeline, "get_step_coroutine", lambda name: _fine)
    r = client.post("/api/class/me/hero/retry")
    assert r.status_code == 200, r.text
    assert r.json()["hero"]["state"] != "failed"           # shown running at once
    assert _settled(db, creation_id).status == "completed"
    assert client.get("/api/class/me").json()["hero"]["state"] == "ready"
    assert db.query(ClassRoom).filter_by(id=c["id"]).one().seats_used == 1
    assert _balance(db, wallet) == 2 * HERO - (HERO - get_step_by_name("openai_render")["credit_cost"])
    assert ledger.verify_user_balance(wallet, db).consistent
