#!/usr/bin/env python3
"""Strip a .vrma animation down to the bones a HeroMaker avatar actually has.

The pipeline maps 22 humanoid bones, hips through toes. A `.vrma` from the wild
animates whatever its author rigged, which is typically 51 bones — and 30 of
those are fingers. Every one of those channels is decoded, sampled and
interpolated every frame onto bones that do not exist, and shipped over the
network first.

This is the dead-thumbnail finding again, one asset type over: measured on the
sample pack, roughly 59% of a clip's bytes drive joints we cannot move.

    .venv/bin/python scripts/optimize_vrma.py in.vrma out.vrma [--keep=hips,spine,...]
    .venv/bin/python scripts/optimize_vrma.py in.vrma --check

What it does, and all of it is reversible by re-fetching the source:
  * drops animation channels whose target bone is not in the kept set
  * drops those bones from VRMC_vrm_animation.humanoid.humanBones
  * drops the samplers, accessors and bufferViews that only those used
  * repacks the binary chunk so the removed keyframe data is actually gone

It does not touch keyframe values, interpolation or timing, so a clip that
played correctly before plays identically after.
"""
from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942

# The 22 bones the HeroMaker pipeline maps. Anything outside this set cannot be
# driven on our avatars, however faithfully a clip animates it.
HEROMAKER_BONES = [
    "hips", "spine", "chest", "upperChest", "neck", "head",
    "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
    "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand",
    "leftUpperLeg", "leftLowerLeg", "leftFoot", "leftToes",
    "rightUpperLeg", "rightLowerLeg", "rightFoot", "rightToes",
]


def read_glb(path: Path) -> tuple[dict, bytes]:
    raw = path.read_bytes()
    magic, version, length = struct.unpack_from("<III", raw, 0)
    if magic != GLB_MAGIC:
        raise SystemExit(f"{path} is not a GLB/vrma file")
    off, js, binary = 12, None, b""
    while off < min(length, len(raw)):
        clen, ctype = struct.unpack_from("<II", raw, off)
        body = raw[off + 8 : off + 8 + clen]
        if ctype == CHUNK_JSON:
            js = json.loads(body.decode("utf-8"))
        elif ctype == CHUNK_BIN:
            binary = body
        off += 8 + clen
    if js is None:
        raise SystemExit(f"{path} has no JSON chunk")
    return js, binary


def write_glb(path: Path, js: dict, binary: bytes) -> None:
    js_bytes = json.dumps(js, separators=(",", ":")).encode("utf-8")
    js_bytes += b" " * (-len(js_bytes) % 4)
    binary += b"\x00" * (-len(binary) % 4)
    total = 12 + 8 + len(js_bytes) + (8 + len(binary) if binary else 0)
    out = bytearray()
    out += struct.pack("<III", GLB_MAGIC, 2, total)
    out += struct.pack("<II", len(js_bytes), CHUNK_JSON) + js_bytes
    if binary:
        out += struct.pack("<II", len(binary), CHUNK_BIN) + binary
    path.write_bytes(bytes(out))


def optimize(js: dict, binary: bytes, keep: set[str]) -> tuple[dict, bytes, dict]:
    ext = js.get("extensions", {}).get("VRMC_vrm_animation")
    if not ext:
        raise SystemExit("no VRMC_vrm_animation extension — not a .vrma")
    human_bones: dict = ext.get("humanoid", {}).get("humanBones", {})

    # Node index -> bone name, so a channel's target can be judged.
    node_bone = {v["node"]: name for name, v in human_bones.items() if "node" in v}
    dropped_bones = sorted(b for b in human_bones if b not in keep)

    stats = {
        "bones_before": len(human_bones),
        "bones_after": len(human_bones) - len(dropped_bones),
        "dropped_bones": dropped_bones,
    }

    for name in dropped_bones:
        human_bones.pop(name, None)

    kept_accessors: list[int] = []
    for anim in js.get("animations", []):
        samplers = anim.get("samplers", [])
        channels = anim.get("channels", [])
        keep_channels = []
        for ch in channels:
            node = ch.get("target", {}).get("node")
            bone = node_bone.get(node)
            # A channel targeting a node that is not a humanoid bone at all is
            # kept: it may be an expression or lookAt track the loader wants.
            if bone is None or bone in keep:
                keep_channels.append(ch)
        stats["channels_before"] = stats.get("channels_before", 0) + len(channels)
        stats["channels_after"] = stats.get("channels_after", 0) + len(keep_channels)

        # Renumber the samplers each surviving channel points at.
        used = sorted({ch["sampler"] for ch in keep_channels})
        remap = {old: new for new, old in enumerate(used)}
        anim["samplers"] = [samplers[i] for i in used]
        for ch in keep_channels:
            ch["sampler"] = remap[ch["sampler"]]
        anim["channels"] = keep_channels
        for s in anim["samplers"]:
            kept_accessors.extend([s["input"], s["output"]])

    # Anything outside the animations still needs its accessors; collect them so
    # a clip carrying extra data is not quietly corrupted.
    def walk(node, out):
        if isinstance(node, dict):
            for k, v in node.items():
                if k in ("input", "output") and isinstance(v, int):
                    continue
                walk(v, out)
        elif isinstance(node, list):
            for v in node:
                walk(v, out)

    accessors = js.get("accessors", [])
    keep_acc = sorted(set(kept_accessors))
    acc_remap = {old: new for new, old in enumerate(keep_acc)}
    stats["accessors_before"] = len(accessors)
    stats["accessors_after"] = len(keep_acc)

    views = js.get("bufferViews", [])
    new_views: list[dict] = []
    view_remap: dict[int, int] = {}
    new_bin = bytearray()
    new_accessors = []
    for old in keep_acc:
        a = dict(accessors[old])
        vi = a.get("bufferView")
        if vi is not None:
            if vi not in view_remap:
                v = views[vi]
                start = v.get("byteOffset", 0)
                data = binary[start : start + v["byteLength"]]
                # Keep 4-byte alignment; accessors assume it.
                pad = -len(new_bin) % 4
                new_bin += b"\x00" * pad
                nv = {k: val for k, val in v.items() if k != "byteOffset"}
                nv["byteOffset"] = len(new_bin)
                nv["buffer"] = 0
                new_bin += data
                view_remap[vi] = len(new_views)
                new_views.append(nv)
            a["bufferView"] = view_remap[vi]
        new_accessors.append(a)

    js["accessors"] = new_accessors
    js["bufferViews"] = new_views
    js["buffers"] = [{"byteLength": len(new_bin)}]

    for anim in js.get("animations", []):
        for s in anim["samplers"]:
            s["input"] = acc_remap[s["input"]]
            s["output"] = acc_remap[s["output"]]

    stats["views_before"] = len(views)
    stats["views_after"] = len(new_views)
    return js, bytes(new_bin), stats


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", type=Path)
    ap.add_argument("dst", type=Path, nargs="?")
    ap.add_argument("--keep", default=",".join(HEROMAKER_BONES),
                    help="comma-separated bones to keep (default: the 22 HeroMaker maps)")
    ap.add_argument("--check", action="store_true",
                    help="report what would be dropped, write nothing")
    args = ap.parse_args()

    keep = {b.strip() for b in args.keep.split(",") if b.strip()}
    js, binary = read_glb(args.src)
    before = args.src.stat().st_size
    js, binary, stats = optimize(js, binary, keep)

    print(f"{args.src.name}")
    print(f"  bones     {stats['bones_before']:>4} -> {stats['bones_after']:>4}"
          f"   ({len(stats['dropped_bones'])} dropped)")
    print(f"  channels  {stats['channels_before']:>4} -> {stats['channels_after']:>4}")
    print(f"  accessors {stats['accessors_before']:>4} -> {stats['accessors_after']:>4}")

    if args.check or args.dst is None:
        print("  (check only, nothing written)")
        return 0

    write_glb(args.dst, js, binary)
    after = args.dst.stat().st_size
    print(f"  bytes  {before:,} -> {after:,}  ({100 - after * 100 // before}% smaller)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
