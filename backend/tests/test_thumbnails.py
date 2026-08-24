"""
Thumbnail generation must work on every storage backend.

The regression these cover: thumbnail generation used to operate on local
filesystem paths, so on S3 deployments `thumb_x.png` fell through to a redirect
at the *original* object. Production served 1.4 MB "thumbnails" - byte-identical
to the full-size images - for every gallery tile.
"""
import io
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api import files as files_api  # noqa: E402


def _png_bytes(size=(1400, 1800)) -> bytes:
    img = Image.new("RGBA", size)
    for y in range(0, size[1], 4):
        for x in range(0, size[0], 4):
            img.putpixel((x, y), ((x * 7) % 256, (y * 5) % 256, 90, 255))
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


class StubS3Storage:
    """In-memory stand-in for S3: no local paths, presigned URLs, byte access."""

    def __init__(self, objects):
        self.objects = dict(objects)
        self.uploads = 0
        self.downloads = 0
        self.downloaded = []

    def _key(self, u, c, f):
        return f"{u}/{c}/{f}"

    def file_exists(self, u, c, f):
        return self._key(u, c, f) in self.objects

    def download_file(self, u, c, f):
        self.downloads += 1
        self.downloaded.append(f)
        return self.objects[self._key(u, c, f)]

    def upload_file(self, u, c, f, data):
        self.uploads += 1
        self.objects[self._key(u, c, f)] = data
        return self._key(u, c, f)

    def get_file_url(self, u, c, f, expires_in=86400):
        return f"https://s3.example.com/{self._key(u, c, f)}?signature=stub"

    def get_file_path(self, u, c, f):
        raise NotImplementedError("S3 storage has no local paths")


@pytest.fixture
def client_and_storage(monkeypatch):
    original = _png_bytes()
    storage = StubS3Storage({"u1/c1/rendered.png": original, "u1/c1/model.glb": b"glTF\x02\x00\x00\x00not-an-image"})
    monkeypatch.setattr(files_api, "get_storage", lambda: storage)

    app = FastAPI()
    app.include_router(files_api.router, prefix="/api/files")
    return TestClient(app, follow_redirects=False), storage, original


def test_s3_thumbnail_is_generated_not_the_original(client_and_storage):
    client, storage, original = client_and_storage

    resp = client.get("/api/files/u1/c1/thumb_rendered.png")

    # Thumbnails come back as bytes, not as a redirect to storage: a 302 to a
    # presigned URL costs a second round trip for a couple of kilobytes.
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/jpeg"
    assert len(resp.content) < len(original) / 5, (
        f"served {len(resp.content)}B for an original of {len(original)}B - that is the full-size file"
    )

    thumb = storage.objects["u1/c1/thumb_rendered.jpg"]
    assert len(thumb) < len(original) / 5, (
        f"thumbnail {len(thumb)}B is not meaningfully smaller than original {len(original)}B"
    )
    with Image.open(io.BytesIO(thumb)) as img:
        assert max(img.size) <= max(files_api.THUMBNAIL_SIZE)
        assert img.format == "JPEG"


def test_thumbnail_is_generated_once_then_cached(client_and_storage):
    client, storage, _ = client_and_storage

    client.get("/api/files/u1/c1/thumb_rendered.png")
    after_first = storage.uploads
    assert after_first >= 1

    client.get("/api/files/u1/c1/thumb_rendered.png")
    assert storage.uploads == after_first, "thumbnail was regenerated instead of served from cache"


def test_sized_variants_are_served_at_the_size_asked_for(client_and_storage):
    """The rail tiles are ~90px wide; sending them the 512px copy is four times
    the pixels and four times the wait."""
    client, storage, _ = client_and_storage

    resp = client.get("/api/files/u1/c1/thumb_128_rendered.png")

    assert resp.status_code == 200
    with Image.open(io.BytesIO(resp.content)) as img:
        assert max(img.size) <= 128
    with Image.open(io.BytesIO(storage.objects["u1/c1/thumb_128_rendered.jpg"])) as img:
        assert max(img.size) <= 128
    assert len(storage.objects["u1/c1/thumb_128_rendered.jpg"]) < len(
        storage.objects["u1/c1/thumb_rendered.jpg"]
    )


def test_every_size_is_made_from_a_single_download(client_and_storage):
    """A cold creation asks for 128 (rail) and 512 (stage stand-in) at once. Each
    size must not cost its own download of a multi-megabyte original."""
    client, storage, _ = client_and_storage

    client.get("/api/files/u1/c1/thumb_128_rendered.png")
    assert storage.downloaded.count("rendered.png") == 1

    for size in sorted(files_api.THUMB_SIZES):
        name = files_api._thumb_name("rendered.png", size)
        assert f"u1/c1/{name}" in storage.objects, f"{name} was not pre-generated"

    # The other sizes are already there, so the original is never fetched again.
    client.get("/api/files/u1/c1/thumb_rendered.png")
    client.get("/api/files/u1/c1/thumb_256_rendered.png")
    assert storage.downloaded.count("rendered.png") == 1


def test_unknown_size_falls_back_to_the_default(client_and_storage):
    """The size is whitelisted so the endpoint cannot be driven to generate
    unbounded variants."""
    client, storage, _ = client_and_storage

    resp = client.get("/api/files/u1/c1/thumb_9999_rendered.png")

    assert resp.status_code == 200
    assert "u1/c1/thumb_9999_rendered.jpg" not in storage.objects
    with Image.open(io.BytesIO(resp.content)) as img:
        assert max(img.size) <= max(files_api.THUMBNAIL_SIZE)


def test_non_image_falls_back_to_the_original(client_and_storage):
    client, storage, _ = client_and_storage

    resp = client.get("/api/files/u1/c1/thumb_model.glb")

    assert resp.status_code == 302
    assert "model.glb" in resp.headers["location"]
    assert storage.uploads == 0


def test_missing_original_is_404(client_and_storage):
    client, _, _ = client_and_storage
    assert client.get("/api/files/u1/c1/thumb_nope.png").status_code == 404


def test_path_traversal_is_rejected(client_and_storage):
    client, _, _ = client_and_storage
    assert client.get("/api/files/u1/c1/..%2f..%2fetc%2fpasswd").status_code in (403, 404)


def test_local_storage_still_serves_a_real_thumbnail(monkeypatch, tmp_path):
    """The local-disk path must keep working, and serve JPEG bytes."""
    original = _png_bytes()
    d = tmp_path / "u1" / "c1"
    d.mkdir(parents=True)
    (d / "rendered.png").write_bytes(original)

    class LocalStub(StubS3Storage):
        def get_file_path(self, u, c, f):
            return tmp_path / u / c / f

        def upload_file(self, u, c, f, data):
            self.uploads += 1
            (tmp_path / u / c / f).write_bytes(data)
            return f

        def file_exists(self, u, c, f):
            return (tmp_path / u / c / f).exists()

        def download_file(self, u, c, f):
            self.downloads += 1
            return (tmp_path / u / c / f).read_bytes()

    storage = LocalStub({})
    monkeypatch.setattr(files_api, "get_storage", lambda: storage)
    app = FastAPI()
    app.include_router(files_api.router, prefix="/api/files")
    client = TestClient(app, follow_redirects=False)

    resp = client.get("/api/files/u1/c1/thumb_rendered.png")

    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/jpeg"
    assert len(resp.content) < len(original) / 5
    assert (tmp_path / "u1" / "c1" / "thumb_rendered.jpg").exists()


# --- S3 key prefixing: what keeps staging off production's objects ---

def _s3_storage(monkeypatch, prefix):
    """Build an S3FileStorage with a stubbed boto client and the given prefix."""
    import app.utils.storage as storage_mod
    monkeypatch.setenv("S3_BUCKET", "bucket")
    monkeypatch.setenv("S3_ACCESS_KEY_ID", "id")
    monkeypatch.setenv("S3_SECRET_ACCESS_KEY", "secret")
    if prefix is None:
        monkeypatch.delenv("S3_PREFIX", raising=False)
    else:
        monkeypatch.setenv("S3_PREFIX", prefix)
    monkeypatch.setattr(storage_mod.boto3, "client", lambda *a, **k: object())
    return storage_mod.S3FileStorage()


def test_no_prefix_keeps_production_keys_unchanged(monkeypatch):
    s = _s3_storage(monkeypatch, None)
    assert s._get_s3_key("u", "c", "rendered.png") == "u/c/rendered.png"


@pytest.mark.parametrize("prefix", ["staging", "/staging/", "staging/"])
def test_prefix_is_applied_and_normalised(monkeypatch, prefix):
    s = _s3_storage(monkeypatch, prefix)
    assert s._get_s3_key("u", "c", "rendered.png") == "staging/u/c/rendered.png"


def test_listing_is_scoped_to_the_prefix(monkeypatch):
    s = _s3_storage(monkeypatch, "staging")
    assert s._get_s3_key("u", "c", "") == "staging/u/c/"


# --- eager generation: nobody should pay to build a thumbnail on first view ---

def test_completing_a_step_pre_generates_every_thumbnail_size(monkeypatch):
    """
    Building thumbnails on first view meant whoever opened a creation first paid
    for the download, the resize and the upload - measured at 1.8s on staging
    before a rail tile had anything in it. The pipeline builds them instead.
    """
    from app.services import pipeline

    storage = StubS3Storage({"u1/c1/processed.jpg": _png_bytes()})
    monkeypatch.setattr(pipeline, "get_storage", lambda: storage)
    monkeypatch.setattr(files_api, "get_storage", lambda: storage)

    pipeline._warm_thumbnails("u1", "c1", "processed.jpg")

    for size in sorted(files_api.THUMB_SIZES):
        name = files_api._thumb_name("processed.jpg", size)
        assert f"u1/c1/{name}" in storage.objects, f"{name} was not pre-generated"
    assert storage.downloaded.count("processed.jpg") == 1, "the original was fetched once per size"


def test_warming_a_non_image_output_is_a_no_op(monkeypatch):
    """A GLB or a VRM has no thumbnail; warming must not error or fetch it."""
    from app.services import pipeline

    storage = StubS3Storage({"u1/c1/rigged.glb": b"glTF\x02\x00\x00\x00"})
    monkeypatch.setattr(pipeline, "get_storage", lambda: storage)

    pipeline._warm_thumbnails("u1", "c1", "rigged.glb")
    pipeline._warm_thumbnails("u1", "c1", None)

    assert storage.downloads == 0
    assert storage.uploads == 0


def test_warming_never_fails_a_completed_step(monkeypatch):
    """A step that produced its output is done, whatever storage does next."""
    from app.services import pipeline

    class Broken(StubS3Storage):
        def download_file(self, u, c, f):
            raise RuntimeError("storage is having a bad day")

    monkeypatch.setattr(pipeline, "get_storage", lambda: Broken({}))
    monkeypatch.setattr(files_api, "get_storage", lambda: Broken({}))

    pipeline._warm_thumbnails("u1", "c1", "processed.jpg")  # must not raise
