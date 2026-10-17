"""Editors' choice: the gallery's default view, curated by admins.

Drives the real endpoints: GET /api/creations/?featured_only=true lists the
starred, finished, not-deleted heroes to anyone; PUT /api/creations/{id}/featured
stars or unstars one, and only an admin may. Also runs the real migration
against a pre-feature schema, since "star all by default" lives there.
"""
from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app.config.steps import get_all_step_names
from app.main import app
from app.migrations import m013_creation_featured
from app.models import Creation
from app.services.auth import create_access_token


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _ids(response):
    assert response.status_code == 200, response.text
    return [c["id"] for c in response.json()]


def _star(db, *creations):
    for c in creations:
        c.featured = True
    db.commit()


# ---------------------------------------------------------------------------
# The listing
# ---------------------------------------------------------------------------

def test_editors_choice_lists_only_starred_finished_live_heroes(db, make_user, make_creation, completed_steps):
    owner = make_user()
    starred = make_creation(owner.id, completed_steps)
    unstarred = make_creation(owner.id, completed_steps)
    making = make_creation(owner.id, {"image_processing": "completed", "openai_render": "processing"})
    failed = make_creation(owner.id, {"image_processing": "failed"})
    deleted = make_creation(owner.id, completed_steps)
    _star(db, starred, making, failed, deleted)
    deleted.deleted_at = datetime.utcnow()
    db.commit()

    admin = make_user(username="editor", is_admin=True)

    client = TestClient(app)
    # Signed out: Editors' choice is the front page for visitors too.
    assert _ids(client.get("/api/creations/?featured_only=true")) == [starred.id]
    # Even for an admin, Editors' choice is only the starred, finished heroes.
    assert _ids(client.get("/api/creations/?featured_only=true", headers=_auth(admin))) == [starred.id]
    assert unstarred.id in _ids(client.get("/api/creations/", headers=_auth(admin)))


def test_all_heroes_is_an_admin_view(db, make_user, make_creation, completed_steps):
    """Anyone but an admin asking for every hero gets Editors' choice: an
    unstarred hero is never listed to a visitor or another user."""
    owner = make_user()
    stranger = make_user()
    admin = make_user(username="editor", is_admin=True)
    starred = make_creation(owner.id, completed_steps)
    unstarred = make_creation(owner.id, completed_steps)
    making = make_creation(owner.id, {"image_processing": "processing"})
    _star(db, starred)

    client = TestClient(app)
    for headers in ({}, _auth(stranger), _auth(owner)):
        assert _ids(client.get("/api/creations/", headers=headers)) == [starred.id]
    assert set(_ids(client.get("/api/creations/", headers=_auth(admin)))) == {starred.id, unstarred.id, making.id}

    # The owner still sees their own heroes, starred or not, under My heroes...
    mine = _ids(client.get("/api/creations/?mine_only=true", headers=_auth(owner)))
    assert set(mine) == {starred.id, unstarred.id, making.id}
    # ...signed out, mine_only means nothing and lists Editors' choice.
    assert _ids(client.get("/api/creations/?mine_only=true")) == [starred.id]
    # And a hero's own page still opens by direct link, so sharing works.
    assert client.get(f"/api/creations/{unstarred.id}").status_code == 200


def test_editors_choice_keeps_the_all_views_order(db, make_user, make_creation, completed_steps):
    owner = make_user()
    admin = make_user(username="editor", is_admin=True)
    heroes = [make_creation(owner.id, completed_steps) for _ in range(3)]
    base = datetime(2026, 1, 1)
    for i, h in enumerate(heroes):
        h.updated_at = base + timedelta(days=i)
        h.featured = True
    db.commit()

    client = TestClient(app)
    newest_first = [h.id for h in reversed(heroes)]
    assert _ids(client.get("/api/creations/?featured_only=true")) == newest_first
    assert _ids(client.get("/api/creations/", headers=_auth(admin))) == newest_first


def test_responses_carry_featured(db, make_user, make_creation, completed_steps):
    owner = make_user()
    hero = make_creation(owner.id, completed_steps)
    client = TestClient(app)
    assert client.get(f"/api/creations/{hero.id}").json()["featured"] is False
    _star(db, hero)
    assert client.get(f"/api/creations/{hero.id}").json()["featured"] is True
    assert client.get("/api/creations/?featured_only=true").json()[0]["featured"] is True


def test_a_new_hero_is_not_starred(db, make_user, make_creation):
    owner = make_user()
    hero = make_creation(owner.id)
    db.refresh(hero)
    assert hero.featured is False


# ---------------------------------------------------------------------------
# Starring
# ---------------------------------------------------------------------------

def test_admin_stars_and_unstars(db, make_user, make_creation, completed_steps):
    admin = make_user(username="editor", is_admin=True)
    hero = make_creation(make_user().id, completed_steps)
    client = TestClient(app)

    r = client.put(f"/api/creations/{hero.id}/featured", json={"featured": True}, headers=_auth(admin))
    assert r.status_code == 200, r.text
    assert r.json()["featured"] is True
    assert _ids(client.get("/api/creations/?featured_only=true")) == [hero.id]

    r = client.put(f"/api/creations/{hero.id}/featured", json={"featured": False}, headers=_auth(admin))
    assert r.status_code == 200, r.text
    assert r.json()["featured"] is False
    assert _ids(client.get("/api/creations/?featured_only=true")) == []


def test_starring_does_not_move_the_hero_to_the_top(db, make_user, make_creation, completed_steps):
    admin = make_user(username="editor", is_admin=True)
    hero = make_creation(make_user().id, completed_steps)
    when = datetime(2025, 5, 5, 12, 0, 0)
    hero.updated_at = when
    db.commit()

    r = TestClient(app).put(f"/api/creations/{hero.id}/featured", json={"featured": True}, headers=_auth(admin))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(Creation, hero.id).updated_at == when


def test_owner_who_is_not_admin_cannot_star(db, make_user, make_creation, completed_steps):
    owner = make_user()
    hero = make_creation(owner.id, completed_steps)
    r = TestClient(app).put(f"/api/creations/{hero.id}/featured", json={"featured": True}, headers=_auth(owner))
    assert r.status_code == 403
    db.expire_all()
    assert db.get(Creation, hero.id).featured is False


def test_signed_out_cannot_star(db, make_user, make_creation, completed_steps):
    hero = make_creation(make_user().id, completed_steps)
    r = TestClient(app).put(f"/api/creations/{hero.id}/featured", json={"featured": True})
    assert r.status_code in (401, 403)
    db.expire_all()
    assert db.get(Creation, hero.id).featured is False


def test_missing_or_deleted_hero_is_404(db, make_user, make_creation, completed_steps):
    admin = make_user(username="editor", is_admin=True)
    gone = make_creation(admin.id, completed_steps)
    gone.deleted_at = datetime.utcnow()
    db.commit()
    client = TestClient(app)
    for cid in ("no-such-hero", gone.id):
        r = client.put(f"/api/creations/{cid}/featured", json={"featured": True}, headers=_auth(admin))
        assert r.status_code == 404, cid
    db.expire_all()
    assert db.get(Creation, gone.id).featured is False


# ---------------------------------------------------------------------------
# The migration: "star all by default"
# ---------------------------------------------------------------------------

def _old_database(tmp_path):
    """The schema as it stood before featured existed, with one of each kind of hero."""
    engine = create_engine(f"sqlite:///{tmp_path}/old.db")
    every_step = get_all_step_names()
    heroes = {
        "finished": {s: "completed" for s in every_step},
        "deleted": {s: "completed" for s in every_step},
        "failed": {every_step[0]: "completed", every_step[1]: "failed"},
        "making": {every_step[0]: "completed", every_step[1]: "processing"},
        "not-started": {},
    }
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE creations (id VARCHAR PRIMARY KEY, user_id VARCHAR, deleted_at TIMESTAMP)"))
        conn.execute(text("CREATE TABLE creation_steps (id VARCHAR PRIMARY KEY, creation_id VARCHAR, step_name VARCHAR, status VARCHAR)"))
        for hid, steps in heroes.items():
            conn.execute(text("INSERT INTO creations (id, user_id, deleted_at) VALUES (:id, 'u', :d)"),
                         {"id": hid, "d": datetime.utcnow() if hid == "deleted" else None})
            for name, status in steps.items():
                conn.execute(text("INSERT INTO creation_steps VALUES (:id, :c, :n, :s)"),
                             {"id": f"{hid}-{name}", "c": hid, "n": name, "s": status})
    return engine


def _starred(session):
    return {r[0] for r in session.execute(text("SELECT id FROM creations WHERE featured")).all()}


def test_migration_stars_every_finished_live_hero_once(tmp_path):
    engine = _old_database(tmp_path)
    session = sessionmaker(bind=engine)()
    try:
        m013_creation_featured.migrate(session)
        assert "featured" in {c["name"] for c in inspect(engine).get_columns("creations")}
        assert _starred(session) == {"finished"}

        # An admin unstars it; running the migration again must not undo that.
        session.execute(text("UPDATE creations SET featured = :no WHERE id = 'finished'"), {"no": False})
        session.commit()
        m013_creation_featured.migrate(session)
        assert _starred(session) == set()

        # New rows default to unstarred at the database level too.
        session.execute(text("INSERT INTO creations (id, user_id) VALUES ('new', 'u')"))
        session.commit()
        assert session.execute(text("SELECT featured FROM creations WHERE id='new'")).scalar() in (0, False)
    finally:
        session.close()
        engine.dispose()


def test_migration_is_registered_after_the_others():
    from app.migrations.registry import MIGRATIONS
    # Later migrations may follow it; it must come after everything before it.
    names = [name for name, _ in MIGRATIONS]
    i = names.index("013_creation_featured")
    assert MIGRATIONS[i] == ("013_creation_featured", m013_creation_featured.migrate)
    assert names[:i] == sorted(names[:i]) and all(n < "013" for n in names[:i])
