"""
Gallery thumbnails on S3 storage.

Staging and production store files in S3. A thumb_<name> request used to
redirect to the full-size original (~1.5 MB per gallery tile). It must instead
generate a bounded thumbnail once, store it in S3 next to the original, and
redirect to that from then on.
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
    return fake


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

    assert r.status_code == 302
    assert r.headers["location"].startswith(f"https://bucket.example/{USER}/{CREATION}/thumb_original.jpg")
    img, content_type, _ = s3.thumb("thumb_original.jpg")
    assert img.format == "JPEG" and content_type == "image/jpeg"
    assert max(img.size) == max(files_api.THUMBNAIL_SIZE)


def test_second_request_reuses_the_stored_thumbnail(s3, client):
    s3.upload_file(USER, CREATION, "rendered.png", _encode(_noisy("RGBA"), "PNG"))
    url = f"/api/files/{USER}/{CREATION}/thumb_rendered.png"

    first = client.get(url)
    s3.downloads.clear()
    s3.uploads.clear()
    second = client.get(url)

    assert first.status_code == second.status_code == 302
    assert second.headers["location"] == first.headers["location"]
    assert s3.downloads == [], "a cached thumbnail must not download the original again"
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
