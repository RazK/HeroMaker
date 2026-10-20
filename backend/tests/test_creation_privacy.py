"""What a hero's API tells whom.

Sign-in is a username and a password, so a hero's response never carries its
owner's login name to anyone but that owner and an admin. The public gallery
names the artist the way the polaroid does (the drawing's name, else the
owner's display name). The owner's id stays: it is the files' path
(/api/files/<user_id>/<creation_id>/...), an opaque UUID nobody signs in with.

Also: the owner, and only the owner (or an admin), sets who drew the hero,
through the real PATCH endpoint.
"""
from fastapi.testclient import TestClient

from app.main import app
from app.services.auth import create_access_token


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _starred(db, make_user, make_creation, completed_steps, *, name=None):
    owner = make_user(username="itai_login")
    owner.name = "Itai"
    hero = make_creation(owner.id, completed_steps)
    hero.featured = True
    hero.name = name
    db.commit()
    return owner, hero


def test_the_public_gallery_never_gives_out_a_login_name(db, make_user, make_creation, completed_steps):
    owner, hero = _starred(db, make_user, make_creation, completed_steps)
    client = TestClient(app)

    for headers in ({}, _auth(make_user(username="stranger"))):
        r = client.get("/api/creations/?featured_only=true", headers=headers)
        assert r.status_code == 200, r.text
        assert "itai_login" not in r.text
        row = next(c for c in r.json() if c["id"] == hero.id)
        assert row["username"] is None and row["owner_name"] is None
        # The name the gallery shows: no artist set, so the display name.
        assert row["name"] == "Itai"
        # The file path stays, and the files load from it.
        assert row["user_id"] == owner.id

        page = client.get(f"/api/creations/{hero.id}", headers=headers)
        assert page.status_code == 200 and "itai_login" not in page.text


def test_an_unnamed_owner_is_not_named_by_their_login(db, make_user, make_creation, completed_steps):
    owner, hero = _starred(db, make_user, make_creation, completed_steps)
    owner.name = None
    db.commit()
    r = TestClient(app).get("/api/creations/?featured_only=true")
    assert "itai_login" not in r.text
    assert next(c for c in r.json() if c["id"] == hero.id)["name"] is None


def test_the_owner_and_an_admin_still_see_the_login_name(db, make_user, make_creation, completed_steps):
    owner, hero = _starred(db, make_user, make_creation, completed_steps)
    admin = make_user(username="boss", is_admin=True)
    client = TestClient(app)

    mine = client.get("/api/creations/?mine_only=true", headers=_auth(owner)).json()
    assert [c["username"] for c in mine] == ["itai_login"]
    assert client.get(f"/api/creations/{hero.id}", headers=_auth(owner)).json()["username"] == "itai_login"

    seen = client.get(f"/api/creations/{hero.id}", headers=_auth(admin)).json()
    assert seen["username"] == "itai_login" and seen["owner_name"] == "Itai"
    listed = next(c for c in client.get("/api/creations/", headers=_auth(admin)).json() if c["id"] == hero.id)
    assert listed["username"] == "itai_login"


def test_a_stale_token_still_sees_the_hero_without_the_login(db, make_user, make_creation, completed_steps):
    _, hero = _starred(db, make_user, make_creation, completed_steps)
    r = TestClient(app).get(f"/api/creations/{hero.id}", headers={"Authorization": "Bearer not-a-jwt"})
    assert r.status_code == 200 and r.json()["username"] is None


# ---------------------------------------------------------------------------
# Who drew it
# ---------------------------------------------------------------------------

def test_the_owner_says_who_drew_it(db, make_user, make_creation, completed_steps):
    owner, hero = _starred(db, make_user, make_creation, completed_steps)
    client = TestClient(app)

    r = client.patch(f"/api/creations/{hero.id}", json={"name": "  Lia  ", "age": 6}, headers=_auth(owner))
    assert r.status_code == 200, r.text
    assert (r.json()["name"], r.json()["age"]) == ("Lia", 6)
    # The gallery's polaroid now credits Lia, to everyone.
    row = next(c for c in client.get("/api/creations/?featured_only=true").json() if c["id"] == hero.id)
    assert (row["name"], row["age"]) == ("Lia", 6)

    # Cleared, the drawing reads as the owner's display name again.
    r = client.patch(f"/api/creations/{hero.id}", json={"name": "", "age": None}, headers=_auth(owner))
    assert r.status_code == 200 and (r.json()["name"], r.json()["age"]) == ("Itai", None)


def test_nobody_else_can_say_who_drew_it(db, make_user, make_creation, completed_steps):
    _, hero = _starred(db, make_user, make_creation, completed_steps)
    client = TestClient(app)
    assert client.patch(f"/api/creations/{hero.id}", json={"name": "Mallory"}).status_code in (401, 403)
    stranger = make_user(username="mallory")
    assert client.patch(f"/api/creations/{hero.id}", json={"name": "Mallory"}, headers=_auth(stranger)).status_code == 403
    admin = make_user(username="support", is_admin=True)
    assert client.patch(f"/api/creations/{hero.id}", json={"name": "Lia"}, headers=_auth(admin)).status_code == 200


def test_who_drew_it_is_bounded(db, make_user, make_creation, completed_steps):
    owner, hero = _starred(db, make_user, make_creation, completed_steps)
    client = TestClient(app)
    for body in ({"name": "x" * 41}, {"age": 0}, {"age": 121}, {"age": -3}):
        assert client.patch(f"/api/creations/{hero.id}", json=body, headers=_auth(owner)).status_code == 422, body
    assert client.patch(f"/api/creations/{hero.id}", json={"name": "x" * 40, "age": 120},
                        headers=_auth(owner)).status_code == 200
