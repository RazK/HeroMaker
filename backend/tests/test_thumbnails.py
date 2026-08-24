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


# --- web-optimised models: what stops a phone downloading 7.4 MB to see a hero ---

def _glb_with_texture(px=1024) -> bytes:
    """
    A minimal but real GLB: one textured triangle, uint32 indices, uint16 joints,
    float weights - the same wasteful shapes the pipeline's models arrive in.

    The texture is smooth gradients with fine grain, which is roughly how a baked
    avatar texture behaves under compression. A flat or sparse image would make
    the size assertions meaningless.
    """
    import json, math, random, struct
    rng = random.Random(7)
    tex = Image.new("RGB", (px, px))
    tex.putdata([
        (
            max(0, min(255, int(128 + 90 * math.sin(x / 90.0)) + n)),
            max(0, min(255, int(128 + 90 * math.cos(y / 70.0)) + n)),
            max(0, min(255, ((x * y // 512) % 256) + n)),
        )
        for y in range(px) for x in range(px) for n in (rng.randrange(-18, 18),)
    ])
    png = io.BytesIO(); tex.save(png, "PNG"); png = png.getvalue()

    pos = struct.pack("<9f", 0, 0, 0, 1, 0, 0, 0, 1, 0)
    idx = struct.pack("<3I", 0, 1, 2)
    joints = struct.pack("<12H", *([0] * 12))
    weights = struct.pack("<12f", *([1.0, 0.0, 0.0, 0.0] * 3))

    blob = bytearray()
    views, offs = [], []
    for payload in (pos, idx, joints, weights, png):
        blob += b"\x00" * (-len(blob) % 4)
        offs.append(len(blob))
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(payload)})
        blob += payload

    js = {
        "asset": {"version": "2.0"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{
            "attributes": {"POSITION": 0, "JOINTS_0": 2, "WEIGHTS_0": 3},
            "indices": 1, "material": 0}]}],
        "materials": [{"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}}],
        "textures": [{"source": 0}], "images": [{"bufferView": 4, "mimeType": "image/png"}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"},
            {"bufferView": 1, "componentType": 5125, "count": 3, "type": "SCALAR"},
            {"bufferView": 2, "componentType": 5123, "count": 3, "type": "VEC4"},
            {"bufferView": 3, "componentType": 5126, "count": 3, "type": "VEC4"},
        ],
        "bufferViews": views, "buffers": [{"byteLength": len(blob)}],
    }
    js_bytes = json.dumps(js, separators=(",", ":")).encode()
    js_bytes += b" " * (-len(js_bytes) % 4)
    blob += b"\x00" * (-len(blob) % 4)
    total = 12 + 8 + len(js_bytes) + 8 + len(blob)
    out = bytearray(struct.pack("<III", 0x46546C67, 2, total))
    out += struct.pack("<II", len(js_bytes), 0x4E4F534A) + js_bytes
    out += struct.pack("<II", len(blob), 0x004E4942) + bytes(blob)
    return bytes(out)


def test_web_model_is_smaller_and_keeps_the_geometry():
    """
    A production walking.glb is 7.4 MB, which is what the 3D stage waits on.
    The optimised copy must be much smaller while describing the same model.
    """
    import json, struct
    from app.utils.glb_optimize import optimize_glb, _read_glb

    original = _glb_with_texture()
    out = optimize_glb(original)

    assert out is not None
    assert len(out) < len(original) / 3, f"{len(out)}B is not much smaller than {len(original)}B"

    before, _ = _read_glb(original)
    after, _ = _read_glb(out)
    # Same mesh, same triangle, same skeleton binding.
    assert len(after["meshes"]) == len(before["meshes"])
    assert after["accessors"][0]["count"] == before["accessors"][0]["count"]
    assert after["accessors"][1]["count"] == before["accessors"][1]["count"]
    # Attributes packed down, not dropped.
    assert after["accessors"][1]["componentType"] == 5123, "uint32 indices were not narrowed"
    assert after["accessors"][2]["componentType"] == 5121, "uint16 joints were not narrowed"
    assert after["accessors"][3]["componentType"] == 5121, "float weights were not quantised"
    assert after["accessors"][3]["normalized"] is True
    # The texture survives, as a data URI.
    assert after["images"][0]["uri"].startswith("data:image/webp;base64,")


def test_non_glb_input_is_declined_rather_than_corrupted():
    from app.utils.glb_optimize import optimize_glb
    assert optimize_glb(b"this is not a GLB at all") is None


def test_web_model_is_served_generated_once_and_leaves_the_original_alone(monkeypatch):
    glb = _glb_with_texture()
    storage = StubS3Storage({"u1/c1/walking.glb": glb})
    monkeypatch.setattr(files_api, "get_storage", lambda: storage)

    app = FastAPI()
    app.include_router(files_api.router, prefix="/api/files")
    client = TestClient(app, follow_redirects=False)

    resp = client.get("/api/files/u1/c1/web_walking.glb")
    assert resp.status_code == 302
    assert "web_walking.glb" in resp.headers["location"]

    stored = storage.objects["u1/c1/web_walking.glb"]
    assert len(stored) < len(glb) / 3
    # The original is untouched - downloads and VRM sharing depend on it.
    assert storage.objects["u1/c1/walking.glb"] == glb

    uploads = storage.uploads
    client.get("/api/files/u1/c1/web_walking.glb")
    assert storage.uploads == uploads, "the model was re-optimized instead of served from cache"


def test_web_prefix_on_a_non_model_is_not_treated_as_an_optimisation(monkeypatch):
    """'web_' only means something for a GLB or VRM; anything else is a filename."""
    storage = StubS3Storage({"u1/c1/web_notes.txt": b"hello"})
    monkeypatch.setattr(files_api, "get_storage", lambda: storage)
    app = FastAPI()
    app.include_router(files_api.router, prefix="/api/files")
    client = TestClient(app, follow_redirects=False)

    resp = client.get("/api/files/u1/c1/web_notes.txt")
    assert resp.status_code == 302
    assert "web_notes.txt" in resp.headers["location"]


def test_an_unoptimizable_model_still_serves(monkeypatch):
    """Better a large model than a broken preview."""
    storage = StubS3Storage({"u1/c1/walking.glb": b"not really a GLB"})
    monkeypatch.setattr(files_api, "get_storage", lambda: storage)
    app = FastAPI()
    app.include_router(files_api.router, prefix="/api/files")
    client = TestClient(app, follow_redirects=False)

    resp = client.get("/api/files/u1/c1/web_walking.glb")
    assert resp.status_code == 302
    assert "walking.glb" in resp.headers["location"]
    assert "u1/c1/web_walking.glb" not in storage.objects
