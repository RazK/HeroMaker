#!/usr/bin/env python3
"""Shrink a HeroMaker VRM for web delivery.

The pipeline's VRM carries two PNGs: the avatar texture (~2.4 MB) and a
meta thumbnail (~1.4 MB) that nothing renders. Drop the thumbnail, re-encode
the avatar texture as WebP, and pack the skinning attributes down to the
smallest types the glTF core spec allows (no extensions, so any loader still
reads it). Typical result: 5.5 MB -> ~1.1 MB.

Usage: optimize_vrm.py IN.vrm OUT.vrm [--size=1024] [--quality=88]
"""
import base64
import io
import json
import struct
import sys
from pathlib import Path

from PIL import Image

JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def read_glb(path):
    data = Path(path).read_bytes()
    magic, version, _ = struct.unpack("<III", data[:12])
    assert magic == 0x46546C67, "not a GLB"
    js, bin_chunk, off = None, b"", 12
    while off < len(data):
        clen, ctype = struct.unpack("<II", data[off:off + 8])
        chunk = data[off + 8:off + 8 + clen]
        if ctype == JSON_CHUNK:
            js = json.loads(chunk.decode("utf-8"))
        elif ctype == BIN_CHUNK:
            bin_chunk = chunk
        off += 8 + clen
    return js, bytearray(bin_chunk)


def write_glb(path, js, blob):
    js_bytes = json.dumps(js, separators=(",", ":")).encode("utf-8")
    js_bytes += b" " * (-len(js_bytes) % 4)
    blob += b"\x00" * (-len(blob) % 4)
    total = 12 + 8 + len(js_bytes) + 8 + len(blob)
    out = bytearray()
    out += struct.pack("<III", 0x46546C67, 2, total)
    out += struct.pack("<II", len(js_bytes), JSON_CHUNK) + js_bytes
    out += struct.pack("<II", len(blob), BIN_CHUNK) + blob
    Path(path).write_bytes(out)
    return total


UNSIGNED_BYTE, UNSIGNED_SHORT, UNSIGNED_INT, FLOAT = 5121, 5123, 5125, 5126


def pack_attributes(js, blob):
    """Shrink indices/joints/weights in place. Returns {bufferView: new bytes}."""
    out = {}

    def view_bytes(accessor):
        bv = js["bufferViews"][accessor["bufferView"]]
        start = bv.get("byteOffset", 0)
        return bytes(blob[start:start + bv["byteLength"]])

    for mesh in js.get("meshes", []):
        for prim in mesh["primitives"]:
            # uint32 indices -> uint16 whenever the vertex count allows it.
            if "indices" in prim:
                acc = js["accessors"][prim["indices"]]
                vertex_count = js["accessors"][prim["attributes"]["POSITION"]]["count"]
                if acc["componentType"] == UNSIGNED_INT and vertex_count <= 0xFFFF:
                    values = struct.unpack(f"<{acc['count']}I", view_bytes(acc))
                    out[acc["bufferView"]] = struct.pack(f"<{len(values)}H", *values)
                    acc["componentType"] = UNSIGNED_SHORT

            # uint16 joint indices -> uint8 (these rigs have ~24 joints).
            joints = prim["attributes"].get("JOINTS_0")
            if joints is not None:
                acc = js["accessors"][joints]
                if acc["componentType"] == UNSIGNED_SHORT:
                    values = struct.unpack(f"<{acc['count'] * 4}H", view_bytes(acc))
                    if max(values) <= 0xFF:
                        out[acc["bufferView"]] = bytes(values)
                        acc["componentType"] = UNSIGNED_BYTE

            # float32 skin weights -> normalized uint8, re-normalized so each
            # vertex still sums to exactly 255.
            weights = prim["attributes"].get("WEIGHTS_0")
            if weights is not None:
                acc = js["accessors"][weights]
                if acc["componentType"] == FLOAT:
                    values = struct.unpack(f"<{acc['count'] * 4}f", view_bytes(acc))
                    packed = bytearray()
                    for v in range(acc["count"]):
                        w = values[v * 4:v * 4 + 4]
                        total = sum(w) or 1.0
                        q = [min(255, max(0, round(x / total * 255))) for x in w]
                        drift = 255 - sum(q)
                        q[q.index(max(q))] = min(255, max(0, q[q.index(max(q))] + drift))
                        packed += bytes(q)
                    out[acc["bufferView"]] = bytes(packed)
                    acc["componentType"] = UNSIGNED_BYTE
                    acc["normalized"] = True
    return out


def optimize(src, dst, max_size=1024, quality=88):
    js, blob = read_glb(src)
    views = js["bufferViews"]
    images = js.get("images", [])

    # Which images are actually sampled by a material? Everything else
    # (notably the VRM meta thumbnail) is dead weight for a game.
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
    used_images = {js["textures"][t]["source"] for t in used_textures if t < len(js.get("textures", []))}

    # Re-encode every referenced image; blank out the rest.
    new_payloads = {}
    for idx, img in enumerate(images):
        bv = views[img["bufferView"]]
        start = bv.get("byteOffset", 0)
        raw = bytes(blob[start:start + bv["byteLength"]])
        if idx not in used_images:
            new_payloads[idx] = (b"", None)
            continue
        im = Image.open(io.BytesIO(raw))
        im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
        if max(im.size) > max_size:
            scale = max_size / max(im.size)
            im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="WEBP", quality=quality, method=6)
        new_payloads[idx] = (buf.getvalue(), "image/webp")

    repacked = pack_attributes(js, blob)

    # Every image bufferView becomes empty: its bytes now live either in a
    # data: URI on the image, or nowhere at all if nothing sampled it.
    image_views = {img["bufferView"]: idx for idx, img in enumerate(images) if "bufferView" in img}

    # Move textures out of bufferViews and onto the image as a data: URI.
    # A published artifact runs under a CSP where GLTFLoader's usual route for
    # embedded images — a blob: URL fetched by ImageBitmapLoader — is refused by
    # connect-src. A data: URI on the image loads as a plain <img>, which needs
    # only img-src, so the texture survives any sane policy.
    for idx, img in enumerate(images):
        payload, mime = new_payloads[idx]
        img.pop("bufferView", None)
        img.pop("mimeType", None)
        if payload and mime:
            img["uri"] = f"data:{mime};base64," + base64.b64encode(payload).decode("ascii")

    # Rebuild the binary blob, rewriting offsets as we go.
    out_blob = bytearray()
    for i, bv in enumerate(views):
        if i in image_views:
            payload = b""
        elif i in repacked:
            payload = repacked[i]
        else:
            start = bv.get("byteOffset", 0)
            payload = bytes(blob[start:start + bv["byteLength"]])
        pad = -len(out_blob) % 4
        out_blob += b"\x00" * pad
        bv["byteOffset"] = len(out_blob)
        bv["byteLength"] = len(payload)
        out_blob += payload

    js["buffers"] = [{"byteLength": len(out_blob)}]

    # Strip the now-empty thumbnail reference from the VRM metadata.
    meta = js.get("extensions", {}).get("VRM", {}).get("meta", {})
    if meta.get("texture") is not None and js["textures"][meta["texture"]]["source"] not in used_images:
        meta.pop("texture", None)
    for idx, img in enumerate(images):
        if idx not in used_images:
            img["uri"] = "data:image/png;base64,"  # referenced by nothing, kept valid

    before = Path(src).stat().st_size
    after = write_glb(dst, js, out_blob)
    print(f"{Path(src).name}: {before/1e6:.2f} MB -> {after/1e6:.2f} MB  ({after/before:.0%})")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a.split("=")[0]: a.split("=")[1] for a in sys.argv[1:] if "=" in a and a.startswith("--")}
    optimize(args[0], args[1],
             max_size=int(flags.get("--size", 1024)),
             quality=int(flags.get("--quality", 88)))
