"""Make staging's app icon from production's, so the two never look alike.

Staging serves its own icon (installed app, browser tab, in-app logo) in place
of frontend/public/app-icon.png: the same hero on ink, with a sun-yellow
STAGING band. frontend/apply-env-look.sh swaps it in when the container starts
on any Railway environment but production, so a promote carries the same code
and production keeps its own icon.

Run it again whenever app-icon.png changes; CI fails until you do
(frontend/scripts/check-env-look.sh compares SOURCE.sha256).

    .venv/bin/python scripts/make_staging_icon.py
"""
import hashlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "frontend/public/app-icon.png"
OUT = ROOT / "frontend/env-assets/staging"
SIZE = 512
INK = (35, 25, 66, 255)       # --tb-ink
SUN = (255, 194, 51, 255)     # --tb-sun
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def main() -> None:
    art = Image.open(SOURCE).convert("RGBA")
    icon = Image.new("RGBA", (SIZE, SIZE), INK)
    # The hero fills the maskable safe zone (the middle 80% circle).
    side = int(SIZE * 0.84)
    art = art.resize((side, side), Image.LANCZOS)
    icon.alpha_composite(art, ((SIZE - side) // 2, int(SIZE * 0.06)))

    # The band sits where a circular mask still shows all of it: centred
    # 0.10-0.24 below the middle, 62% wide.
    draw = ImageDraw.Draw(icon)
    top, bottom = int(SIZE * 0.60), int(SIZE * 0.74)
    left, right = int(SIZE * 0.19), int(SIZE * 0.81)
    draw.rounded_rectangle((left, top, right, bottom), radius=(bottom - top) // 2, fill=SUN, outline=INK, width=5)
    font = ImageFont.truetype(FONT, int(SIZE * 0.085))
    draw.text(((left + right) / 2, (top + bottom) / 2), "STAGING", font=font, fill=INK, anchor="mm")

    OUT.mkdir(parents=True, exist_ok=True)
    # A palette PNG: about a fifth of the bytes, no visible difference at icon sizes.
    icon.convert("RGB").quantize(colors=256, method=Image.Quantize.MEDIANCUT).save(OUT / "app-icon.png", optimize=True)
    (OUT / "SOURCE.sha256").write_text(hashlib.sha256(SOURCE.read_bytes()).hexdigest() + "  frontend/public/app-icon.png\n")
    print(f"wrote {OUT / 'app-icon.png'}")


if __name__ == "__main__":
    main()
