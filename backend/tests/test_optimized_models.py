"""
opt_<name>.glb: a web-sized copy of each 3D file, made once and cached.

The "How it was made" screen loads a hero's model.glb (~4 MB) and walking.glb
(~7 MB) on a phone. More than half of each is a 2048 px texture. A request for
opt_<name> must serve a copy that is several times smaller and looks the same:
generated from the original on first request, stored next to it (S3 or disk),
served from storage thereafter, and thrown away when the original is
re-uploaded. Skins and animations must survive with their keyframes intact.

These tests drive the real endpoint on a GLB built to look like the pipeline's:
skinned, animated, a large PNG and a JPEG texture, plus an image nothing uses.
"""
import io
import json
import os
import struct
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from app.api import files as files_api
from app.utils import gltf_optimize
from app.utils import storage as storage_mod
from app.utils.gltf_optimize import read_glb
from test_s3_thumbnails import FakeS3Storage, _real_s3_storage

USER, CREATION = "u1", "c1"
REPO = Path(__file__).resolve().parents[2]
FLOAT, UBYTE, USHORT, UINT = 5126, 5121, 5123, 5125


# ---------------------------------------------------------------------------
# A small GLB shaped like the pipeline's walking.glb
# ---------------------------------------------------------------------------

def _noise_image(size, fmt):
    img = Image.effect_noise((size, size), 50).convert("RGB")
    img = Image.merge("RGB", (img.split()[0], img.point(lambda v: 255 - v).split()[1], img.split()[2]))
    buf = io.BytesIO()
    img.save(buf, fmt, **({"quality": 95} if fmt == "JPEG" else {}))
    return buf.getvalue()


def make_glb(*, texture_size=2048, n_quads=40) -> bytes:
    """A skinned, animated strip: 2 joints, 1 clip, uint32 indices, float weights."""
    blob = bytearray()
    views, accessors = [], []

    def add(data: bytes, target=None):
        blob.extend(b"\x00" * (-len(blob) % 4))
        view = {"buffer": 0, "byteOffset": len(blob), "byteLength": len(data)}
        if target:
            view["target"] = target
        views.append(view)
        blob.extend(data)
        return len(views) - 1

    def accessor(data, component, count, type_, target=None, **extra):
        accessors.append({"bufferView": add(data, target), "componentType": component,
                          "count": count, "type": type_, **extra})
        return len(accessors) - 1

    positions, uvs, joints, weights = [], [], [], []
    for i in range(n_quads + 1):
        y = i / n_quads
        for x in (0.0, 1.0):
            positions += [x, y, 0.0]
            uvs += [x, y]
            joints += [0, 1, 0, 0]
            # The top tip has a weight so small it rounds to zero in uint8.
            w1 = 0.0005 if i == n_quads else y
            weights += [1 - w1, w1, 0.0, 0.0]
    nv = len(positions) // 3
    indices = []
    for i in range(n_quads):
        a = i * 2
        indices += [a, a + 1, a + 2, a + 1, a + 3, a + 2]

    pos = accessor(struct.pack(f"<{len(positions)}f", *positions), FLOAT, nv, "VEC3", 34962,
                   min=[0, 0, 0], max=[1, 1, 0])
    uv = accessor(struct.pack(f"<{len(uvs)}f", *uvs), FLOAT, nv, "VEC2", 34962)
    jnt = accessor(struct.pack(f"<{len(joints)}H", *joints), USHORT, nv, "VEC4", 34962)
    wgt = accessor(struct.pack(f"<{len(weights)}f", *weights), FLOAT, nv, "VEC4", 34962)
    idx = accessor(struct.pack(f"<{len(indices)}I", *indices), UINT, len(indices), "SCALAR", 34963,
                   min=[0], max=[nv - 1])
    ibm = accessor(struct.pack("<32f", *([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
                                         + [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -0.5, 0, 1])),
                   FLOAT, 2, "MAT4")
    times = accessor(struct.pack("<3f", 0, 0.5, 1), FLOAT, 3, "SCALAR", min=[0], max=[1])
    rots = accessor(struct.pack("<12f", 0, 0, 0, 1, 0, 0, 0.383, 0.924, 0, 0, 0, 1), FLOAT, 3, "VEC4")

    png = add(_noise_image(texture_size, "PNG"))
    jpg = add(_noise_image(texture_size // 2, "JPEG"))
    unused = add(_noise_image(256, "PNG"))

    js = {
        "asset": {"version": "2.0", "generator": "test"},
        "scene": 0,
        "scenes": [{"nodes": [0, 3]}],
        "nodes": [
            {"name": "Armature", "children": [1]},
            {"name": "root", "children": [2]},
            {"name": "tip", "translation": [0, 0.5, 0]},
            {"name": "body", "mesh": 0, "skin": 0},
        ],
        "skins": [{"joints": [1, 2], "inverseBindMatrices": ibm}],
        "meshes": [{"primitives": [{
            "attributes": {"POSITION": pos, "TEXCOORD_0": uv, "JOINTS_0": jnt, "WEIGHTS_0": wgt},
            "indices": idx, "material": 0}]}],
        "materials": [{
            "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}},
            "emissiveTexture": {"index": 1},
            "normalTexture": {"index": 2, "scale": 1},
        }],
        # Two textures share the PNG, as the pipeline's emissive + base colour do.
        "textures": [{"source": 0, "sampler": 0}, {"source": 0, "sampler": 0}, {"source": 1}],
        "samplers": [{"magFilter": 9729, "minFilter": 9987}],
        "images": [{"bufferView": png, "mimeType": "image/png"},
                   {"bufferView": jpg, "mimeType": "image/jpeg"},
                   {"bufferView": unused, "mimeType": "image/png"}],
        "animations": [{"name": "walk", "channels": [
            {"sampler": 0, "target": {"node": 2, "path": "rotation"}}],
            "samplers": [{"input": times, "output": rots, "interpolation": "LINEAR"}]}],
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(blob)}],
    }
    js_bytes = json.dumps(js).encode()
    js_bytes += b" " * (-len(js_bytes) % 4)
    blob.extend(b"\x00" * (-len(blob) % 4))
    total = 12 + 8 + len(js_bytes) + 8 + len(blob)
    return (struct.pack("<III", 0x46546C67, 2, total)
            + struct.pack("<II", len(js_bytes), 0x4E4F534A) + js_bytes
            + struct.pack("<II", len(blob), 0x004E4942) + bytes(blob))


@pytest.fixture(scope="module")
def walking_glb():
    return make_glb()


# ---------------------------------------------------------------------------
# Reading the result back
# ---------------------------------------------------------------------------

def accessor_bytes(js, blob, i):
    acc = js["accessors"][i]
    bv = js["bufferViews"][acc["bufferView"]]
    start = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    return bytes(blob[start:start + bv["byteLength"]])


def assert_valid_glb(data: bytes):
    """The structural rules a loader trips on, checked on our own output."""
    magic, version, total = struct.unpack("<III", data[:12])
    assert (magic, version, total) == (0x46546C67, 2, len(data))
    js, blob = read_glb(data)
    assert len(js["buffers"]) == 1
    assert 0 <= len(blob) - js["buffers"][0]["byteLength"] <= 3  # chunk padding only
    for bv in js["bufferViews"]:
        assert bv["byteLength"] > 0
        assert bv["byteOffset"] % 4 == 0
        assert bv["byteOffset"] + bv["byteLength"] <= len(blob)
    sizes = {FLOAT: 4, UINT: 4, USHORT: 2, UBYTE: 1}
    comps = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
    for acc in js["accessors"]:
        need = acc["count"] * comps[acc["type"]] * sizes[acc["componentType"]]
        assert js["bufferViews"][acc["bufferView"]]["byteLength"] >= need
    for tex in js["textures"]:
        src = tex.get("source", tex.get("extensions", {}).get("EXT_texture_webp", {}).get("source"))
        img = js["images"][src]
        assert img["mimeType"] in ("image/png", "image/jpeg") or (
            img["mimeType"] == "image/webp" and "source" not in tex
            and "EXT_texture_webp" in js["extensionsRequired"])
    return js, blob


def counts(js):
    return {k: len(js.get(k, [])) for k in ("nodes", "meshes", "skins", "animations", "materials", "textures")}


# ---------------------------------------------------------------------------
# Endpoint, S3 storage (staging and production)
# ---------------------------------------------------------------------------

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


def test_first_request_generates_stores_and_redirects_to_the_optimized_copy(s3, client, walking_glb):
    s3.upload_file(USER, CREATION, "walking.glb", walking_glb)

    r = client.get(f"/api/files/{USER}/{CREATION}/opt_walking.glb")

    assert r.status_code == 302
    assert r.headers["location"].startswith(f"https://bucket.example/{USER}/{CREATION}/opt_walking.glb?")
    data, content_type = s3.objects[f"{USER}/{CREATION}/opt_walking.glb"]
    assert content_type == "model/gltf-binary"
    assert len(data) < len(walking_glb) / 4, f"{len(walking_glb)} -> {len(data)}"


def test_second_request_is_served_from_storage(s3, client, walking_glb):
    s3.upload_file(USER, CREATION, "walking.glb", walking_glb)
    url = f"/api/files/{USER}/{CREATION}/opt_walking.glb"

    first = client.get(url)
    s3.downloads.clear()
    s3.uploads.clear()
    second = client.get(url)

    assert first.status_code == second.status_code == 302
    assert second.headers["location"] == first.headers["location"]
    assert s3.downloads == [], "a cached copy must not download the original again"
    assert s3.uploads == [], "a cached copy must not be regenerated"


def test_optimized_copy_keeps_structure_skin_and_keyframes(s3, client, walking_glb):
    s3.upload_file(USER, CREATION, "walking.glb", walking_glb)
    client.get(f"/api/files/{USER}/{CREATION}/opt_walking.glb")
    data, _ = s3.objects[f"{USER}/{CREATION}/opt_walking.glb"]

    before, before_blob = read_glb(walking_glb)
    after, after_blob = assert_valid_glb(data)

    assert counts(after) == counts(before)
    assert after["nodes"] == before["nodes"]
    assert after["skins"][0]["joints"] == before["skins"][0]["joints"]
    # Keyframes, inverse bind matrices, positions and UVs: byte for byte.
    sampler = after["animations"][0]["samplers"][0]
    assert sampler == before["animations"][0]["samplers"][0]
    for i in (sampler["input"], sampler["output"], before["skins"][0]["inverseBindMatrices"], 0, 1):
        assert accessor_bytes(after, after_blob, i) == accessor_bytes(before, before_blob, i)
        assert after["accessors"][i] == before["accessors"][i]


def test_skin_and_indices_are_packed_to_core_types(s3, client, walking_glb):
    s3.upload_file(USER, CREATION, "walking.glb", walking_glb)
    client.get(f"/api/files/{USER}/{CREATION}/opt_walking.glb")
    js, blob = read_glb(s3.objects[f"{USER}/{CREATION}/opt_walking.glb"][0])
    prim = js["meshes"][0]["primitives"][0]

    idx = js["accessors"][prim["indices"]]
    assert idx["componentType"] == USHORT
    w = js["accessors"][prim["attributes"]["WEIGHTS_0"]]
    assert (w["componentType"], w.get("normalized")) == (UBYTE, True)
    j = js["accessors"][prim["attributes"]["JOINTS_0"]]
    assert j["componentType"] == UBYTE

    weights = accessor_bytes(js, blob, prim["attributes"]["WEIGHTS_0"])
    joints = accessor_bytes(js, blob, prim["attributes"]["JOINTS_0"])
    for v in range(w["count"]):
        assert sum(weights[v * 4:v * 4 + 4]) == 255
    # A weight that rounded to zero no longer names a joint (glTF validator rule).
    assert all(joints[k] == 0 for k in range(len(weights)) if weights[k] == 0)
    original_indices = struct.unpack(f"<{idx['count']}I",
                                     accessor_bytes(*read_glb(walking_glb), prim["indices"]))
    assert struct.unpack(f"<{idx['count']}H", accessor_bytes(js, blob, prim["indices"])) == original_indices


def test_textures_become_webp_through_ext_texture_webp(s3, client, walking_glb):
    s3.upload_file(USER, CREATION, "walking.glb", walking_glb)
    client.get(f"/api/files/{USER}/{CREATION}/opt_walking.glb")
    js, blob = read_glb(s3.objects[f"{USER}/{CREATION}/opt_walking.glb"][0])

    # three.js GLTFLoader reads WebP through this extension; glTF core allows only PNG/JPEG.
    assert "EXT_texture_webp" in js["extensionsUsed"]
    assert "EXT_texture_webp" in js["extensionsRequired"]
    for tex in js["textures"]:
        assert "source" not in tex
    sources = [t["extensions"]["EXT_texture_webp"]["source"] for t in js["textures"]]
    assert sources == [0, 0, 1], "two textures sharing one image still share it"
    for src, size in ((0, 1024), (1, 1024)):
        img = js["images"][src]
        bv = js["bufferViews"][img["bufferView"]]
        decoded = Image.open(io.BytesIO(bytes(blob[bv["byteOffset"]:bv["byteOffset"] + bv["byteLength"]])))
        assert (img["mimeType"], decoded.format, max(decoded.size)) == ("image/webp", "WEBP", size)
    # The image no texture samples is reduced to a 1x1 placeholder.
    bv = js["bufferViews"][js["images"][2]["bufferView"]]
    assert bv["byteLength"] < 100


def test_missing_original_is_a_404_and_stores_nothing(s3, client):
    r = client.get(f"/api/files/{USER}/{CREATION}/opt_walking.glb")

    assert r.status_code == 404
    assert s3.objects == {}


def test_unreadable_original_falls_back_to_the_original(s3, client):
    s3.upload_file(USER, CREATION, "model.glb", b"not a glb")

    r = client.get(f"/api/files/{USER}/{CREATION}/opt_model.glb")

    assert r.status_code == 302
    assert "/model.glb?" in r.headers["location"] and "opt_" not in r.headers["location"]
    assert not s3.file_exists(USER, CREATION, "opt_model.glb")


def test_opt_prefix_on_other_files_is_just_a_file_name(s3, client):
    s3.upload_file(USER, CREATION, "opt_notes.png", b"png")

    r = client.get(f"/api/files/{USER}/{CREATION}/opt_notes.png")

    assert r.status_code == 302 and "/opt_notes.png?" in r.headers["location"]
    assert client.get(f"/api/files/{USER}/{CREATION}/opt_rendered.png").status_code == 404


def test_s3_upload_invalidates_the_optimized_copy():
    store = _real_s3_storage()

    store.upload_file(USER, CREATION, "walking.glb", b"glb")
    store.upload_file(USER, CREATION, "avatar.vrm", b"vrm")
    store.upload_file(USER, CREATION, "opt_walking.glb", b"glb")

    assert store.s3_client.calls == [
        ("put", f"{USER}/{CREATION}/walking.glb", None),
        ("delete", f"{USER}/{CREATION}/thumb_walking.glb", None),
        ("delete", f"{USER}/{CREATION}/opt_walking.glb", None),
        ("put", f"{USER}/{CREATION}/avatar.vrm", None),
        ("delete", f"{USER}/{CREATION}/thumb_avatar.vrm", None),
        ("delete", f"{USER}/{CREATION}/opt_avatar.vrm", None),
        # Storing the copy itself must not delete anything.
        ("put", f"{USER}/{CREATION}/opt_walking.glb", None),
    ]


# ---------------------------------------------------------------------------
# Endpoint, local disk (development)
# ---------------------------------------------------------------------------

@pytest.fixture
def local(tmp_path, monkeypatch):
    monkeypatch.setattr(storage_mod, "FILES_ROOT", str(tmp_path))
    store = storage_mod.LocalFileStorage()
    monkeypatch.setattr(files_api, "get_storage", lambda: store)
    calls = []
    real = files_api.optimize_glb

    def counting(data, **kw):
        calls.append(len(data))
        return real(data, **kw)

    monkeypatch.setattr(files_api, "optimize_glb", counting)
    store.optimize_calls = calls
    return store


def test_local_generates_once_serves_from_disk_and_upload_invalidates(local, client, walking_glb):
    local.upload_file(USER, CREATION, "walking.glb", walking_glb)
    url = f"/api/files/{USER}/{CREATION}/opt_walking.glb"
    cached = local.get_file_path(USER, CREATION, "opt_walking.glb")

    first = client.get(url)
    assert first.status_code == 200
    assert first.headers["content-type"] == "model/gltf-binary"
    assert cached.read_bytes() == first.content
    assert_valid_glb(first.content)

    second = client.get(url)
    assert second.content == first.content
    assert len(local.optimize_calls) == 1, "the stored copy is served, not regenerated"

    smaller = make_glb(texture_size=512, n_quads=10)
    local.upload_file(USER, CREATION, "walking.glb", smaller)
    assert not cached.exists(), "uploading the original must delete its optimized copy"

    third = client.get(url)
    assert len(local.optimize_calls) == 2
    assert read_glb(third.content)[0]["accessors"][0]["count"] == 22


def test_local_regenerates_when_the_pipeline_rewrites_the_original_on_disk(local, client, walking_glb):
    # Locally the pipeline writes outputs straight to disk, not via upload_file.
    original = local.get_file_path(USER, CREATION, "rigged.glb")
    original.write_bytes(walking_glb)
    url = f"/api/files/{USER}/{CREATION}/opt_rigged.glb"
    client.get(url)
    cached = local.get_file_path(USER, CREATION, "opt_rigged.glb")
    old = cached.stat().st_mtime
    os.utime(cached, (old - 60, old - 60))

    original.write_bytes(make_glb(texture_size=512, n_quads=10))
    r = client.get(url)

    assert len(local.optimize_calls) == 2
    assert read_glb(r.content)[0]["accessors"][0]["count"] == 22


def test_local_unreadable_original_is_served_as_is(local, client):
    local.upload_file(USER, CREATION, "model.glb", b"not a glb")

    r = client.get(f"/api/files/{USER}/{CREATION}/opt_model.glb")

    assert r.status_code == 200 and r.content == b"not a glb"
    assert not local.get_file_path(USER, CREATION, "opt_model.glb").exists()


# ---------------------------------------------------------------------------
# The CLI still works, on the module the backend uses
# ---------------------------------------------------------------------------

def test_optimize_vrm_cli_still_works(tmp_path, walking_glb):
    src, dst = tmp_path / "in.glb", tmp_path / "out.glb"
    src.write_bytes(walking_glb)

    out = subprocess.run([sys.executable, str(REPO / "scripts" / "optimize_vrm.py"), str(src), str(dst),
                          "--size=512"], capture_output=True, text=True, check=True)

    assert "MB ->" in out.stdout
    js, _ = read_glb(dst.read_bytes())
    # Its default stays what the games were built on: a data: URI, no extension.
    assert js["images"][0]["uri"].startswith("data:image/webp;base64,")
    assert "extensionsRequired" not in js
    assert counts(js) == counts(read_glb(walking_glb)[0])


def test_rejects_external_buffers():
    js = {"asset": {"version": "2.0"}, "buffers": [{"uri": "x.bin", "byteLength": 4}]}
    data = gltf_optimize.write_glb(js, b"")
    with pytest.raises(gltf_optimize.NotOptimizable):
        gltf_optimize.optimize_glb(data)
