#!/usr/bin/env python
"""
Paint the style picker's example images: one drawing, every style.

    OPENAI_API_KEY=sk-... .venv/bin/python backend/scripts/make_style_samples.py

For each style in app.services.openai.STYLES it runs the REAL pipeline path for
the painting - image_processing.process_image, then openai.render_image with
that style - on the staging robot's drawing, and writes a 256px WebP thumbnail
to frontend/public/styles/<key>.webp. Nothing is mocked and nothing is
re-implemented: what the picker shows is what that style really produces.

Cost: one gpt-image-1 high-quality edit per style rendered (~$0.17 each at
list price, so ~$0.84 for all five). It never touches a database or a user.

Options:
    --only lego,anime          render just these styles
    --use pixar=PATH           no render: thumbnail an existing painting instead
                               (e.g. Crayon Kid's Pixar cut-out, already made)
    --drawing PATH             another drawing (default: the robot's)
    --raw-dir DIR              also keep each full-size 1024px PNG there
    --out-dir DIR              where the .webp files go (default:
                               frontend/public/styles)

It also writes drawing.webp, the drawing itself. Until a style's file exists the
picker shows that on the style's plate colour instead, so a missing sample
never looks broken.
"""
import argparse
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from PIL import Image  # noqa: E402

from app.services import image_processing  # noqa: E402
from app.services import openai as openai_service  # noqa: E402

DEFAULT_DRAWING = REPO / "marketing" / "concepts" / "assets" / "pairs" / "crayon-kid-drawing.jpg"
DEFAULT_OUT = REPO / "frontend" / "public" / "styles"
SIZE = 256
QUALITY = 86


def thumbnail(src: Path, dst: Path, size: int = SIZE) -> Path:
    """A square, transparent WebP of the figure: trimmed to its silhouette,
    scaled to fit (never cropped) with a small margin, centred."""
    im = Image.open(src).convert("RGBA")
    box = im.getchannel("A").getbbox()
    if box:
        im = im.crop(box)
    inner = round(size * 0.92)
    im.thumbnail((inner, inner), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(im, ((size - im.width) // 2, (size - im.height) // 2), im)
    dst.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dst, "WEBP", quality=QUALITY, method=6)
    return dst


def render(style: str, drawing: Path, work: Path) -> Path:
    """The pipeline's own two steps for the painting, in this style."""
    processed = image_processing.process_image(drawing, work / "processed.jpg")
    return openai_service.render_image(processed, work / f"{style}.png", style=style)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", default="", help="comma-separated style keys (default: all)")
    ap.add_argument("--use", action="append", default=[], metavar="KEY=PATH",
                    help="thumbnail an existing painting for KEY instead of rendering it")
    ap.add_argument("--drawing", type=Path, default=DEFAULT_DRAWING)
    ap.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--raw-dir", type=Path, default=None)
    args = ap.parse_args(argv)

    use = {}
    for item in args.use:
        key, _, path = item.partition("=")
        if key not in openai_service.STYLES or not path:
            ap.error(f"--use wants KEY=PATH with KEY one of {', '.join(openai_service.STYLES)}")
        use[key] = Path(path)

    keys = [k for k in args.only.split(",") if k] or list(openai_service.STYLES)
    unknown = [k for k in keys if k not in openai_service.STYLES]
    if unknown:
        ap.error(f"unknown style(s): {', '.join(unknown)}; known: {', '.join(openai_service.STYLES)}")

    to_render = [k for k in keys if k not in use]
    if to_render and not openai_service.OPENAI_API_KEY:
        print("OPENAI_API_KEY is not set: export it, or put it in backend/.env.", file=sys.stderr)
        return 2
    if not args.drawing.exists():
        print(f"drawing not found: {args.drawing}", file=sys.stderr)
        return 2

    # The picker's fallback for a style with no sample yet: the same drawing,
    # shown on that style's plate colour.
    print(f"{'drawing':10s} -> {thumbnail(args.drawing, args.out_dir / 'drawing.webp')}")

    failed = []
    with tempfile.TemporaryDirectory(prefix="style-samples-") as tmp:
        for key in keys:
            out = args.out_dir / f"{key}.webp"
            try:
                if key in use:
                    src = use[key]
                    print(f"{key:10s} from {src}")
                else:
                    work = Path(tmp) / key
                    work.mkdir()
                    print(f"{key:10s} rendering {args.drawing.name} ...", flush=True)
                    src = render(key, args.drawing, work)
                    if args.raw_dir:
                        args.raw_dir.mkdir(parents=True, exist_ok=True)
                        Image.open(src).save(args.raw_dir / f"{key}.png")
                thumbnail(src, out)
                print(f"{'':10s} -> {out} ({out.stat().st_size // 1024} KB)")
            except Exception as e:   # one refusal must not lose the others
                failed.append(key)
                print(f"{key:10s} FAILED: {e}", file=sys.stderr)

    if failed:
        print(f"\n{len(failed)} failed: {', '.join(failed)}. Re-run with --only {','.join(failed)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
