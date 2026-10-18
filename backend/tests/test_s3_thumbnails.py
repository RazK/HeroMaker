"""
Gallery thumbnails on S3 storage.

Staging and production store files in S3. A thumb_<name> request used to
redirect to the full-size original (~1.5 MB per gallery tile). It must instead
generate a bounded thumbnail once, store it in S3 next to the original, and
serve that from then on.

It is served as bytes, in one hop: a redirect to S3 cost every gallery tile a
second round trip, to a presigned URL that changes hourly and that S3 sends as
`no-cache`, so nothing stayed cached. With ?v=<version> the URL names one
version of the file and is cacheable for a year.
"""
import io

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from app.api import files as files_api
from app.utils import storage as storage_mod
from app.utils.storage import S3FileStorage, StorageBackend

USER, CREATION = "u1", "c1"


class FakeS3Storage(StorageBackend):
    """In-memory stand-in for S3FileStorage: no local paths, presigned URLs."""

    def __init__(self):
        self.objects: dict[str, tuple[bytes, str | None]] = {}
        self.downloads: list[str] = []
        self.uploads: list[str] = []

    def _key(self, user_id, creation_id, filename):
        return f"{user_id}/{creation_id}/{filename}"

    def upload_file(self, user_id, creation_id, filename, file_data, content_type=None):
        key = self._key(user_id, creation_id, filename)
        self.objects[key] = (file_data, content_type)
        self.uploads.append(filename)
        return key

    def download_file(self, user_id, creation_id, filename):
        key = self._key(user_id, creation_id, filename)
        self.downloads.append(filename)
        if key not in self.objects:
            raise FileNotFoundError(key)
        return self.objects[key][0]

    def get_file_url(self, user_id, creation_id, filename, expires_in=86400):
        return f"https://bucket.example/{self._key(user_id, creation_id, filename)}?sig=x"

    def file_exists(self, user_id, creation_id, filename):
        return self._key(user_id, creation_id, filename) in self.objects

    def list_files(self, user_id, creation_id):
        prefix = f"{user_id}/{creation_id}/"
        return [k[len(prefix):] for k in self.objects if k.startswith(prefix)]

    def delete_file(self, user_id, creation_id, filename):
        self.objects.pop(self._key(user_id, creation_id, filename), None)

    def get_file_path(self, user_id, creation_id, filename):
        raise NotImplementedError

    def thumb(self, name):
        data, content_type = self.objects[self._key(USER, CREATION, name)]
        return Image.open(io.BytesIO(data)), content_type, len(data)


@pytest.fixture
def s3(monkeypatch):
    fake = FakeS3Storage()
    monkeypatch.setattr(files_api, "get_storage", lambda: fake)
    files_api._thumb_memory.clear()
    yield fake
    files_api._thumb_memory.clear()


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(files_api.router, prefix="/api/files")
    return TestClient(app, follow_redirects=False)


def _noisy(mode, size=(1024, 1024)):
    """A large image with real detail, so its size resembles a real render."""
    import random
    rnd = random.Random(1)
    img = Image.effect_noise(size, 60).convert("RGB")
    img = Image.merge("RGB", [ch.point(lambda v, o=rnd.randint(0, 80): (v + o) % 256)
                              for ch in img.split()])
    if mode == "RGBA":
        alpha = Image.new("L", size, 0)
        alpha.paste(255, (size[0] // 4, size[1] // 8, size[0] * 3 // 4, size[1] * 7 // 8))
        img.putalpha(alpha)
    return img


def _encode(img, fmt):
    buf = io.BytesIO()
    img.save(buf, fmt, **({"quality": 95} if fmt == "JPEG" else {}))
    return buf.getvalue()


def test_first_request_generates_and_stores_a_thumbnail(s3, client):
    s3.upload_file(USER, CREATION, "original.jpg", _encode(_noisy("RGB"), "JPEG"))

    r = client.get(f"/api/files/{USER}/{CREATION}/thumb_original.jpg")

    assert r.status_code == 200, "the bytes themselves, no second hop to S3"
    assert r.headers["content-type"] == "image/jpeg"
    img, content_type, _ = s3.thumb("thumb_original.jpg")
    assert img.format == "JPEG" and content_type == "image/jpeg"
    assert max(img.size) == max(files_api.THUMBNAIL_SIZE)
    assert r.content == s3.objects[f"{USER}/{CREATION}/thumb_original.jpg"][0]


def test_second_request_reuses_the_stored_thumbnail(s3, client):
    s3.upload_file(USER, CREATION, "rendered.png", _encode(_noisy("RGBA"), "PNG"))
    url = f"/api/files/{USER}/{CREATION}/thumb_rendered.png"

    first = client.get(url)
    s3.downloads.clear()
    s3.uploads.clear()
    second = client.get(url)

    assert first.status_code == second.status_code == 200
    assert second.content == first.content
    assert second.headers["content-type"] == "image/webp"
    assert s3.downloads == ["thumb_rendered.png"], "a cached thumbnail must not download the original again"
    assert s3.uploads == [], "a cached thumbnail must not be regenerated"


def test_transparent_render_gets_a_transparent_webp_thumbnail(s3, client):
    s3.upload_file(USER, CREATION, "rendered.png", _encode(_noisy("RGBA"), "PNG"))

    client.get(f"/api/files/{USER}/{CREATION}/thumb_rendered.png")

    img, content_type, _ = s3.thumb("thumb_rendered.png")
    assert img.format == "WEBP" and content_type == "image/webp"
    assert img.mode == "RGBA"
    assert img.getpixel((0, 0))[3] == 0, "the corner must stay see-through, not black"


def test_thumbnail_size_is_bounded(s3, client):
    original = _encode(_noisy("RGB", (2048, 1536)), "JPEG")
    s3.upload_file(USER, CREATION, "original.jpg", original)

    client.get(f"/api/files/{USER}/{CREATION}/thumb_original.jpg")

    img, _, nbytes = s3.thumb("thumb_original.jpg")
    assert img.size == (512, 384), "fits the bound, keeps the aspect ratio"
    assert nbytes < len(original) / 5


def test_missing_original_is_a_404_and_stores_nothing(s3, client):
    r = client.get(f"/api/files/{USER}/{CREATION}/thumb_rendered.png")

    assert r.status_code == 404
    assert s3.objects == {}


def test_unreadable_original_falls_back_to_the_original(s3, client):
    s3.upload_file(USER, CREATION, "rendered.png", b"not an image")

    r = client.get(f"/api/files/{USER}/{CREATION}/thumb_rendered.png")

    assert r.status_code == 302
    assert "/rendered.png?" in r.headers["location"]
    assert not s3.file_exists(USER, CREATION, "thumb_rendered.png")


def test_unversioned_thumbnail_is_revalidated_with_an_etag(s3, client):
    s3.upload_file(USER, CREATION, "original.jpg", _encode(_noisy("RGB"), "JPEG"))
    url = f"/api/files/{USER}/{CREATION}/thumb_original.jpg"

    r = client.get(url)

    assert r.headers["cache-control"] == "no-cache"
    etag = r.headers["etag"]
    again = client.get(url, headers={"If-None-Match": etag})
    assert again.status_code == 304 and again.content == b""


def test_versioned_thumbnail_is_cacheable_for_a_year(s3, client):
    s3.upload_file(USER, CREATION, "original.jpg", _encode(_noisy("RGB"), "JPEG"))

    r = client.get(f"/api/files/{USER}/{CREATION}/thumb_original.jpg?v=18f2a")

    assert r.status_code == 200
    assert r.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert r.headers["etag"]


def test_versioned_thumbnail_is_served_from_memory_after_the_first_request(s3, client):
    s3.upload_file(USER, CREATION, "original.jpg", _encode(_noisy("RGB"), "JPEG"))
    url = f"/api/files/{USER}/{CREATION}/thumb_original.jpg?v=1"
    first = client.get(url)
    s3.downloads.clear()

    second = client.get(url)

    assert second.content == first.content
    assert s3.downloads == [], "a warm gallery must not touch S3"


def test_a_new_version_is_read_afresh(s3, client):
    """Re-running a step replaces the original and drops the stored thumbnail;
    the hero's new file_versions give the new picture a URL nothing has cached."""
    s3.upload_file(USER, CREATION, "rendered.png", _encode(_noisy("RGB"), "PNG"))
    old = client.get(f"/api/files/{USER}/{CREATION}/thumb_rendered.png?v=1").content

    new_render = _encode(Image.new("RGB", (600, 600), "red"), "PNG")
    s3.upload_file(USER, CREATION, "rendered.png", new_render)
    s3.delete_file(USER, CREATION, "thumb_rendered.png")  # what upload_file does on S3
    new = client.get(f"/api/files/{USER}/{CREATION}/thumb_rendered.png?v=2").content

    assert new != old
    red, green, _ = Image.open(io.BytesIO(new)).convert("RGB").getpixel((10, 10))
    assert red > 240 and green < 15, "the new render, not the old one"


def test_memory_is_bounded_by_bytes():
    memory = files_api._ThumbMemory(max_bytes=10)
    memory.put(("a",), (b"12345", "image/jpeg", '"a"'))
    memory.put(("b",), (b"12345", "image/jpeg", '"b"'))
    memory.get(("a",))  # a is now the most recently used
    memory.put(("c",), (b"123", "image/jpeg", '"c"'))

    assert memory.get(("b",)) is None, "the least recently used goes first"
    assert memory.get(("a",)) and memory.get(("c",))
    assert memory.size == 8
    memory.put(("huge",), (b"x" * 11, "image/jpeg", '"h"'))
    assert memory.get(("huge",)) is None


def test_non_thumbnail_requests_still_redirect_to_the_file(s3, client):
    s3.upload_file(USER, CREATION, "model.glb", b"glb")

    assert client.get(f"/api/files/{USER}/{CREATION}/model.glb").status_code == 302
    assert client.get(f"/api/files/{USER}/{CREATION}/missing.glb").status_code == 404


class _FakeBoto:
    def __init__(self):
        self.calls = []

    def put_object(self, **kw):
        self.calls.append(("put", kw["Key"], kw.get("ContentType")))

    def delete_object(self, **kw):
        self.calls.append(("delete", kw["Key"], None))


def _real_s3_storage():
    store = S3FileStorage.__new__(S3FileStorage)
    store.bucket_name = "bucket"
    store.s3_client = _FakeBoto()
    return store


def test_s3_upload_sets_content_type_and_invalidates_the_thumbnail():
    store = _real_s3_storage()

    store.upload_file(USER, CREATION, "rendered.png", b"png", content_type="image/png")

    assert store.s3_client.calls == [
        ("put", f"{USER}/{CREATION}/rendered.png", "image/png"),
        ("delete", f"{USER}/{CREATION}/thumb_rendered.png", None),
    ]


def test_s3_uploading_a_thumbnail_does_not_delete_anything():
    store = _real_s3_storage()

    store.upload_file(USER, CREATION, "thumb_rendered.png", b"png")

    assert [c[0] for c in store.s3_client.calls] == ["put"]


def test_local_upload_invalidates_the_cached_thumbnail(tmp_path, monkeypatch):
    monkeypatch.setattr(storage_mod, "FILES_ROOT", str(tmp_path))
    store = storage_mod.LocalFileStorage()
    store.upload_file(USER, CREATION, "rendered.png", b"old")
    thumb = store.get_file_path(USER, CREATION, "thumb_rendered.png")
    thumb.write_bytes(b"stale")

    store.upload_file(USER, CREATION, "rendered.png", b"new")

    assert not thumb.exists()


def test_exif_rotated_phone_photo_thumbnail_is_upright(s3, client):
    # Stored landscape with "rotate 90 CW" in EXIF, as phones do; shown portrait.
    img = _noisy("RGB", (800, 600))
    exif = Image.Exif()
    exif[0x0112] = 6
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    s3.upload_file(USER, CREATION, "original.jpg", buf.getvalue())

    client.get(f"/api/files/{USER}/{CREATION}/thumb_original.jpg")

    thumb, _, _ = s3.thumb("thumb_original.jpg")
    assert thumb.size == (384, 512)


def test_local_thumbnail_is_served_with_its_real_content_type(tmp_path, monkeypatch, client):
    monkeypatch.setattr(storage_mod, "FILES_ROOT", str(tmp_path))
    local = storage_mod.LocalFileStorage()
    monkeypatch.setattr(files_api, "get_storage", lambda: local)
    local.upload_file(USER, CREATION, "rendered.png", _encode(_noisy("RGBA"), "PNG"))

    r = client.get(f"/api/files/{USER}/{CREATION}/thumb_rendered.png")

    assert r.status_code == 200
    assert r.headers["content-type"] == "image/webp"
    assert Image.open(io.BytesIO(r.content)).getpixel((0, 0))[3] == 0


def test_file_versions_change_when_a_step_runs_again():
    """The version the client puts in a thumbnail URL comes from the hero."""
    from datetime import datetime
    from types import SimpleNamespace
    from app.schemas.creation import file_versions

    def hero(render_done):
        steps = [SimpleNamespace(step_name="image_processing", status="completed",
                                 completed_at=datetime(2026, 1, 1, 10, 0, 1)),
                 SimpleNamespace(step_name="openai_render",
                                 status="completed" if render_done else "processing",
                                 completed_at=render_done)]
        return SimpleNamespace(created_at=datetime(2026, 1, 1, 10, 0, 0), steps=steps)

    first = file_versions(hero(datetime(2026, 1, 1, 10, 1, 0)))
    again = file_versions(hero(datetime(2026, 1, 2, 9, 0, 0)))
    running = file_versions(hero(None))

    assert set(first) == {"original.jpg", "processed.jpg", "rendered.png"}
    assert first["original.jpg"] == again["original.jpg"]
    assert first["rendered.png"] != again["rendered.png"]
    assert "rendered.png" not in running, "a step still running has no version yet"
