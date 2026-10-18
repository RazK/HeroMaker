"""Turn tools/make-posters.mjs PNGs into the WebPs the app's game chooser ships.

    .venv/bin/python games/hero-moves/tools/posters-webp.py <png-dir>

Writes frontend/public/games/<game>.webp (400x500) and <game>@2x.webp
(800x1000), each kept under 150 KB by stepping the quality down.
"""
import os
import sys
from PIL import Image

SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'frontend', 'public', 'games')
os.makedirs(OUT, exist_ok=True)
for kind, name in (('rumble', 'robot-rumble'), ('dance', 'dance-party')):
    im = Image.open(os.path.join(SRC, f'{kind}.png')).convert('RGB')
    for suffix, size in (('', (400, 500)), ('@2x', (800, 1000))):
        out = os.path.join(OUT, f'{name}{suffix}.webp')
        img = im.resize(size, Image.LANCZOS)
        for q in (86, 80, 74, 68, 60):
            img.save(out, 'WEBP', quality=q, method=6)
            if os.path.getsize(out) < 150_000:
                break
        print(f'{out}: {os.path.getsize(out) // 1024} KB (q={q})')
