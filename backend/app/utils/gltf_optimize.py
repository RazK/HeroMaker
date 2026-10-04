"""Shrink a pipeline GLB or VRM for web delivery, with no visible difference.

Every 3D file the pipeline produces carries the same fat:

* its texture, a 2048 px PNG or JPEG of 3-6 MB, which is more than half the
  file and far more than a phone screen can show;
* (VRM only) a ~1.4 MB meta thumbnail that nothing renders;
* skinning and index data in the widest types the spec allows: float32
  weights and uint32 indices where uint8 and uint16 carry the same values.

``optimize_glb`` drops what nothing samples, re-encodes every used texture as
WebP at a sane resolution, and packs indices, joints and weights down. Mesh
positions, normals, UVs, node transforms, skins and animation keyframes are
copied byte for byte.

It reads plain GLB as well as VRM: no VRM extension is needed, several
textures (and several textures sharing one image) are handled, and skinned,
animated meshes keep their skins and animations untouched.

Two ways to carry the WebP:

* ``webp_extension=True`` (the default, used by the backend): the spec-correct
  way. glTF core allows only PNG and JPEG, so the texture points at the WebP
  through ``EXT_texture_webp``, which is listed in ``extensionsRequired``.
  three.js' GLTFLoader (r128+) implements it; the image stays binary in the
  GLB, so it costs no base64 overhead.
* ``webp_extension=False`` (the ``scripts/optimize_vrm.py`` behaviour games
  were built on): the WebP is the core image source, inlined as a ``data:``
  URI so it loads under a strict CSP where a ``blob:`` URL would be refused.

This module imports nothing from the app, so the CLI can use it standalone.
"""
from __future__ import annotations

import base64
import io
import json
import struct
from dataclasses import dataclass

GLB_MAGIC = 0x46546C67
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942

UNSIGNED_BYTE, UNSIGNED_SHORT, UNSIGNED_INT, FLOAT = 5121, 5123, 5125, 5126

WEBP_EXT = "EXT_texture_webp"

# A phone shows the hero a few hundred pixels tall; 1024 px stays sharp on a
# 3x screen and is a quarter of the pixels of the pipeline's 2048 px texture.
DEFAULT_MAX_SIZE = 1024
DEFAULT_QUALITY = 88


class NotOptimizable(ValueError):
    """The input is not a GLB this module knows how to rewrite safely."""


@dataclass
class Result:
    data: bytes
    before: int
    after: int


# ---------------------------------------------------------------------------
# GLB container
# ---------------------------------------------------------------------------

def read_glb(data: bytes) -> tuple[dict, bytearray]:
    if len(data) < 12:
        raise NotOptimizable("too short to be a GLB")
    magic, version, _ = struct.unpack("<III", data[:12])
    if magic != GLB_MAGIC or version != 2:
        raise NotOptimizable("not a glTF 2.0 binary")
    js, bin_chunk, off = None, b"", 12
    while off + 8 <= len(data):
        clen, ctype = struct.unpack("<II", data[off:off + 8])
        chunk = data[off + 8:off + 8 + clen]
        if ctype == JSON_CHUNK:
            js = json.loads(chunk.decode("utf-8"))
        elif ctype == BIN_CHUNK:
            bin_chunk = chunk
        off += 8 + clen
    if js is None:
        raise NotOptimizable("GLB has no JSON chunk")
    return js, bytearray(bin_chunk)


def write_glb(js: dict, blob: bytes) -> bytes:
    js_bytes = json.dumps(js, separators=(",", ":")).encode("utf-8")
    js_bytes += b" " * (-len(js_bytes) % 4)
    blob = bytes(blob) + b"\x00" * (-len(blob) % 4)
    total = 12 + 8 + len(js_bytes) + (8 + len(blob) if blob else 0)
    out = bytearray(struct.pack("<III", GLB_MAGIC, 2, total))
    out += struct.pack("<II", len(js_bytes), JSON_CHUNK) + js_bytes
    if blob:
        out += struct.pack("<II", len(blob), BIN_CHUNK) + blob
    return bytes(out)


# ---------------------------------------------------------------------------
# Attribute packing
# ---------------------------------------------------------------------------

def _view_users(js: dict) -> dict[int, int]:
    """How many accessors read each bufferView."""
    users: dict[int, int] = {}
    for acc in js.get("accessors", []):
        if "bufferView" in acc:
            users[acc["bufferView"]] = users.get(acc["bufferView"], 0) + 1
        sparse = acc.get("sparse")
        if sparse:  # sparse views are never repacked, but count them as shared
            for part in ("indices", "values"):
                bv = sparse[part]["bufferView"]
                users[bv] = users.get(bv, 0) + 2
    return users


def _repackable(js: dict, acc: dict, users: dict[int, int]) -> bool:
    """Only rewrite an accessor that owns a tightly packed bufferView outright."""
    if "bufferView" not in acc or "sparse" in acc or acc.get("byteOffset", 0):
        return False
    bv = js["bufferViews"][acc["bufferView"]]
    return users.get(acc["bufferView"], 0) == 1 and "byteStride" not in bv


def pack_attributes(js: dict, blob: bytes) -> dict[int, bytes]:
    """Shrink indices/joints/weights in place. Returns {bufferView: new bytes}.

    Only core-spec types are used, so no extension is needed to read them.
    """
    out: dict[int, bytes] = {}
    users = _view_users(js)
    done: set[int] = set()

    def view_bytes(acc):
        bv = js["bufferViews"][acc["bufferView"]]
        start = bv.get("byteOffset", 0)
        return bytes(blob[start:start + bv["byteLength"]])

    for mesh in js.get("meshes", []):
        for prim in mesh.get("primitives", []):
            attrs = prim.get("attributes", {})

            # uint32 indices -> uint16 when every value fits. 0xFFFF itself is
            # reserved (primitive restart), so the largest allowed is 0xFFFE.
            idx = prim.get("indices")
            if idx is not None and idx not in done:
                acc = js["accessors"][idx]
                if acc["componentType"] == UNSIGNED_INT and _repackable(js, acc, users):
                    values = struct.unpack_from(f"<{acc['count']}I", view_bytes(acc))
                    if not values or max(values) < 0xFFFF:
                        out[acc["bufferView"]] = struct.pack(f"<{len(values)}H", *values)
                        acc["componentType"] = UNSIGNED_SHORT
                done.add(idx)

            _pack_skin(js, attrs, users, done, view_bytes, out)
    return out


def _pack_skin(js, attrs, users, done, view_bytes, out) -> None:
    """Pack JOINTS_0/WEIGHTS_0 together; extra JOINTS_n sets only change type.

    float32 weights become normalized uint8, re-normalized so each vertex still
    sums to exactly 255 (only with a single weight set: with WEIGHTS_1 the sum
    runs across both). A tiny weight that rounds to 0 also has its joint set to
    0, as the spec asks of unused influences, so weights are only packed when
    the matching joints can be rewritten too.
    """
    accessors = js["accessors"]
    for name, ai in attrs.items():
        if not name.startswith("JOINTS_") or ai in done:
            continue
        acc = accessors[ai]
        done.add(ai)
        if acc["componentType"] not in (UNSIGNED_BYTE, UNSIGNED_SHORT) or not _repackable(js, acc, users):
            continue
        fmt = "B" if acc["componentType"] == UNSIGNED_BYTE else "H"
        joints = list(struct.unpack_from(f"<{acc['count'] * 4}{fmt}", view_bytes(acc)))
        changed = False

        wi = attrs.get("WEIGHTS" + name[len("JOINTS"):])
        if name == "JOINTS_0" and wi is not None and wi not in done and "WEIGHTS_1" not in attrs:
            wacc = accessors[wi]
            done.add(wi)
            if (wacc["componentType"] == FLOAT and wacc["count"] == acc["count"]
                    and _repackable(js, wacc, users)):
                values = struct.unpack_from(f"<{wacc['count'] * 4}f", view_bytes(wacc))
                weights = _quantize_weights(values, wacc["count"])
                out[wacc["bufferView"]] = weights
                wacc["componentType"] = UNSIGNED_BYTE
                wacc["normalized"] = True
                wacc.pop("min", None)  # optional here, and now in a different unit
                wacc.pop("max", None)
                for k, w in enumerate(weights):
                    if w == 0 and joints[k]:
                        joints[k] = 0
                        changed = True

        # uint16 joint indices -> uint8 (these rigs have ~24 joints).
        if not joints or max(joints) <= 0xFF:
            if fmt == "H" or changed:
                out[acc["bufferView"]] = bytes(joints)
                acc["componentType"] = UNSIGNED_BYTE
        elif changed:
            out[acc["bufferView"]] = struct.pack(f"<{len(joints)}H", *joints)
        if acc["bufferView"] in out:
            acc.pop("min", None)
            acc.pop("max", None)


def _quantize_weights(values, count: int) -> bytes:
    packed = bytearray(count * 4)
    for v in range(count):
        w = values[v * 4:v * 4 + 4]
        total = sum(w)
        if total <= 0:
            continue  # an unweighted vertex stays unweighted
        q = [min(255, max(0, round(x / total * 255))) for x in w]
        top = q.index(max(q))
        q[top] = min(255, max(0, q[top] + 255 - sum(q)))
        packed[v * 4:v * 4 + 4] = bytes(q)
    return bytes(packed)


# ---------------------------------------------------------------------------
# Textures
# ---------------------------------------------------------------------------

# The smallest valid PNG: 1x1, one grey pixel.
_BLANK_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==")

_TEXTURE_INFO_KEYS = {"index", "texCoord", "scale", "strength", "extensions", "extras"}


def _used_textures(js: dict) -> set[int]:
    """Textures sampled by a material (including material extensions)."""
    used: set[int] = set()

    def walk(node):
        if isinstance(node, dict):
            if isinstance(node.get("index"), int) and set(node) <= _TEXTURE_INFO_KEYS:
                used.add(node["index"])
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(js.get("materials", []))
    # VRM 0.x MToon keeps its textures outside the glTF materials.
    for mat in js.get("extensions", {}).get("VRM", {}).get("materialProperties", []):
        for tex in (mat.get("textureProperties") or {}).values():
            if isinstance(tex, int):
                used.add(tex)
    return {t for t in used if t < len(js.get("textures", []))}


def _texture_image(tex: dict) -> int | None:
    if "source" in tex:
        return tex["source"]
    for ext in tex.get("extensions", {}).values():
        if isinstance(ext, dict) and isinstance(ext.get("source"), int):
            return ext["source"]
    return None


def _encode_webp(raw: bytes, max_size: int, quality: int) -> bytes:
    from PIL import Image

    with Image.open(io.BytesIO(raw)) as im:
        im = im.convert("RGBA" if "A" in im.getbands() or im.mode == "P" else "RGB")
        if im.mode == "RGBA" and im.getextrema()[3][0] == 255:
            im = im.convert("RGB")  # an alpha channel that is all opaque is wasted bytes
        if max(im.size) > max_size:
            scale = max_size / max(im.size)
            im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))),
                           Image.LANCZOS)
        buf = io.BytesIO()
        # method=4: a third of method=6's encode time for ~2% more bytes.
        im.save(buf, format="WEBP", quality=quality, method=4)
        return buf.getvalue()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def optimize_glb(data: bytes, *, max_size: int = DEFAULT_MAX_SIZE, quality: int = DEFAULT_QUALITY,
                 webp_extension: bool = True) -> Result:
    """Return a smaller GLB/VRM. Raises NotOptimizable for input it cannot rewrite."""
    js, blob = read_glb(data)

    buffers = js.get("buffers", [])
    if len(buffers) > 1 or any("uri" in b for b in buffers):
        raise NotOptimizable("only self-contained single-buffer GLBs are supported")
    if js.get("extensionsRequired"):
        # A required extension we do not understand might store data we would break.
        unknown = set(js["extensionsRequired"]) - {WEBP_EXT, "KHR_texture_transform",
                                                    "KHR_materials_unlit"}
        if unknown:
            raise NotOptimizable(f"required extensions not supported: {sorted(unknown)}")

    views = js.get("bufferViews", [])
    images = js.get("images", [])
    textures = js.get("textures", [])

    used_textures = _used_textures(js)
    used_images = {s for t in used_textures if (s := _texture_image(textures[t])) is not None}

    # Re-encode every used image held in the binary chunk; blank the unused ones.
    new_images: dict[int, bytes | None] = {}
    for idx, img in enumerate(images):
        if "bufferView" not in img:
            continue  # an external or data: URI image is left as it is
        if idx not in used_images:
            new_images[idx] = None
            continue
        bv = views[img["bufferView"]]
        start = bv.get("byteOffset", 0)
        raw = bytes(blob[start:start + bv["byteLength"]])
        try:
            new_images[idx] = _encode_webp(raw, max_size, quality)
        except Exception as e:  # an image PIL cannot read stays as it was
            raise NotOptimizable(f"cannot re-encode image {idx}: {e}") from e

    repacked = pack_attributes(js, blob)

    image_views = {img["bufferView"] for idx, img in enumerate(images) if idx in new_images}
    # Image payloads that stay in the binary chunk, keyed by their bufferView.
    image_payloads: dict[int, bytes] = {}

    for idx, payload in new_images.items():
        img = images[idx]
        bv_index = img.pop("bufferView")
        img.pop("mimeType", None)
        if payload is None:
            # Sampled by nothing (the VRM meta thumbnail). Something may still
            # point at it, so keep the slot, holding a valid 1x1 PNG.
            img["bufferView"] = bv_index
            img["mimeType"] = "image/png"
            image_payloads[bv_index] = _BLANK_PNG
        elif webp_extension:
            img["bufferView"] = bv_index
            img["mimeType"] = "image/webp"
            image_payloads[bv_index] = payload
        else:
            img["uri"] = "data:image/webp;base64," + base64.b64encode(payload).decode("ascii")

    webp_images = {i for i, p in new_images.items() if p is not None}
    if webp_extension and webp_images:
        for tex in textures:
            src = tex.get("source")
            if src in webp_images:
                tex.pop("source")
                tex.setdefault("extensions", {})[WEBP_EXT] = {"source": src}
        for key in ("extensionsUsed", "extensionsRequired"):
            names = js.setdefault(key, [])
            if WEBP_EXT not in names:
                names.append(WEBP_EXT)

    # Rebuild the binary chunk, dropping emptied views' bytes and rewriting offsets.
    out_blob = bytearray()
    for i, bv in enumerate(views):
        if i in image_payloads:
            payload = image_payloads[i]
        elif i in image_views:
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

    # A zero-length bufferView is invalid glTF: drop the ones left empty and
    # renumber every reference to the rest.
    _drop_empty_views(js)

    if views:
        js["buffers"] = [{"byteLength": len(out_blob)}]

    # The VRM 0.x meta thumbnail points at an image that is now empty.
    meta = js.get("extensions", {}).get("VRM", {}).get("meta", {})
    tex_idx = meta.get("texture")
    if isinstance(tex_idx, int) and tex_idx >= 0 and tex_idx not in used_textures:
        meta.pop("texture", None)

    out = write_glb(js, out_blob)
    return Result(data=out, before=len(data), after=len(out))


def _drop_empty_views(js: dict) -> None:
    views = js.get("bufferViews", [])
    keep = [i for i, bv in enumerate(views) if bv["byteLength"] > 0]
    if len(keep) == len(views):
        return
    remap = {old: new for new, old in enumerate(keep)}
    js["bufferViews"] = [views[i] for i in keep]

    for acc in js.get("accessors", []):
        if "bufferView" in acc:
            acc["bufferView"] = remap[acc["bufferView"]]
        sparse = acc.get("sparse")
        if sparse:
            for part in ("indices", "values"):
                sparse[part]["bufferView"] = remap[sparse[part]["bufferView"]]
    for img in js.get("images", []):
        if "bufferView" in img:
            img["bufferView"] = remap[img["bufferView"]]
    if not js["bufferViews"]:
        js.pop("bufferViews")
