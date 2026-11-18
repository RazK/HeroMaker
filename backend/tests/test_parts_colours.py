"""The toy's pieces come out in the hero's own colours, whatever the provider sent.

Hi3D's split multiplies the right texture by a flat label colour per part
(a blue head, a green leg). These tests drive the real path: the routes, the
split service, storage and app/utils/parts_colours.py. Only Hi3D is a
stand-in, and what it "sends" is a small figure built the way its file is.

Each one fails if a piece's average colour is far from the hero's model at
the same place.
"""
import io
import json
import struct

import numpy as np
import pytest
from PIL import Image

from app.services import hi3d as hi3d_module
from app.services import print_split
from app.utils import parts_colours
from app.utils.gltf_optimize import read_glb
from app.utils.storage import get_storage
from test_print_split import FakeHi3d
from test_public_api import _jwt, client  # noqa: F401

SKIN, RED, BLUE, GREEN = (224, 172, 105), (200, 30, 30), (34, 121, 181), (53, 164, 53)
NEAR = 10.0  # a piece this near the model (0-255, mean per channel) is the right colour


def _png(top, bottom) -> bytes:
    """A texture: the top half one colour, the bottom half another."""
    pixels = np.zeros((64, 64, 3), dtype=np.uint8)
    pixels[:32], pixels[32:] = top, bottom
    out = io.BytesIO()
    Image.fromarray(pixels).save(out, format="PNG")
    return out.getvalue()


def _sheet(y0: float, y1: float):
    """A standing sheet 1 m wide from height y0 to y1: positions, UVs (the whole figure is 0-2 m), triangles."""
    xs, ys = np.linspace(-0.5, 0.5, 21), np.linspace(y0, y1, 21)
    x, y = np.meshgrid(xs, ys)
    pos = np.c_[x.ravel(), y.ravel(), np.zeros(x.size)].astype(np.float32)
    uv = np.c_[pos[:, 0] + 0.5, 1 - pos[:, 1] / 2].astype(np.float32)
    quad = np.array([[r * 21 + c, r * 21 + c + 1, (r + 1) * 21 + c, r * 21 + c + 1, (r + 1) * 21 + c + 1, (r + 1) * 21 + c]
                     for r in range(20) for c in range(20)], dtype=np.uint16)
    return pos, uv, quad.ravel()


def _glb(pieces, png: bytes | None) -> bytes:
    """A GLB of `pieces`: (name, (positions, uvs, triangles), label colour or None), all on one texture."""
    js = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": list(range(len(pieces)))}], "nodes": [],
          "meshes": [], "accessors": [], "bufferViews": [],
          "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "roughnessFactor": 0.9}}]}
    blob = bytearray()

    def view(data: bytes) -> int:
        blob.extend(b"\0" * (-len(blob) % 4))
        js["bufferViews"].append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data)})
        blob.extend(data)
        return len(js["bufferViews"]) - 1

    def accessor(array: np.ndarray, kind: str, component: int, **more) -> int:
        js["accessors"].append({"bufferView": view(array.tobytes()), "componentType": component,
                                "count": len(array), "type": kind, **more})
        return len(js["accessors"]) - 1

    if png is not None:
        js["images"] = [{"bufferView": view(png), "mimeType": "image/png"}]
        js["textures"] = [{"source": 0}]
        js["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"] = {"index": 0}
    for name, (pos, uv, tris), label in pieces:
        attrs = {"POSITION": accessor(pos, "VEC3", 5126, min=pos.min(0).tolist(), max=pos.max(0).tolist()),
                 "TEXCOORD_0": accessor(uv, "VEC2", 5126)}
        if label is not None:
            rgba = np.tile(np.array([*label, 255], dtype=np.uint8), (len(pos), 1))
            attrs["COLOR_0"] = accessor(rgba, "VEC4", 5121, normalized=True)
        js["meshes"].append({"name": name, "primitives": [
            {"attributes": attrs, "indices": accessor(tris, "SCALAR", 5123), "material": 0}]})
        js["nodes"].append({"name": name, "mesh": len(js["meshes"]) - 1})
    js["buffers"] = [{"byteLength": len(blob)}]
    j = json.dumps(js).encode()
    j += b" " * (-len(j) % 4)
    blob.extend(b"\0" * (-len(blob) % 4))
    body = struct.pack("<II", len(j), 0x4E4F534A) + j + struct.pack("<II", len(blob), 0x004E4942) + bytes(blob)
    return struct.pack("<III", 0x46546C67, 2, 12 + len(body)) + body


# The hero: skin above the waist, red below. And its toy, cut at the waist.
MODEL = _glb([("hero", _sheet(0, 2), None)], _png(SKIN, RED))
HEAD, LEGS = _sheet(1, 2), _sheet(0, 1)
AS_HI3D_SENDS_IT = _glb([("Head", HEAD, BLUE), ("Legs", LEGS, GREEN)], _png(SKIN, RED))


def _errors(parts: bytes) -> dict:
    return {row["name"]: row["error"] for row in parts_colours.colour_errors(parts, MODEL)}


def _colours_of(parts: bytes) -> list:
    js, _ = read_glb(parts)
    return [("COLOR_0" in prim["attributes"],
             "baseColorTexture" in js["materials"][prim["material"]]["pbrMetallicRoughness"])
            for mesh in js["meshes"] for prim in mesh["primitives"]]


@pytest.fixture
def hero(db, make_user, make_creation, completed_steps):
    creation = make_creation(make_user().id, completed_steps)
    db.commit()
    get_storage().upload_file(creation.user_id, creation.id, "model.glb", MODEL, content_type="model/gltf-binary")
    return creation


@pytest.fixture
def hi3d(monkeypatch):
    fake = FakeHi3d()
    fake.sends = AS_HI3D_SENDS_IT
    monkeypatch.setattr(hi3d_module, "Hi3dClient", lambda: fake)
    monkeypatch.setattr(print_split, "_download", lambda url: fake.sends if url.endswith(".glb") else b"a cover")
    monkeypatch.setattr(print_split, "POLL_SECONDS", 0)
    return fake


def _make(client, make_user, hero, hi3d) -> dict:
    """An admin makes the toy; Hi3D answers. What the app then reads."""
    admin = _jwt(make_user(is_admin=True))
    url = f"/api/v1/heroes/{hero.id}/action-figure"
    assert client.post(url, headers=admin).status_code == 202
    hi3d.task = {"state": "success", "url": "https://hi3d/parts.glb", "cover_url": "https://hi3d/cover.png"}
    done = client.get(url, headers=admin).json()
    assert done["status"] == "succeeded", done
    return done


def _stored(hero, name: str = "split.glb") -> bytes:
    return get_storage().download_file(hero.user_id, hero.id, name)


def test_the_fixture_is_wrong_the_way_hi3ds_file_is():
    """As sent, the head is blue and the legs are green: far from the model."""
    before = _errors(AS_HI3D_SENDS_IT)
    assert before["Head"] > 40 and before["Legs"] > 40, before


def test_a_new_toy_is_stored_in_the_heros_own_colours(client, make_user, hero, hi3d):
    done = _make(client, make_user, hero, hi3d)

    after = _errors(_stored(hero))
    assert after["Head"] < NEAR and after["Legs"] < NEAR, after
    # The labels are gone and the texture stays: (vertex colours, texture) per piece.
    assert _colours_of(_stored(hero)) == [(False, True), (False, True)]
    # Hi3D's cover shows its label colours: it is not kept.
    assert done["files"]["preview"] is None
    assert not get_storage().file_exists(hero.user_id, hero.id, "split_preview.png")
    assert print_split.read_state(hero)["colours"]["labels"] == 2


def test_a_toy_stored_before_the_repair_is_put_right_when_anyone_reads_it(client, hero, monkeypatch):
    """Ruby Red: made when the labels were stored as sent. No new split, no provider, no admin."""
    storage = get_storage()
    put = lambda name, data: storage.upload_file(hero.user_id, hero.id, name, data)  # noqa: E731
    put("split.glb", AS_HI3D_SENDS_IT)
    put("opt_split.glb", b"the viewer's copy, made from the labelled file")
    put("split.3mf", b"3mf")
    put("split_preview.png", b"hi3d's cover")
    put("print_split.json", json.dumps({
        "provider": "hi3d", "task_id": "bf1efa5e727a4edc", "status": "SUCCEEDED", "progress": 100, "part": "a",
        "joint": "ball", "part_count": 6, "files": ["split.glb", "split.3mf", "split_preview.png"],
        "kind": "action_figure", "checked": 0}).encode())
    monkeypatch.setattr(hi3d_module, "Hi3dClient", lambda: pytest.fail("the provider must not be asked"))
    calls = []
    real = parts_colours.true_colours
    monkeypatch.setattr(parts_colours, "true_colours", lambda *a: calls.append(1) or real(*a))

    url = f"/api/v1/heroes/{hero.id}/action-figure"
    seen = client.get(url).json()  # signed out
    assert seen["status"] == "succeeded", seen

    after = _errors(_stored(hero))
    assert after["Head"] < NEAR and after["Legs"] < NEAR, after
    assert not storage.file_exists(hero.user_id, hero.id, "opt_split.glb"), "the stale viewer copy must go"
    assert not storage.file_exists(hero.user_id, hero.id, "split_preview.png")
    assert seen["files"]["preview"] is None and seen["files"]["parts_3mf"]
    # A new address, so a browser does not show the file it kept from before.
    assert seen["files"]["parts_view"].endswith("?v=bf1efa5e727a.c1")
    # Once: the next read repairs nothing.
    assert client.get(url).json()["files"] == seen["files"]
    assert len(calls) == 1


def test_a_piece_with_the_wrong_texture_is_painted_from_the_model(client, make_user, hero, hi3d):
    """Not Hi3D's fault today, but any provider's tomorrow: the texture itself is wrong."""
    hi3d.sends = _glb([("Head", HEAD, None), ("Legs", LEGS, None)], _png(BLUE, GREEN))
    assert min(_errors(hi3d.sends).values()) > 40
    _make(client, make_user, hero, hi3d)

    after = _errors(_stored(hero))
    assert after["Head"] < NEAR and after["Legs"] < NEAR, after
    # Each piece now carries its colours itself, and its material has no texture.
    assert _colours_of(_stored(hero)) == [(True, False), (True, False)]
    assert print_split.read_state(hero)["colours"]["painted"] == 2


def test_label_colours_and_no_texture_are_painted_from_the_model(client, make_user, hero, hi3d):
    hi3d.sends = _glb([("Head", HEAD, BLUE), ("Legs", LEGS, GREEN)], None)
    _make(client, make_user, hero, hi3d)
    after = _errors(_stored(hero))
    assert after["Head"] < NEAR and after["Legs"] < NEAR, after


def test_a_toy_already_in_the_right_colours_is_stored_as_sent(client, make_user, hero, hi3d):
    hi3d.sends = _glb([("Head", HEAD, None), ("Legs", LEGS, None)], _png(SKIN, RED))
    _make(client, make_user, hero, hi3d)
    assert _stored(hero) == hi3d.sends
    assert print_split.read_state(hero)["colours"] == {"v": print_split.COLOURS, "labels": 0, "painted": 0,
                                                       "worst": pytest.approx(0, abs=NEAR)}


def test_without_a_model_to_compare_with_the_texture_is_the_colour(client, make_user, hero, hi3d):
    """A model.glb that cannot be read: labels beside a texture are still dropped."""
    get_storage().upload_file(hero.user_id, hero.id, "model.glb", b"glTF not really", content_type="model/gltf-binary")
    _make(client, make_user, hero, hi3d)
    assert _colours_of(_stored(hero)) == [(False, True), (False, True)]
    assert max(_errors(_stored(hero)).values()) < NEAR
