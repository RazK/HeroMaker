"""Turn a GLB of separate parts into a 3MF a slicer opens as separate objects.

Hi3D answers one format per paid task. Rather than pay twice, its split comes
back as GLB (for the viewer) and is converted here for the printer. 3MF is a
zip with one XML mesh per object (3mf.io core spec): millimetres, Z up. glTF
is metres, Y up, so every vertex goes (x, y, z) -> (x, -z, y), and the whole
figure is scaled to `height_mm` tall. Geometry only: a slicer re-colours.
"""
from __future__ import annotations

import io
import zipfile
from typing import Iterable, List, Tuple

import numpy as np

from app.utils.gltf_optimize import read_glb

_COMPONENTS = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def _accessor(js: dict, blob: bytes, index: int) -> np.ndarray:
    acc = js["accessors"][index]
    view = js["bufferViews"][acc["bufferView"]]
    dtype = np.dtype(_COMPONENTS[acc["componentType"]])
    width = _WIDTH[acc["type"]]
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride") or dtype.itemsize * width
    count = acc["count"]
    raw = np.frombuffer(blob, dtype=np.uint8, count=stride * (count - 1) + dtype.itemsize * width, offset=start)
    rows = np.lib.stride_tricks.as_strided(raw, shape=(count, dtype.itemsize * width), strides=(stride, 1))
    return np.ascontiguousarray(rows).view(dtype).reshape(count, width)


def _local(node: dict) -> np.ndarray:
    if "matrix" in node:
        return np.array(node["matrix"], dtype=np.float64).reshape(4, 4).T
    t = np.eye(4)
    t[:3, 3] = node.get("translation", [0, 0, 0])
    x, y, z, w = node.get("rotation", [0, 0, 0, 1])
    r = np.eye(4)
    r[:3, :3] = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]
    s = np.diag(list(node.get("scale", [1, 1, 1])) + [1])
    return t @ r @ s


def parts(glb: bytes) -> List[Tuple[str, np.ndarray, np.ndarray]]:
    """(name, vertices Nx3 in metres Y-up world space, triangles Mx3) per mesh node."""
    js, blob = read_glb(glb)
    blob = bytes(blob)
    out = []

    def walk(index: int, parent: np.ndarray) -> None:
        node = js["nodes"][index]
        world = parent @ _local(node)
        if "mesh" in node:
            verts, tris, base = [], [], 0
            for prim in js["meshes"][node["mesh"]]["primitives"]:
                if prim.get("mode", 4) != 4:
                    continue
                pos = _accessor(js, blob, prim["attributes"]["POSITION"]).astype(np.float64)
                pos = (np.c_[pos, np.ones(len(pos))] @ world.T)[:, :3]
                idx = (_accessor(js, blob, prim["indices"]).reshape(-1).astype(np.int64)
                       if "indices" in prim else np.arange(len(pos)))
                verts.append(pos)
                tris.append(idx.reshape(-1, 3) + base)
                base += len(pos)
            if verts:
                out.append((node.get("name") or f"part{len(out) + 1}", np.vstack(verts), np.vstack(tris)))
        for child in node.get("children", []):
            walk(child, world)

    scene = js.get("scenes", [{}])[js.get("scene", 0)] if js.get("scenes") else {"nodes": range(len(js["nodes"]))}
    for root in scene.get("nodes", []):
        walk(root, np.eye(4))
    return out


def _model_xml(objects: Iterable[Tuple[str, np.ndarray, np.ndarray]]) -> str:
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<model unit="millimeter" xml:lang="en-US" '
             'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
             '<resources>']
    ids = []
    for i, (name, verts, tris) in enumerate(objects, start=1):
        ids.append(i)
        lines.append(f'<object id="{i}" type="model" name="{_esc(name)}"><mesh><vertices>')
        lines.extend(f'<vertex x="{x:.4f}" y="{y:.4f}" z="{z:.4f}"/>' for x, y, z in verts)
        lines.append('</vertices><triangles>')
        lines.extend(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in tris)
        lines.append('</triangles></mesh></object>')
    lines.append('</resources><build>')
    lines.extend(f'<item objectid="{i}"/>' for i in ids)
    lines.append('</build></model>')
    return "\n".join(lines)


def _esc(text: str) -> str:
    return text.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")


CONTENT_TYPES = ('<?xml version="1.0" encoding="UTF-8"?>'
                 '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                 '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                 '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
                 '</Types>')
RELS = ('<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Target="/3D/3dmodel.model" Id="rel0" '
        'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
        '</Relationships>')


def glb_to_3mf(glb: bytes, height_mm: float = 120.0) -> bytes:
    """One 3MF object per part, assembled in place, the figure `height_mm` tall and resting on z=0."""
    found = parts(glb)
    if not found:
        raise ValueError("the GLB has no triangle meshes")
    everything = np.vstack([v for _, v, _ in found])
    low, high = everything.min(axis=0), everything.max(axis=0)
    scale = height_mm / max(high[1] - low[1], 1e-9)
    centre = (low + high) / 2
    objects = []
    for name, verts, tris in found:
        v = (verts - [centre[0], low[1], centre[2]]) * scale
        objects.append((name, np.c_[v[:, 0], -v[:, 2], v[:, 1]], tris))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", RELS)
        z.writestr("3D/3dmodel.model", _model_xml(objects))
    return out.getvalue()
