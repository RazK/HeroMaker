"""
Old paintings stand on an opaque studio backdrop; the gallery shows a cut-out
of them instead (app/utils/cutout.py, app/services/painting_cut.py).

The original is never modified: the cut is a derived file, made on first
request like a thumbnail, and the client is told which case applies.
"""
import io
from datetime import datetime

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFilter

from app.api import files as files_api
from app.models import Creation, CreationStep
from app.schemas.creation import CreationResponse, file_versions
from app.services import painting_cut
from app.utils import cutout
from app.utils.storage import LocalFileStorage


# --- pictures -----------------------------------------------------------------

def _studio(size=512, figure=True, noise=0.0, seed=1):
    """A toy on a light studio sweep: vignette, contact shadow, outlined figure."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:size, 0:size] / (size - 1)
    vignette = 238 - 26 * ((x - 0.5) ** 2 + (y - 0.45) ** 2)
    bg = np.stack([vignette, vignette - 3, vignette - 8], axis=-1)
    if noise:
        bg = bg + rng.normal(0, noise, bg.shape)
    img = Image.fromarray(np.clip(bg, 0, 255).astype(np.uint8), "RGB")
    if not figure:
        return img
    s = size / 512
    shadow = Image.new("L", img.size, 0)
    ImageDraw.Draw(shadow).ellipse([170 * s, 440 * s, 342 * s, 470 * s], fill=90)
    shadow = shadow.filter(ImageFilter.GaussianBlur(8 * s))
    img = Image.composite(Image.new("RGB", img.size, (40, 36, 30)), img, shadow)
    d = ImageDraw.Draw(img)
    d.rectangle([205 * s, 330 * s, 240 * s, 455 * s], fill=(30, 60, 170), outline=(20, 20, 40), width=3)   # legs
    d.rectangle([272 * s, 330 * s, 307 * s, 455 * s], fill=(30, 60, 170), outline=(20, 20, 40), width=3)
    d.ellipse([170 * s, 170 * s, 342 * s, 360 * s], fill=(210, 40, 50), outline=(60, 10, 10), width=4)    # body
    d.ellipse([200 * s, 60 * s, 312 * s, 180 * s], fill=(240, 190, 150), outline=(90, 50, 30), width=4)   # head
    d.ellipse([228 * s, 100 * s, 252 * s, 124 * s], fill=(236, 233, 228), outline=(20, 20, 20), width=3)  # an eye, backdrop-white
    return img


def _png(img) -> bytes:
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


def _transparent_png(size=256) -> bytes:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(img).ellipse([60, 40, 196, 230], fill=(210, 40, 50, 255))
    return _png(img)


# --- the algorithm ------------------------------------------------------------

def test_a_transparent_painting_is_left_as_it_is():
    result = cutout.cut_out(_transparent_png())
    assert result.kind == cutout.TRANSPARENT
    assert result.image is None


def test_a_studio_backdrop_is_cut_away_and_the_figure_kept():
    painting = _studio()
    result = cutout.cut_out(_png(painting))
    assert result.kind == cutout.CUT, result.reason
    cut = np.asarray(result.image)
    assert cut.shape == (512, 512, 4)
    alpha = cut[..., 3]
    # The backdrop is gone, corners and sides alike...
    for y, x in [(5, 5), (5, 506), (506, 5), (250, 20), (250, 490), (30, 256)]:
        assert alpha[y, x] == 0, (y, x)
    # ...the figure is whole and its colours untouched...
    for y, x in [(260, 256), (120, 290), (400, 222), (400, 290)]:
        assert alpha[y, x] == 255, (y, x)
        assert np.abs(cut[y, x, :3].astype(int) - np.asarray(painting)[y, x].astype(int)).max() <= 2
    # ...an enclosed backdrop-white region inside it (the eye) stays...
    assert alpha[112, 240] == 255
    # ...and the contact shadow survives as translucent dark, not as backdrop.
    shadow = cut[462, 256]
    assert 0 < shadow[3] < 200 and shadow[:3].max() < 80


def test_the_cut_edge_has_no_backdrop_halo():
    result = cutout.cut_out(_png(_studio()))
    cut = np.asarray(result.image).astype(int)
    # Pixels along the body's outline that are partly see-through must not
    # carry the light backdrop colour in them (decontaminated).
    edge = (cut[..., 3] > 10) & (cut[..., 3] < 245)
    assert edge.sum() > 50
    luma = (cut[..., 0] * 0.299 + cut[..., 1] * 0.587 + cut[..., 2] * 0.114)[edge]
    assert np.median(luma) < 170


def test_a_noisy_background_is_framed_not_cut():
    result = cutout.cut_out(_png(_studio(noise=40)))
    assert result.kind == cutout.FRAMED
    assert result.image is None


def test_a_busy_scene_is_framed_not_cut():
    rng = np.random.default_rng(3)
    blocks = rng.integers(0, 255, (16, 16, 3)).astype(np.uint8)
    scene = Image.fromarray(blocks, "RGB").resize((512, 512), Image.NEAREST)
    assert cutout.cut_out(_png(scene)).kind == cutout.FRAMED


def test_a_backdrop_with_nothing_on_it_is_framed():
    result = cutout.cut_out(_png(_studio(figure=False)))
    assert result.kind == cutout.FRAMED


# --- versions: the URL changes with the algorithm -----------------------------

def _hero(completed_at):
    return Creation(id="c", user_id="u", created_at=datetime(2026, 1, 1),
                    steps=[CreationStep(step_name="openai_render", status="completed", completed_at=completed_at)])


def test_a_new_cut_algorithm_changes_the_paintings_url_and_only_its(monkeypatch):
    hero = _hero(datetime(2026, 1, 1, 10))
    first = file_versions(hero)
    monkeypatch.setattr("app.schemas.creation.CUTOUT_VERSION", cutout.CUTOUT_VERSION + 1)
    second = file_versions(hero)
    assert first["original.jpg"] == second["original.jpg"]
    assert first["rendered.png"] != second["rendered.png"]


# --- the file endpoint: derived, never destructive ----------------------------

@pytest.fixture
def local(tmp_path, monkeypatch):
    monkeypatch.setattr("app.utils.storage.FILES_ROOT", str(tmp_path))
    storage = LocalFileStorage()
    monkeypatch.setattr(files_api, "get_storage", lambda: storage)
    return storage


@pytest.fixture
def client():
    from app.main import app
    return TestClient(app, follow_redirects=False)


def _painted_hero(db, make_user, make_creation, local, painting: bytes, at=datetime(2026, 1, 1, 10)):
    user = make_user()
    creation = make_creation(user.id, {"openai_render": "completed"})
    step = db.query(CreationStep).filter_by(creation_id=creation.id).one()
    step.completed_at = at
    db.commit()
    local.upload_file(user.id, creation.id, "rendered.png", painting)
    return user, creation


def _get(client, user, creation, name, v=None):
    url = f"/api/files/{user.id}/{creation.id}/{name}" + (f"?v={v}" if v else "")
    return client.get(url)


def test_the_original_is_never_modified_and_the_cut_is_derived(db, make_user, make_creation, local, client):
    painting = _png(_studio())
    user, creation = _painted_hero(db, make_user, make_creation, local, painting)

    thumb = _get(client, user, creation, "thumb_rendered.png")
    assert thumb.status_code == 200
    with Image.open(io.BytesIO(thumb.content)) as t:
        assert t.format == "WEBP" and t.mode == "RGBA"
        assert t.getpixel((2, 2))[3] == 0, "the thumbnail is made from the cut"

    full = _get(client, user, creation, "cut_rendered.png")
    assert full.status_code == 200
    with Image.open(io.BytesIO(full.content)) as c:
        assert c.mode == "RGBA" and c.size == (512, 512) and c.getpixel((2, 2))[3] == 0

    # rendered.png is byte for byte what was uploaded.
    assert local.download_file(user.id, creation.id, "rendered.png") == painting
    assert _get(client, user, creation, "rendered.png").content == painting

    db.expire_all()
    stored = db.get(Creation, creation.id)
    assert stored.metadata_json["painting_cut"]["kind"] == cutout.CUT
    assert CreationResponse.from_creation(stored).painting == cutout.CUT


def test_a_transparent_painting_is_served_as_it_is(db, make_user, make_creation, local, client):
    painting = _transparent_png()
    user, creation = _painted_hero(db, make_user, make_creation, local, painting)

    assert _get(client, user, creation, "cut_rendered.png").content == painting
    assert not local.file_exists(user.id, creation.id, "cut_rendered.png")
    db.expire_all()
    assert CreationResponse.from_creation(db.get(Creation, creation.id)).painting == cutout.TRANSPARENT


def test_no_confident_cut_tells_the_client_to_frame_it(db, make_user, make_creation, local, client):
    painting = _png(_studio(noise=40))
    user, creation = _painted_hero(db, make_user, make_creation, local, painting)

    assert _get(client, user, creation, "cut_rendered.png").content == painting
    with Image.open(io.BytesIO(_get(client, user, creation, "thumb_rendered.png").content)) as t:
        assert t.format == "JPEG", "a framed painting's thumbnail is the opaque painting"
    db.expire_all()
    assert CreationResponse.from_creation(db.get(Creation, creation.id)).painting == cutout.FRAMED


def test_an_old_thumbnail_is_replaced_by_one_made_from_the_cut(db, make_user, make_creation, local, client):
    painting = _png(_studio())
    user, creation = _painted_hero(db, make_user, make_creation, local, painting)
    # What the previous release cached: a thumbnail of the opaque painting.
    stale, mime = files_api._make_thumbnail(painting)
    assert mime == "image/jpeg"
    local.upload_file(user.id, creation.id, "thumb_rendered.png", stale)

    fresh = _get(client, user, creation, "thumb_rendered.png").content
    assert fresh != stale
    with Image.open(io.BytesIO(fresh)) as t:
        assert t.mode == "RGBA"


def test_a_new_algorithm_remakes_the_cut(db, make_user, make_creation, local, client, monkeypatch):
    user, creation = _painted_hero(db, make_user, make_creation, local, _png(_studio()))
    _get(client, user, creation, "cut_rendered.png")
    calls = []
    real = cutout.cut_out
    monkeypatch.setattr(cutout, "cut_out", lambda data: calls.append(1) or real(data))

    _get(client, user, creation, "cut_rendered.png")
    assert calls == [], "a current cut is reused, not remade"

    monkeypatch.setattr(cutout, "CUTOUT_VERSION", cutout.CUTOUT_VERSION + 1)
    _get(client, user, creation, "cut_rendered.png")
    assert calls == [1]


def test_a_repainted_hero_gets_a_new_cut(db, make_user, make_creation, local, client):
    user, creation = _painted_hero(db, make_user, make_creation, local, _png(_studio()))
    _get(client, user, creation, "cut_rendered.png")
    assert local.file_exists(user.id, creation.id, "cut_rendered.png")

    # Painted again, this time transparent: the stale cut goes with the upload.
    step = db.query(CreationStep).filter_by(creation_id=creation.id).one()
    step.completed_at = datetime(2026, 2, 1)
    db.commit()
    local.upload_file(user.id, creation.id, "rendered.png", _transparent_png())
    assert not local.file_exists(user.id, creation.id, "cut_rendered.png")

    _get(client, user, creation, "thumb_rendered.png")
    db.expire_all()
    assert CreationResponse.from_creation(db.get(Creation, creation.id)).painting == cutout.TRANSPARENT


def test_an_unpainted_hero_is_not_cut(db, make_user, make_creation, local, client):
    user = make_user()
    creation = make_creation(user.id, {"openai_render": "processing"})
    assert painting_cut.prepare(local, user.id, creation.id) is None
    assert _get(client, user, creation, "cut_rendered.png").status_code == 404


def test_making_the_cut_does_not_reorder_the_gallery(db, make_user, make_creation, local, client):
    user, creation = _painted_hero(db, make_user, make_creation, local, _png(_studio()))
    db.refresh(creation)
    before = creation.updated_at
    _get(client, user, creation, "thumb_rendered.png")
    db.expire_all()
    stored = db.get(Creation, creation.id)
    assert stored.metadata_json["painting_cut"]["kind"] == cutout.CUT
    assert stored.updated_at == before, "the gallery orders by updated_at"


def test_a_removed_heros_cut_is_not_public(db, make_user, make_creation, local, client):
    user, creation = _painted_hero(db, make_user, make_creation, local, _png(_studio()))
    creation.deleted_at = datetime(2026, 3, 1)
    db.commit()
    assert _get(client, user, creation, "cut_rendered.png").status_code == 404
    assert _get(client, user, creation, "thumb_rendered.png").status_code == 404
    assert not local.file_exists(user.id, creation.id, "cut_rendered.png"), "nothing is derived for it either"


def test_too_busy_to_cut_serves_the_painting_uncached(db, make_user, make_creation, local, client, monkeypatch):
    import threading
    painting = _png(_studio())
    user, creation = _painted_hero(db, make_user, make_creation, local, painting)
    monkeypatch.setattr(painting_cut, "_slots", threading.BoundedSemaphore(1))
    monkeypatch.setattr(painting_cut, "WAIT_S", 0.01)
    painting_cut._slots.acquire()  # every slot taken by other heroes
    try:
        full = _get(client, user, creation, "cut_rendered.png", v="x")
        assert full.content == painting and full.headers["cache-control"] == "no-store"
        thumb = _get(client, user, creation, "thumb_rendered.png", v="x")
        assert thumb.status_code == 200 and "immutable" not in thumb.headers["cache-control"]
    finally:
        painting_cut._slots.release()
    # Its turn comes: the cut is made and from then on cacheable.
    later = _get(client, user, creation, "thumb_rendered.png", v="x")
    assert "immutable" in later.headers["cache-control"]
    with Image.open(io.BytesIO(later.content)) as t:
        assert t.mode == "RGBA"
