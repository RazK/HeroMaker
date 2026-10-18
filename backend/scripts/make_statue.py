"""Make a print-ready Hero Statue package from a hero's model.glb.

    .venv/bin/python backend/scripts/make_statue.py model.glb out.zip --height 90 \
        --name "Blue Bolt" --child Maya --age 6

Writes the zip (OBJ+MTL+texture, 3MF, preview GLB, report.json) and prints
the report. Same code path as GET /api/admin/creations/{id}/print-file.
"""
import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.statue import make_statue_package  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("glb", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--height", type=float, default=90.0, help="total height in mm, base included")
    ap.add_argument("--name", default="", help="hero name, engraved on the base")
    ap.add_argument("--child", default="", help="child's first name: 'drawn by ...'")
    ap.add_argument("--age", type=int, default=None)
    a = ap.parse_args()
    t = time.time()
    data, report = make_statue_package(a.glb.read_bytes(), a.height, a.name, a.child, a.age)
    a.out.write_bytes(data)
    report["seconds"] = round(time.time() - t, 1)
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
