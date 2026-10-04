#!/usr/bin/env python3
"""Shrink a HeroMaker VRM (or any pipeline GLB) for web delivery.

The pipeline's VRM carries two PNGs: the avatar texture (~2.4 MB) and a
meta thumbnail (~1.4 MB) that nothing renders. Drop the thumbnail, re-encode
the avatar texture as WebP, and pack the skinning attributes down to the
smallest types the glTF core spec allows. Typical result: 5.5 MB -> ~1.1 MB.

The logic lives in backend/app/utils/gltf_optimize.py, which the backend also
uses to serve opt_<name> copies of model.glb / walking.glb / avatar.vrm.

By default the texture is inlined as a data: URI with no extension (what the
games were built on: it loads under a strict CSP). --webp-extension instead
writes it spec-correctly through EXT_texture_webp, as the backend does.

Usage: optimize_vrm.py IN.vrm OUT.vrm [--size=1024] [--quality=88] [--webp-extension]
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.utils.gltf_optimize import optimize_glb  # noqa: E402


def optimize(src, dst, max_size=1024, quality=88, webp_extension=False):
    result = optimize_glb(Path(src).read_bytes(), max_size=max_size, quality=quality,
                          webp_extension=webp_extension)
    Path(dst).write_bytes(result.data)
    print(f"{Path(src).name}: {result.before/1e6:.2f} MB -> {result.after/1e6:.2f} MB  "
          f"({result.after/result.before:.0%})")
    return result


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a.split("=")[0]: a.split("=")[1] for a in sys.argv[1:] if "=" in a and a.startswith("--")}
    if len(args) != 2:
        sys.exit(__doc__)
    optimize(args[0], args[1],
             max_size=int(flags.get("--size", 1024)),
             quality=int(flags.get("--quality", 88)),
             webp_extension="--webp-extension" in sys.argv[1:])
