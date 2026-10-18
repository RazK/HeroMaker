#!/usr/bin/env python
"""
Paint some drawings in some styles through the REAL render path and lay the
results out side by side, to judge a change to the painting step on real
renders rather than on a description of them.

    OPENAI_API_KEY=sk-... .venv/bin/python backend/scripts/render_check.py \\
        --drawing crayon=marketing/concepts/assets/pairs/crayon-kid-drawing.jpg \\
        --drawing hero=https://<backend>/api/files/<user>/<creation>/original.jpg \\
        --find "Captain Courage" --database-url "$PUBLIC_DB" \\
        --styles anime,pixar,original --before anime --out-dir out/render-check

Every painting goes through app.services.openai.render_image, exactly as the
pipeline's openai_render step calls it: framed drawing, shared framing prompt,
edge check and at most one retry. Nothing is re-implemented here.

    --drawing LABEL=SRC     a drawing: a path, or an http(s) URL (read-only GET)
    --find NAME             a hero by name (character_name, case-insensitive) in
                            the database at --database-url; its original drawing
                            and the painting it shipped with are fetched from
                            --files-base. Read-only: one SELECT, plain GETs.
    --styles a,b            styles to paint (default anime,pixar,original)
    --before a,b            also paint these styles the way they were painted
                            before the framing fix (render_image(framing=False)),
                            for a same-drawing comparison
    --max-calls N           stop before OpenAI has been called N times (default
                            30; a framed render that retries is 2 calls)

Writes, under --out-dir: <label>/original.*, <label>/shipped.png (the painting
the hero has now, if found), <label>/<style>.png (after), <label>/<style>.before.png,
report.json, and contact.png - one row per drawing, a red frame on every image
edge and a red marker on any edge the character runs into.

Cost: ~$0.167 per OpenAI call at list price. It never writes to a database or
to anyone's hero.
"""
import argparse
import json
import sys
import urllib.request
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from PIL import Image, ImageDraw, ImageOps  # noqa: E402

from app.services import openai as openai_service  # noqa: E402

DEFAULT_STYLES = "anime,pixar,original"
DEFAULT_FILES_BASE = "https://frontend-staging-7cb8.up.railway.app"
CELL = 300


def _fetch(src: str) -> bytes:
    if src.startswith(("http://", "https://")):
        req = urllib.request.Request(src, headers={"User-Agent": "render-check"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read()
    return Path(src).read_bytes()


def find_heroes(database_url: str, name: str) -> list:
    """[(label, user_id, creation_id, style)] of live heroes with this name."""
    from sqlalchemy import create_engine, text
    engine = create_engine(database_url)
    try:
        with engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT id, user_id, character_name, style FROM creations "
                "WHERE character_name ILIKE :n AND deleted_at IS NULL "
                "ORDER BY created_at DESC LIMIT 1"
            ), {"n": f"%{name}%"}).fetchall()
    finally:
        engine.dispose()
    slug = "".join(c if c.isalnum() else "-" for c in name.lower()).strip("-")
    return [(f"{slug}-{i}" if i else slug, r[1], r[0], r[3]) for i, r in enumerate(rows)]


def _checker(w: int, h: int) -> Image.Image:
    bg = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    d = ImageDraw.Draw(bg)
    s = 12
    for y in range(0, h, s):
        for x in range(0, w, s):
            if (x // s + y // s) % 2:
                d.rectangle([x, y, x + s - 1, y + s - 1], fill=(222, 222, 222, 255))
    return bg


def _cell(path: Path, label: str) -> Image.Image:
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGBA")
    edges = openai_service.touched_edges(path.read_bytes()) if path.suffix == ".png" else None
    scale = CELL / max(im.size)
    im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    tile = _checker(im.width, im.height)
    tile.alpha_composite(im)
    d = ImageDraw.Draw(tile)
    d.rectangle([0, 0, im.width - 1, im.height - 1], outline=(200, 0, 0, 255), width=1)
    w, h = im.size
    bars = {"top": [0, 0, w, 5], "bottom": [0, h - 6, w, h], "left": [0, 0, 5, h], "right": [w - 6, 0, w, h]}
    for edge in (edges or {}):
        d.rectangle(bars[edge], fill=(230, 0, 0, 255))
    cell = Image.new("RGBA", (CELL, CELL + 34), (255, 255, 255, 255))
    cell.paste(tile, ((CELL - w) // 2, 34 + (CELL - h) // 2))
    note = "CUT: " + ",".join(edges) if edges else ("clean" if edges == {} else "")
    ImageDraw.Draw(cell).text((4, 2), label, fill=(0, 0, 0, 255))
    ImageDraw.Draw(cell).text((4, 16), note, fill=(200, 0, 0, 255) if edges else (0, 120, 0, 255))
    return cell


def contact_sheet(rows: list, out: Path) -> Path:
    """rows: [(row label, [(cell label, path), ...])]"""
    width = max(len(cells) for _, cells in rows) * (CELL + 8) + 8
    height = len(rows) * (CELL + 34 + 26) + 8
    sheet = Image.new("RGB", (width, height), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    y = 8
    for label, cells in rows:
        d.text((8, y), label, fill=(0, 0, 0))
        x = 8
        for clabel, path in cells:
            sheet.paste(_cell(path, clabel).convert("RGB"), (x, y + 18))
            x += CELL + 8
        y += CELL + 34 + 26
    sheet.save(out)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--drawing", action="append", default=[], metavar="LABEL=SRC")
    ap.add_argument("--find", action="append", default=[], metavar="NAME")
    ap.add_argument("--database-url", default=None)
    ap.add_argument("--files-base", default=DEFAULT_FILES_BASE)
    ap.add_argument("--styles", default=DEFAULT_STYLES)
    ap.add_argument("--before", default="", help="comma-separated styles to also paint the old way")
    ap.add_argument("--max-calls", type=int, default=30)
    ap.add_argument("--out-dir", type=Path, default=Path("out/render-check"))
    args = ap.parse_args(argv)

    styles = [s for s in args.styles.split(",") if s]
    before = [s for s in args.before.split(",") if s]
    unknown = [s for s in styles + before if s not in openai_service.STYLES]
    if unknown:
        ap.error(f"unknown style(s): {', '.join(unknown)}")
    if not openai_service.OPENAI_API_KEY:
        print("OPENAI_API_KEY is not set.", file=sys.stderr)
        return 2

    out = args.out_dir
    out.mkdir(parents=True, exist_ok=True)
    jobs = []   # (label, original bytes, shipped bytes or None, shipped style)
    for item in args.drawing:
        label, _, src = item.partition("=")
        if not label or not src:
            ap.error("--drawing wants LABEL=SRC")
        try:
            jobs.append((label, _fetch(src), None, None))
        except Exception as e:
            print(f"{label}: cannot fetch {src}: {e}", flush=True)
    for name in args.find:
        if not args.database_url:
            print(f"find {name!r}: skipped, no --database-url", flush=True)
            continue
        try:
            found = find_heroes(args.database_url, name)
        except Exception as e:
            print(f"find {name!r}: lookup failed: {e}", flush=True)
            continue
        print(f"find {name!r}: {len(found)} hero(es)", flush=True)
        for label, user_id, creation_id, style in found:
            base = f"{args.files_base}/api/files/{user_id}/{creation_id}"
            print(f"  {label}: {creation_id} style={style}", flush=True)
            shipped = None
            try:
                shipped = _fetch(f"{base}/rendered.png")
            except Exception as e:
                print(f"  {label}: no rendered.png ({e})")
            try:
                jobs.append((label, _fetch(f"{base}/original.jpg"), shipped, style or "pixar"))
            except Exception as e:
                print(f"  {label}: cannot fetch the drawing: {e}", flush=True)

    calls = 0
    report = []
    rows = []
    for label, original, shipped, shipped_style in jobs:
        d = out / label
        d.mkdir(parents=True, exist_ok=True)
        src = d / "original.jpg"
        src.write_bytes(original)
        cells = [("drawing", src)]
        if shipped is not None:
            (d / "shipped.png").write_bytes(shipped)
            cells.append((f"shipped ({shipped_style})", d / "shipped.png"))
        for style in styles:
            variants = [("before", False)] if style in before else []
            variants.append(("after", True))
            for variant, framing in variants:
                need = 1 if not framing else 2
                if calls + need > args.max_calls:
                    print(f"budget: skipping {label}/{style}/{variant} ({calls} calls made)")
                    continue
                dst = d / (f"{style}.before.png" if not framing else f"{style}.png")
                info = {}
                print(f"{label:22s} {style:9s} {variant:6s} ...", flush=True)
                try:
                    openai_service.render_image(Path(src), dst, style=style,
                                                report=info, framing=framing)
                except Exception as e:
                    print(f"  FAILED: {e}")
                    calls += 1
                    report.append({"label": label, "style": style, "variant": variant, "error": str(e)})
                    continue
                used = info.get("attempts", 1)
                calls += used
                edges = openai_service.touched_edges(dst.read_bytes())
                print(f"  calls={used} edges={edges} first={info.get('first_touched_edges')}", flush=True)
                report.append({"label": label, "style": style, "variant": variant,
                               "calls": used, "edges": edges, **info})
                cells.append((f"{style} {variant}" + (f" x{used}" if used > 1 else ""), dst))
        rows.append((label, cells))

    (out / "report.json").write_text(json.dumps({"calls": calls, "renders": report}, indent=2))
    if rows:
        print(f"contact sheet: {contact_sheet(rows, out / 'contact.png')}")
    print(f"OpenAI calls: {calls} (~${calls * 0.167:.2f} at list price)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
