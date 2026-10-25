"""
A teacher's school, asked once before the first class, and a class's ages;
and the admin console's Schools list. Through the real endpoints.
"""
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

import pytest

from app.database import SessionLocal
from app.main import app
from app.migrations import m016_school_details
from app.config.steps import get_all_step_names
from app.models import ClassGuest, ClassRoom, ClassSession, Creation, CreationStep, User
from app.services import classes
from app.services.account_deletion import delete_account
from app.services.auth import create_access_token


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
    yield
    wipe()


@pytest.fixture
def client():
    return TestClient(app)


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def test_no_school_yet_then_name_and_type_are_enough(db, make_user, client):
    teacher = make_user()
    assert client.get("/api/v1/classes", headers=_auth(teacher)).json()["school"] is None

    r = client.put("/api/v1/classes/school", json={"name": "  Ha'Shalom   Kindergarten ", "type": "kindergarten"},
                   headers=_auth(teacher))
    assert r.status_code == 200, r.text
    assert r.json()["school"] == {"name": "Ha'Shalom Kindergarten", "city": None, "country": None,
                                  "type": "kindergarten"}
    assert client.get("/api/v1/classes/school", headers=_auth(teacher)).json()["school"]["name"] == "Ha'Shalom Kindergarten"
    db.expire_all()
    assert db.get(User, teacher.id).is_teacher is True


def test_city_and_country_are_kept_and_editable(db, make_user, client):
    teacher = make_user()
    client.put("/api/v1/classes/school", json={"name": "Oak", "type": "primary", "city": "Haifa", "country": "Israel"},
               headers=_auth(teacher))
    r = client.put("/api/v1/classes/school", json={"name": "Oak Primary", "type": "primary", "city": "", "country": "Israel"},
                   headers=_auth(teacher))
    assert r.json()["school"] == {"name": "Oak Primary", "city": None, "country": "Israel", "type": "primary"}


@pytest.mark.parametrize("body", [{"type": "primary"}, {"name": "  ", "type": "primary"},
                                  {"name": "Oak"}, {"name": "Oak", "type": "university"}])
def test_name_and_type_are_required(make_user, client, body):
    assert client.put("/api/v1/classes/school", json=body, headers=_auth(make_user())).status_code == 400


def test_a_class_keeps_its_ages(db, make_user, client):
    teacher = make_user(credits=100)
    r = client.post("/api/v1/classes", json={"title": "Grade 2B", "seats": 2, "ages": "7-8"}, headers=_auth(teacher))
    assert r.status_code == 201 and r.json()["ages"] == "7-8"
    r = client.post("/api/v1/classes", json={"title": "Art club", "seats": 1}, headers=_auth(teacher))
    assert r.status_code == 201 and r.json()["ages"] is None
    bad = client.post("/api/v1/classes", json={"title": "X", "seats": 1, "ages": "40-50"}, headers=_auth(teacher))
    assert bad.status_code == 400
    assert db.query(ClassRoom).count() == 2


def test_admin_schools_list(db, make_user, client):
    admin = make_user(is_admin=True)
    busy, quiet, parent = make_user(credits=100), make_user(), make_user()
    client.put("/api/v1/classes/school", json={"name": "Oak", "type": "primary", "city": "Haifa", "country": "Israel"},
               headers=_auth(busy))
    client.put("/api/v1/classes/school", json={"name": "Art Barn", "type": "after_school"}, headers=_auth(quiet))
    room = classes.create_class(db, db.get(User, busy.id), "Grade 2B", 3, "7-8")
    classes.create_class(db, db.get(User, busy.id), "Grade 3A", 2)
    # Two heroes made in Grade 2B: one finished, one failed.
    session = ClassSession(class_id=room.id, pin="123456", ends_at=room.created_at, status="ended")
    db.add(session)
    db.commit()
    for i, status in enumerate(("completed", "failed")):
        c = Creation(user_id=room.wallet_user_id, class_id=room.id)
        db.add(c)
        db.commit()
        for step in get_all_step_names():
            db.add(CreationStep(creation_id=c.id, step_name=step, status=status))
        db.add(ClassGuest(class_id=room.id, session_id=session.id, first_name="Kid", token_hash=f"h{i}" * 8,
                          creation_id=c.id))
        db.commit()

    assert client.get("/api/v1/admin/schools", headers=_auth(busy)).status_code == 403
    rows = client.get("/api/v1/admin/schools", headers=_auth(admin)).json()["teachers"]
    assert [r["user_id"] for r in rows] == [busy.id, quiet.id]          # busiest first, no parents
    top = rows[0]
    assert top["school"] == {"name": "Oak", "city": "Haifa", "country": "Israel", "type": "primary"}
    assert (top["classes"], top["seats_bought"], top["heroes_made"]) == (2, 5, 1)
    assert (rows[1]["classes"], rows[1]["seats_bought"], rows[1]["heroes_made"]) == (0, 0, 0)
    assert parent.id not in {r["user_id"] for r in rows}


def test_deleting_the_account_forgets_the_school(db, make_user, client):
    teacher = make_user()
    client.put("/api/v1/classes/school", json={"name": "Oak", "type": "primary", "city": "Haifa"}, headers=_auth(teacher))
    delete_account(db, db.get(User, teacher.id))
    db.expire_all()
    u = db.get(User, teacher.id)
    assert (u.school_name, u.school_city, u.school_country, u.school_type) == (None, None, None, None)


def test_migration_adds_the_columns_to_an_existing_database(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path}/old.db")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT)"))
        conn.execute(text("CREATE TABLE classes (id TEXT PRIMARY KEY, title TEXT)"))
    db = sessionmaker(bind=engine)()
    try:
        m016_school_details.migrate(db)
        m016_school_details.migrate(db)     # idempotent
        cols = {c["name"] for c in inspect(engine).get_columns("users")}
        assert {"school_name", "school_city", "school_country", "school_type"} <= cols
        assert "ages" in {c["name"] for c in inspect(engine).get_columns("classes")}
    finally:
        db.close()
