"""
Shrink a pipeline GLB/VRM for web delivery.

The models the creation view loads are enormous. Measured on production,
`walking.glb` is 7.38 MB: a 2048x2048 PNG texture, plus skinning attributes
stored in far wider types than they need, plus (on VRMs) a meta thumbnail that
nothing ever renders. Downloading that is why the 3D stage sat empty for
seconds on a phone, and why the rail tile that snapshots it took even longer.

Re-encoding the texture as WebP at 1024px and packing the attributes down takes
the same file to 1.53 MB with no visible difference - verified by loading both
in three.js and comparing mesh count, triangle count, bone count, animation
clips and painted pixels (77191 vs 77159, a 0.04% difference).

This works on bytes rather than paths because production storage is S3, and it
is deliberately non-destructive: callers write the result alongside the original
under a `web_` name, so downloads and VRM sharing keep the untouched file.

One caveat worth knowing: the re-encoded texture is a `data:image/webp` URI
without declaring `EXT_texture_webp`. Browsers decode it through a plain <img>
so three.js is happy, but a strict glTF validator would object. That is why this
output is only ever served to the web preview, never offered as the download.

The CLI equivalent lives at scripts/optimize_vrm.py; when that branch merges,
it should become a thin wrapper over this module rather than a second copy.
"""
import base64
import io
import json
import logging
import struct
from typing import Optional

logger = logging.getLogger(__name__)

GLB_MAGIC = 0x46546C67
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942

UNSIGNED_BYTE, UNSIGNED_SHORT, UNSIGNED_INT, FLOAT = 5121, 5123, 5125, 5126

COMPONENT_SIZE = {UNSIGNED_BYTE: 1, UNSIGNED_SHORT: 2, UNSIGNED_INT: 4, FLOAT: 4}
COMPONENT_COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}

DEFAULT_TEXTURE_SIZE = 1024
DEFAULT_QUALITY = 88


def _read_glb(data: bytes):
    magic, _version, _length = struct.unpack("<III", data[:12])
    if magic != GLB_MAGIC:
        raise ValueError("not a GLB")
    js, blob, off = None, b"", 12
    while off < len(data):
        clen, ctype = struct.unpack("<II", data[off:off + 8])
        chunk = data[off + 8:off + 8 + clen]
        if ctype == JSON_CHUNK:
            js = json.loads(chunk.decode("utf-8"))
        elif ctype == BIN_CHUNK:
            blob = chunk
        off += 8 + clen
    if js is None:
        raise ValueError("GLB has no JSON chunk")
    return js, bytearray(blob)


def _write_glb(js, blob: bytearray) -> bytes:
    js_bytes = json.dumps(js, separators=(",", ":")).encode("utf-8")
    js_bytes += b" " * (-len(js_bytes) % 4)
    blob = bytearray(blob)
    blob += b"\x00" * (-len(blob) % 4)
    total = 12 + 8 + len(js_bytes) + 8 + len(blob)
    out = bytearray()
    out += struct.pack("<III", GLB_MAGIC, 2, total)
    out += struct.pack("<II", len(js_bytes), JSON_CHUNK) + js_bytes
    out += struct.pack("<II", len(blob), BIN_CHUNK) + bytes(blob)
    return bytes(out)


def _accessor_bytes(js, blob, accessor):
    """Raw bytes of one accessor, honouring a strided bufferView."""
    bv = js["bufferViews"][accessor["bufferView"]]
    comp = accessor["componentType"]
    n = COMPONENT_COUNT[accessor["type"]]
    elem = COMPONENT_SIZE[comp] * n
    stride = bv.get("byteStride") or elem
    base = bv.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    if stride == elem:
        return bytes(blob[base:base + elem * accessor["count"]])
    return b"".join(
        bytes(blob[base + i * stride:base + i * stride + elem]) for i in range(accessor["count"])
    )


def _pack_attributes(js, blob):
    """
    Narrow indices and joint indices to the smallest type that still fits.

    Meshy hands back UNSIGNED_INT indices and joints for a model with 24 bones
    and 30k triangles - four bytes each where one or two would do.
    """
    repacked = {}

    def narrow(accessor_index, candidates):
        acc = js["accessors"][accessor_index]
        if "bufferView" not in acc:
            return
        comp = acc["componentType"]
        if comp not in COMPONENT_SIZE or comp == FLOAT:
            return
        raw = _accessor_bytes(js, blob, acc)
        fmt = {UNSIGNED_BYTE: "B", UNSIGNED_SHORT: "H", UNSIGNED_INT: "I"}[comp]
        n = COMPONENT_COUNT[acc["type"]] * acc["count"]
        values = struct.unpack("<" + fmt * n, raw[:struct.calcsize("<" + fmt * n)])
        biggest = max(values) if values else 0
        for target, limit in candidates:
            if biggest <= limit and COMPONENT_SIZE[target] < COMPONENT_SIZE[comp]:
                tfmt = {UNSIGNED_BYTE: "B", UNSIGNED_SHORT: "H", UNSIGNED_INT: "I"}[target]
                repacked[acc["bufferView"]] = struct.pack("<" + tfmt * n, *values)
                acc["componentType"] = target
                acc["byteOffset"] = 0
                js["bufferViews"][acc["bufferView"]].pop("byteStride", None)
                return

    def quantise_weights(accessor_index):
        """
        float32 skin weights -> normalized uint8, four bytes a vertex instead of
        sixteen. Re-normalised so every vertex still sums to exactly 255, which
        is what stops a quantised rig drifting at the joints.
        """
        acc = js["accessors"][accessor_index]
        if acc.get("componentType") != FLOAT or "bufferView" not in acc:
            return
        raw = _accessor_bytes(js, blob, acc)
        n = acc["count"] * 4
        values = struct.unpack("<" + "f" * n, raw[:struct.calcsize("<" + "f" * n)])
        packed = bytearray()
        for v in range(acc["count"]):
            w = values[v * 4:v * 4 + 4]
            total = sum(w) or 1.0
            q = [min(255, max(0, round(x / total * 255))) for x in w]
            drift = 255 - sum(q)
            biggest = q.index(max(q))
            q[biggest] = min(255, max(0, q[biggest] + drift))
            packed += bytes(q)
        repacked[acc["bufferView"]] = bytes(packed)
        acc["componentType"] = UNSIGNED_BYTE
        acc["normalized"] = True
        acc["byteOffset"] = 0
        js["bufferViews"][acc["bufferView"]].pop("byteStride", None)

    for mesh in js.get("meshes", []):
        for prim in mesh.get("primitives", []):
            if "indices" in prim:
                narrow(prim["indices"], [(UNSIGNED_SHORT, 0xFFFF)])
            for name, idx in prim.get("attributes", {}).items():
                if name.startswith("JOINTS_"):
                    narrow(idx, [(UNSIGNED_BYTE, 0xFF), (UNSIGNED_SHORT, 0xFFFF)])
                elif name.startswith("WEIGHTS_"):
                    quantise_weights(idx)
    return repacked


def optimize_glb(
    data: bytes,
    max_texture: int = DEFAULT_TEXTURE_SIZE,
    quality: int = DEFAULT_QUALITY,
) -> Optional[bytes]:
    """
    Return a smaller GLB with the same geometry, skeleton and animations.

    Returns None if the input is not a GLB or cannot be processed - the caller
    should then serve the original rather than nothing.
    """
    try:
        from PIL import Image

        js, blob = _read_glb(data)
        views = js.get("bufferViews", [])
        images = js.get("images", [])

        # Which images does a material actually sample? Anything else - notably
        # the VRM meta thumbnail - is pure weight.
        used_textures = set()

        def collect(node):
            if isinstance(node, dict):
                if "index" in node and set(node) <= {"index", "texCoord", "scale", "strength", "extensions", "extras"}:
                    used_textures.add(node["index"])
                for value in node.values():
                    collect(value)
            elif isinstance(node, list):
                for value in node:
                    collect(value)

        collect(js.get("materials", []))
        textures = js.get("textures", [])
        used_images = {textures[t]["source"] for t in used_textures if t < len(textures)}

        new_payloads = {}
        for idx, img in enumerate(images):
            if "bufferView" not in img:
                new_payloads[idx] = (b"", None)
                continue
            bv = views[img["bufferView"]]
            start = bv.get("byteOffset", 0)
            raw = bytes(blob[start:start + bv["byteLength"]])
            if idx not in used_images:
                new_payloads[idx] = (b"", None)
                continue
            im = Image.open(io.BytesIO(raw))
            im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
            if max(im.size) > max_texture:
                scale = max_texture / max(im.size)
                im = im.resize(
                    (max(1, round(im.width * scale)), max(1, round(im.height * scale))),
                    Image.LANCZOS,
                )
            buf = io.BytesIO()
            im.save(buf, format="WEBP", quality=quality, method=6)
            new_payloads[idx] = (buf.getvalue(), "image/webp")

        repacked = _pack_attributes(js, blob)
        image_views = {img["bufferView"] for img in images if "bufferView" in img}

        # Textures move out of the binary blob and onto the image as a data:
        # URI, which also keeps them loadable under a strict CSP where the
        # loader's usual blob: URL would be refused.
        for idx, img in enumerate(images):
            payload, mime = new_payloads.get(idx, (b"", None))
            img.pop("bufferView", None)
            img.pop("mimeType", None)
            img["uri"] = (
                f"data:{mime};base64," + base64.b64encode(payload).decode("ascii")
                if payload and mime
                else "data:image/png;base64,"
            )

        out_blob = bytearray()
        for i, bv in enumerate(views):
            if i in image_views:
                payload = b""
            elif i in repacked:
                payload = repacked[i]
            else:
                start = bv.get("byteOffset", 0)
                payload = bytes(blob[start:start + bv["byteLength"]])
            out_blob += b"\x00" * (-len(out_blob) % 4)
            bv["byteOffset"] = len(out_blob)
            bv["byteLength"] = len(payload)
            out_blob += payload

        js["buffers"] = [{"byteLength": len(out_blob)}]

        # Drop the VRM metadata's reference to the thumbnail we just emptied.
        meta = js.get("extensions", {}).get("VRM", {}).get("meta", {})
        tex = meta.get("texture")
        if tex is not None and tex < len(textures) and textures[tex]["source"] not in used_images:
            meta.pop("texture", None)

        result = _write_glb(js, out_blob)
        logger.info(
            "Optimized GLB: %.2f MB -> %.2f MB (%d%%)",
            len(data) / 1e6, len(result) / 1e6, round(100 * len(result) / max(1, len(data))),
        )
        return result
    except Exception as e:
        logger.warning("Could not optimize GLB (%s); the original will be served", e)
        return None
