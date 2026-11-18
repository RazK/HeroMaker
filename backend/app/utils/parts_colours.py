"""Give every piece of a cut figure the hero's own colours.

A provider that cuts a hero into parts sends back a new file, and its colours
are the provider's business. Hi3D's GLB carries the right texture AND a flat
label colour per part in COLOR_0 (blue head, green leg, orange arm). glTF
multiplies the two, so every viewer drew a blue face and one green leg.

The hero's own model.glb is the truth. For each piece, the colour a viewer
would draw (texture x vertex colour x factor) is compared with the model's
colour at the same place, on the piece's points that lie on the model's
surface (a cut face or a joint has no colour to compare with):

1. Drawn as it is, the piece is near the model: it is left alone.
2. Its texture alone is nearer: the vertex colours are labels and are dropped.
3. Still far (a wrong texture, or labels and no texture): the piece is painted
   from the model, a colour per vertex taken from the model's surface. A point
   of the model belongs to a piece only when it is clearly nearer to it than
   to any other piece, so a joint ball inside the body takes the limb's colour
   and not the body's.

So the result does not depend on the provider. With no readable model, or for
a piece that does not lie on it, only the plain rule is left: on a textured
piece the texture is the colour, and vertex colours beside it are dropped.

Colours are compared as a screen shows them (sRGB, 0-255); COLOR_0 and the
factor are linear, as the glTF spec has them.
"""
from __future__ import annotations

import copy
import io
import logging
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

from app.utils.glb_to_3mf import _accessor, _local
from app.utils.gltf_optimize import _drop_empty_views, _repackable, _view_users, read_glb, write_glb

logger = logging.getLogger(__name__)

# A point of a piece is "on the model" within this share of the model's size.
ON_SURFACE = 0.003
# A piece is judged only when this share of its points is on the model (else it is not this model's piece).
MIN_ON_SURFACE = 0.5
# The texture alone must be this much nearer (0-255, mean per channel) for vertex colours to count as labels.
LABEL_MARGIN = 2.0
# A piece still this far from the model is painted from it.
FAR = 40.0
# At most this many points of a piece are compared.
SAMPLE = 20000
# A model point is a piece's own when the next piece is this much further (share of the model's size).
OWN_MARGIN = 0.004


def _to_linear(srgb: np.ndarray) -> np.ndarray:
    c = np.clip(srgb / 255.0, 0, 1)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _to_srgb(linear: np.ndarray) -> np.ndarray:
    c = np.clip(linear, 0, 1)
    return 255.0 * np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def _unit(values: np.ndarray) -> np.ndarray:
    """An accessor's numbers as 0-1 floats (normalised integers are scaled)."""
    if values.dtype.kind == "f":
        return values.astype(np.float64)
    return values.astype(np.float64) / np.iinfo(values.dtype).max


class _File:
    """A GLB opened for reading colours."""

    def __init__(self, data: bytes):
        self.js, blob = read_glb(data)
        self.blob = bytes(blob)
        self._images: Dict[int, Optional[np.ndarray]] = {}

    def prims(self) -> List[Tuple[str, np.ndarray, dict]]:
        """(piece name, world matrix, primitive) for every triangle primitive, each once."""
        js, out, seen = self.js, [], set()

        def walk(index: int, parent: np.ndarray) -> None:
            node = js["nodes"][index]
            world = parent @ _local(node)
            if "mesh" in node:
                mesh = js["meshes"][node["mesh"]]
                for p, prim in enumerate(mesh["primitives"]):
                    if prim.get("mode", 4) == 4 and (node["mesh"], p) not in seen:
                        seen.add((node["mesh"], p))
                        out.append((node.get("name") or mesh.get("name") or f"part{len(out) + 1}", world, prim))
            for child in node.get("children", []):
                walk(child, world)

        scenes = js.get("scenes")
        roots = scenes[js.get("scene", 0)].get("nodes", []) if scenes else range(len(js.get("nodes", [])))
        for root in roots:
            walk(root, np.eye(4))
        return out

    def positions(self, world: np.ndarray, prim: dict) -> np.ndarray:
        pos = _accessor(self.js, self.blob, prim["attributes"]["POSITION"]).astype(np.float64)
        return (np.c_[pos, np.ones(len(pos))] @ world.T)[:, :3]

    def _image(self, texture: int) -> Optional[np.ndarray]:
        tex = self.js["textures"][texture]
        source = tex.get("source")
        if source is None:
            source = (tex.get("extensions") or {}).get("EXT_texture_webp", {}).get("source")
        if source is None:
            return None
        if source not in self._images:
            img = self.js["images"][source]
            pixels = None
            if "bufferView" in img:
                view = self.js["bufferViews"][img["bufferView"]]
                start = view.get("byteOffset", 0)
                try:
                    pixels = np.asarray(Image.open(io.BytesIO(self.blob[start:start + view["byteLength"]])).convert("RGB"))
                except Exception:  # an image PIL cannot read: its piece cannot be judged
                    pixels = None
            self._images[source] = pixels
        return self._images[source]

    def shown(self, prim: dict, rows: np.ndarray, *, vertex_colours: bool = True) -> Optional[np.ndarray]:
        """The colours a viewer draws at these vertices (sRGB 0-255), or None when they cannot be told."""
        mat = self.js["materials"][prim["material"]] if "material" in prim else {}
        pbr = mat.get("pbrMetallicRoughness", {})
        linear = np.ones((len(rows), 3)) * np.array(pbr.get("baseColorFactor", [1, 1, 1, 1])[:3], dtype=np.float64)
        tex = pbr.get("baseColorTexture")
        if tex is not None:
            uv_index = prim["attributes"].get(f"TEXCOORD_{tex.get('texCoord', 0)}")
            pixels = self._image(tex["index"])
            if tex.get("extensions") or uv_index is None or pixels is None:
                return None
            uv = _unit(_accessor(self.js, self.blob, uv_index))[rows]
            h, w = pixels.shape[:2]
            x = np.clip(((uv[:, 0] % 1.0) * w).astype(np.int64), 0, w - 1)
            y = np.clip(((uv[:, 1] % 1.0) * h).astype(np.int64), 0, h - 1)
            linear *= _to_linear(pixels[y, x].astype(np.float64))
        if vertex_colours and "COLOR_0" in prim["attributes"]:
            linear *= _unit(_accessor(self.js, self.blob, prim["attributes"]["COLOR_0"]))[rows, :3]
        return _to_srgb(linear)

    def has_texture(self, prim: dict) -> bool:
        mat = self.js["materials"][prim["material"]] if "material" in prim else {}
        return "baseColorTexture" in mat.get("pbrMetallicRoughness", {})


class _Model:
    """The hero's own model: where its surface is and what colour it is there."""

    def __init__(self, data: bytes):
        f = _File(data)
        points, colours = [], []
        for _, world, prim in f.prims():
            pos = f.positions(world, prim)
            col = f.shown(prim, np.arange(len(pos)))
            if col is not None and (f.has_texture(prim) or "COLOR_0" in prim["attributes"]):
                points.append(pos)
                colours.append(col)
        if not points:
            raise ValueError("the model has no colours to read")
        self.points = np.vstack(points)
        self.colours = np.vstack(colours)
        self.size = float(np.max(self.points.max(axis=0) - self.points.min(axis=0))) or 1.0
        self.tree = cKDTree(self.points)


def _open_model(model_glb: Optional[bytes]) -> Optional[_Model]:
    if not model_glb:
        return None
    try:
        return _Model(model_glb)
    except Exception as e:  # no model to compare with: the plain rule applies
        logger.info("parts colours: the model cannot be read (%s)", e)
        return None


def _sample(count: int) -> np.ndarray:
    return np.arange(0, count, max(1, -(-count // SAMPLE)))


def _judge(model: _Model, pos: np.ndarray) -> Optional[Tuple[np.ndarray, np.ndarray]]:
    """(which of these points are on the model, the model's colour at each), or None: not this model's piece."""
    dist, nearest = model.tree.query(pos)
    on = dist < ON_SURFACE * model.size
    if not len(pos) or on.mean() < MIN_ON_SURFACE:
        return None
    return on, model.colours[nearest]


def _error(colours: Optional[np.ndarray], on: np.ndarray, truth: np.ndarray) -> Optional[float]:
    if colours is None:
        return None
    return float(np.abs(colours[on] - truth[on]).mean())


def colour_errors(parts_glb: bytes, model_glb: bytes) -> List[Dict[str, Any]]:
    """How far each piece, as a viewer draws it, is from the model at the same place.

    `error` is the mean difference per colour channel (0-255) over the piece's
    points on the model's surface; None when the piece cannot be compared.
    """
    model = _Model(model_glb)
    f = _File(parts_glb)
    out = []
    for name, world, prim in f.prims():
        pos = f.positions(world, prim)
        rows = _sample(len(pos))
        judged = _judge(model, pos[rows])
        error = _error(f.shown(prim, rows), *judged) if judged else None
        out.append({"name": name, "error": error, "on_surface": float(judged[0].mean()) if judged else 0.0})
    return out


def _owners(model: _Model, pieces: List[np.ndarray]) -> List[np.ndarray]:
    """For each piece, the model points that are its own: clearly nearer to it than to any other piece."""
    samples = [p[_sample(len(p))] for p in pieces]
    labels = np.concatenate([np.full(len(s), i) for i, s in enumerate(samples)])
    k = min(8, len(labels))
    dist, near = cKDTree(np.vstack(samples)).query(model.points, k=k)
    dist, near = dist.reshape(len(model.points), k), labels[near.reshape(len(model.points), k)]
    other = near != near[:, :1]
    # The distance to the nearest point of a different piece (none among the neighbours: far away).
    second = np.where(other.any(axis=1), dist[np.arange(len(dist)), other.argmax(axis=1)], np.inf)
    own = second - dist[:, 0] > OWN_MARGIN * model.size
    return [np.flatnonzero(own & (near[:, 0] == i)) for i in range(len(pieces))]


def _paint(model: _Model, pos: np.ndarray, own: np.ndarray) -> np.ndarray:
    """A colour per vertex (sRGB 0-255) from the model's surface: the piece's own points of it."""
    if len(own) < 16:
        own = np.arange(len(model.points))
    points, colours = model.points[own], model.colours[own]
    k = min(16, len(points))
    dist, near = cKDTree(points).query(pos, k=k)
    dist, near = dist.reshape(len(pos), k), near.reshape(len(pos), k)
    # On the surface: the nearest few, the nearer the heavier.
    few = min(4, k)
    weight = 1.0 / np.maximum(dist[:, :few], 1e-9)
    out = (colours[near[:, :few]] * weight[:, :, None]).sum(axis=1) / weight.sum(axis=1, keepdims=True)
    # Off it (a cut face, a joint): the middle colour of the neighbourhood, so it does not speckle.
    off = dist[:, 0] >= ON_SURFACE * model.size
    if off.any():
        out[off] = np.median(colours[near[off]], axis=1)
    return out


def _referenced_accessors(js: dict) -> set:
    used = set()
    for mesh in js.get("meshes", []):
        for prim in mesh.get("primitives", []):
            used.update(prim.get("attributes", {}).values())
            if "indices" in prim:
                used.add(prim["indices"])
            for target in prim.get("targets", []):
                used.update(target.values())
    for skin in js.get("skins", []):
        if "inverseBindMatrices" in skin:
            used.add(skin["inverseBindMatrices"])
    for anim in js.get("animations", []):
        for sampler in anim.get("samplers", []):
            used.update((sampler["input"], sampler["output"]))
    return used


def true_colours(parts_glb: bytes, model_glb: Optional[bytes]) -> Tuple[bytes, List[Dict[str, Any]]]:
    """The parts with every piece in the hero's own colours, and what was done to each.

    Each report row: name, did ("kept", "labels" dropped, "painted" from the
    model, or "unjudged"), and the error before and after (see colour_errors).
    Bytes come back unchanged when nothing had to change.
    """
    f = _File(parts_glb)
    js = f.js
    buffers = js.get("buffers", [])
    if len(buffers) > 1 or any("uri" in b for b in buffers):
        raise ValueError("only a self-contained single-buffer GLB can be recoloured")
    model = _open_model(model_glb)
    prims = f.prims()
    positions = [f.positions(world, prim) for _, world, prim in prims]

    report: List[Dict[str, Any]] = []
    dropped: List[int] = []            # accessors no longer a COLOR_0
    added: List[bytes] = []            # new bufferViews' bytes
    plain: Dict[Optional[int], int] = {}  # material -> its copy with no texture
    owners: Optional[List[np.ndarray]] = None

    for i, (name, _, prim) in enumerate(prims):
        attrs = prim["attributes"]
        row: Dict[str, Any] = {"name": name, "did": "kept", "before": None, "after": None}
        report.append(row)
        rows = _sample(len(positions[i]))
        judged = _judge(model, positions[i][rows]) if model else None
        labelled = "COLOR_0" in attrs and f.has_texture(prim)
        if judged is None:
            row["did"] = "unjudged"
            # Nothing to compare with: on a textured piece the texture is the colour.
            if labelled:
                dropped.append(attrs.pop("COLOR_0"))
                row["did"] = "labels"
            continue
        on, truth = judged
        row["before"] = row["after"] = _error(f.shown(prim, rows), on, truth)
        if row["before"] is None:
            row["did"] = "unjudged"
            continue
        if labelled:
            alone = _error(f.shown(prim, rows, vertex_colours=False), on, truth)
            if alone is not None and alone + LABEL_MARGIN < row["after"]:
                dropped.append(attrs.pop("COLOR_0"))
                row.update(did="labels", after=alone)
        if row["after"] > FAR:
            if owners is None:
                owners = _owners(model, positions)
            colours = _paint(model, positions[i], owners[i])
            rgba = np.c_[_to_linear(colours), np.ones(len(colours))]
            added.append(np.round(rgba * 65535).astype("<u2").tobytes())
            if "COLOR_0" in attrs:
                dropped.append(attrs["COLOR_0"])
            attrs["COLOR_0"] = len(js["accessors"])
            js["accessors"].append({"bufferView": len(js.get("bufferViews", [])) + len(added) - 1, "componentType": 5123,
                                    "normalized": True, "count": len(colours), "type": "VEC4"})
            # The vertex colours are now the whole colour: the material keeps its finish, not its texture.
            old = prim.get("material")
            if old not in plain:
                mat = copy.deepcopy(js["materials"][old]) if old is not None else {}
                pbr = mat.setdefault("pbrMetallicRoughness", {})
                pbr.pop("baseColorTexture", None)
                pbr["baseColorFactor"] = [1.0, 1.0, 1.0, 1.0]
                js.setdefault("materials", []).append(mat)
                plain[old] = len(js["materials"]) - 1
            prim["material"] = plain[old]
            row.update(did="painted", after=_error(colours[rows], on, truth))

    if not dropped and not added:
        return parts_glb, report

    # Rebuild the binary chunk: the dropped colours' bytes go, the painted ones are added.
    views = js.setdefault("bufferViews", [])
    users = _view_users(js)
    still = _referenced_accessors(js)
    emptied = set()
    for index in set(dropped) - still:
        acc = js["accessors"][index]
        if _repackable(js, acc, users):
            emptied.add(acc.pop("bufferView"))
    blob = bytearray()
    for index, view in enumerate(views):
        start = view.get("byteOffset", 0)
        payload = b"" if index in emptied else f.blob[start:start + view["byteLength"]]
        blob += b"\x00" * (-len(blob) % 4)
        view["byteOffset"] = len(blob)
        view["byteLength"] = len(payload)
        blob += payload
    for payload in added:
        blob += b"\x00" * (-len(blob) % 4)
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(payload)})
        blob += payload
    _drop_empty_views(js)
    js["buffers"] = [{"byteLength": len(blob)}]
    return write_glb(js, blob), report
