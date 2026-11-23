"""A shared hero's link card: what WhatsApp and the like show for its link.

The card names the hero and shows its painting, and never says who drew it:
the artist's name and age stay off a page anyone can fetch.
"""
import io

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.utils.storage import get_storage


def _png(colour=(200, 40, 120, 255), size=(1600, 2000)) -> bytes:
    out = io.BytesIO()
    Image.new("RGBA", size, colour).save(out, "PNG")
    return out.getvalue()


def _hero(db, make_user, make_creation, completed_steps, *, character="Violet Volt"):
    owner = make_user(username="dana_login")
    hero = make_creation(owner.id, completed_steps)
    hero.character_name = character
    hero.name = "Dana Cohen"  # who drew it: must never reach the card
    hero.age = 7
    db.commit()
    return hero


def test_the_card_names_the_hero_and_never_who_drew_it(db, make_user, make_creation, completed_steps, monkeypatch):
    monkeypatch.setenv("FRONTEND_URL", "https://heromaker.example")
    hero = _hero(db, make_user, make_creation, completed_steps)
    r = TestClient(app).get(f"/api/v1/heroes/{hero.id}/share-card")

    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/html")
    assert '<meta property="og:title" content="Meet Violet Volt!">' in r.text
    assert "You draw it. We paint it. It comes alive!" in r.text
    assert f"https://heromaker.example/api/v1/heroes/{hero.id}/preview.jpg" in r.text
    assert f"https://heromaker.example/hero/{hero.id}?via=share" in r.text
    assert 'name="robots" content="noindex"' in r.text
    # The same URL is the app's page for people: never cached as the card.
    assert "no-store" in r.headers["cache-control"]
    for private in ("Dana", "Cohen", "dana_login", ">7<"):
        assert private not in r.text


def test_the_hero_name_is_escaped(db, make_user, make_creation, completed_steps):
    hero = _hero(db, make_user, make_creation, completed_steps, character='"><script>x</script>')
    r = TestClient(app).get(f"/api/v1/heroes/{hero.id}/share-card")
    assert "<script>x" not in r.text


def test_an_unnamed_hero_still_has_a_card(db, make_user, make_creation, completed_steps):
    hero = _hero(db, make_user, make_creation, completed_steps, character=None)
    r = TestClient(app).get(f"/api/v1/heroes/{hero.id}/share-card")
    assert r.status_code == 200
    assert 'content="A hero a kid drew"' in r.text


def test_a_deleted_or_unknown_hero_has_no_card(db, make_user, make_creation, completed_steps):
    from datetime import datetime

    hero = _hero(db, make_user, make_creation, completed_steps)
    hero.deleted_at = datetime.utcnow()
    db.commit()
    client = TestClient(app)
    for hero_id in (hero.id, "no-such-hero"):
        r = client.get(f"/api/v1/heroes/{hero_id}/share-card")
        assert r.status_code == 404
        assert "og:image" not in r.text
        assert client.get(f"/api/v1/heroes/{hero_id}/preview.jpg").status_code == 404


def test_the_preview_is_the_painting_as_a_jpeg(db, make_user, make_creation, completed_steps):
    hero = _hero(db, make_user, make_creation, completed_steps)
    get_storage().upload_file(hero.user_id, hero.id, "rendered.png", _png(), content_type="image/png")

    r = TestClient(app).get(f"/api/v1/heroes/{hero.id}/preview.jpg")

    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    img = Image.open(io.BytesIO(r.content))
    assert img.format == "JPEG"
    assert max(img.size) == 1200  # the chat apps' size, not the 2000px original
    assert img.getpixel((10, 10))[0] > 150  # the painting, not a blank


def test_an_unpainted_hero_previews_its_drawing(db, make_user, make_creation):
    owner = make_user(username="early")
    hero = make_creation(owner.id, {})
    out = io.BytesIO()
    Image.new("RGB", (800, 600), (10, 120, 200)).save(out, "JPEG")
    get_storage().upload_file(hero.user_id, hero.id, "original.jpg", out.getvalue(), content_type="image/jpeg")

    r = TestClient(app).get(f"/api/v1/heroes/{hero.id}/preview.jpg")
    assert r.status_code == 200
    assert Image.open(io.BytesIO(r.content)).size == (800, 600)
