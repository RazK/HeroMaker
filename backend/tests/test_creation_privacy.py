"""What a hero's API tells whom.

Sign-in is a username and a password, so a hero's response never carries its
owner's login name to anyone but that owner and an admin. The public gallery
names the artist the way the polaroid does (the drawing's name, else the
owner's display name). The owner's id stays: it is the files' path
(/api/files/<user_id>/<creation_id>/...), an opaque UUID nobody signs in with.

Also: the owner, and only the owner (or an admin), sets who drew the hero,
through the real PATCH endpoint.

The API's hero object (app/services/api_heroes.py::view): the login name is
`owner.username`, absent for anyone else; who drew it is `artist`; the files'
owner id is `owner_id`.
"""
from fastapi.testclient import TestClient

from app.main import app
from app.services.auth import create_access_token


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _gallery(client, view, headers=None):
    r = client.get(f"/api/v1/gallery?view={view}", headers=headers or {})
    assert r.status_code == 200, r.text
    return r.json()["data"]


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
        r = client.get("/api/v1/gallery?view=featured", headers=headers)
        assert r.status_code == 200, r.text
        assert "itai_login" not in r.text
        row = next(c for c in r.json()["data"] if c["id"] == hero.id)
        assert "owner" not in row
        # The name the gallery shows: no artist set, so the display name.
        assert row["artist"]["name"] == "Itai"
        # The file path stays, and the files load from it.
        assert row["owner_id"] == owner.id
        assert f"/api/files/{owner.id}/{hero.id}/" in row["files"]["drawing"]

        page = client.get(f"/api/v1/heroes/{hero.id}", headers=headers)
        assert page.status_code == 200 and "itai_login" not in page.text


def test_an_unnamed_owner_is_not_named_by_their_login(db, make_user, make_creation, completed_steps):
    owner, hero = _starred(db, make_user, make_creation, completed_steps)
    owner.name = None
    db.commit()
    r = TestClient(app).get("/api/v1/gallery?view=featured")
    assert "itai_login" not in r.text
    assert next(c for c in r.json()["data"] if c["id"] == hero.id)["artist"]["name"] is None


def test_the_owner_and_an_admin_still_see_the_login_name(db, make_user, make_creation, completed_steps):
    owner, hero = _starred(db, make_user, make_creation, completed_steps)
    admin = make_user(username="boss", is_admin=True)
    client = TestClient(app)

    mine = _gallery(client, "mine", _auth(owner))
    assert [c["owner"]["username"] for c in mine] == ["itai_login"]
    assert client.get(f"/api/v1/heroes/{hero.id}", headers=_auth(owner)).json()["owner"]["username"] == "itai_login"

    seen = client.get(f"/api/v1/heroes/{hero.id}", headers=_auth(admin)).json()
    assert seen["owner"] == {"username": "itai_login", "name": "Itai"}
    listed = next(c for c in _gallery(client, "all", _auth(admin)) if c["id"] == hero.id)
    assert listed["owner"]["username"] == "itai_login"


def test_a_stale_token_still_sees_the_hero_without_the_login(db, make_user, make_creation, completed_steps):
    _, hero = _starred(db, make_user, make_creation, completed_steps)
    r = TestClient(app).get(f"/api/v1/heroes/{hero.id}", headers={"Authorization": "Bearer not-a-jwt"})
    assert r.status_code == 200 and "owner" not in r.json()


# ---------------------------------------------------------------------------
# Who drew it
# ---------------------------------------------------------------------------

def test_the_owner_says_who_drew_it(db, make_user, make_creation, completed_steps):
    owner, hero = _starred(db, make_user, make_creation, completed_steps)
    client = TestClient(app)

    r = client.patch(f"/api/v1/heroes/{hero.id}", json={"artist_name": "  Lia  ", "artist_age": 6},
                     headers=_auth(owner))
    assert r.status_code == 200, r.text
    assert r.json()["artist"] == {"name": "Lia", "age": 6}
    # The gallery's polaroid now credits Lia, to everyone.
    row = next(c for c in _gallery(client, "featured") if c["id"] == hero.id)
    assert row["artist"] == {"name": "Lia", "age": 6}

    # Cleared, the drawing reads as the owner's display name again.
    r = client.patch(f"/api/v1/heroes/{hero.id}", json={"artist_name": "", "artist_age": None}, headers=_auth(owner))
    assert r.status_code == 200 and r.json()["artist"] == {"name": "Itai", "age": None}


def test_nobody_else_can_say_who_drew_it(db, make_user, make_creation, completed_steps):
    _, hero = _starred(db, make_user, make_creation, completed_steps)
    client = TestClient(app)
    assert client.patch(f"/api/v1/heroes/{hero.id}", json={"artist_name": "Mallory"}).status_code == 401
    stranger = make_user(username="mallory")
    # Someone else's hero is not there for them (404: its id does not leak).
    assert client.patch(f"/api/v1/heroes/{hero.id}", json={"artist_name": "Mallory"},
                        headers=_auth(stranger)).status_code == 404
    db.refresh(hero)
    assert hero.name is None
    admin = make_user(username="support", is_admin=True)
    assert client.patch(f"/api/v1/heroes/{hero.id}", json={"artist_name": "Lia"},
                        headers=_auth(admin)).status_code == 200
    db.refresh(hero)
    assert hero.name == "Lia"


def test_who_drew_it_is_bounded(db, make_user, make_creation, completed_steps):
    owner, hero = _starred(db, make_user, make_creation, completed_steps)
    client = TestClient(app)
    for body in ({"artist_name": "x" * 41}, {"artist_age": 0}, {"artist_age": 121}, {"artist_age": -3}):
        assert client.patch(f"/api/v1/heroes/{hero.id}", json=body, headers=_auth(owner)).status_code == 422, body
    assert client.patch(f"/api/v1/heroes/{hero.id}", json={"artist_name": "x" * 40, "artist_age": 120},
                        headers=_auth(owner)).status_code == 200
