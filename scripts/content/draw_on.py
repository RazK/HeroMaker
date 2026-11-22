"""A crayon drawing that draws itself: colour by colour, in scribbled strokes.

For the landing's first picture (docs/content/README.md). Splits the drawing
into its crayon colours, then reveals each colour with back-and-forth crayon
strokes that sweep across it, in the order a child would colour: hair, face,
mask, body, sleeves, cape, legs, boots. Holds the finished drawing, then
starts again from blank paper.

usage: .venv/bin/python scripts/content/draw_on.py drawing.(png|webp) frames_dir [--fps=15]
"""
import os
import sys

import cv2
import numpy as np

src, out = sys.argv[1], sys.argv[2]
fps = int(next((a.split("=")[1] for a in sys.argv if a.startswith("--fps=")), 15))
os.makedirs(out, exist_ok=True)

img = cv2.imread(src, cv2.IMREAD_COLOR)
h, w = img.shape[:2]
paper = np.median(img[:12, :12].reshape(-1, 3), axis=0)

# Ink = anything clearly darker or more saturated than the paper.
diff = np.abs(img.astype(int) - paper).sum(axis=2)
ink = cv2.morphologyEx((diff > 40).astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))

# Crayon colours: k-means on the ink pixels' hue/saturation/value.
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
ys, xs = np.nonzero(ink)
feat = np.stack([np.cos(hsv[ys, xs, 0] / 90 * np.pi) * hsv[ys, xs, 1], np.sin(hsv[ys, xs, 0] / 90 * np.pi) * hsv[ys, xs, 1], hsv[ys, xs, 2] * 0.6], 1)
K = 7
_, labels, _ = cv2.kmeans(feat, K, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 0.5), 4, cv2.KMEANS_PP_CENTERS)
layers = []
for k in range(K):
    m = np.zeros((h, w), np.uint8)
    sel = labels.ravel() == k
    m[ys[sel], xs[sel]] = 1
    m = cv2.dilate(m, np.ones((3, 3), np.uint8))
    yy = ys[sel]
    layers.append((yy.mean(), m))
# Top to bottom, roughly how a child colours a figure.
layers.sort(key=lambda t: t[0])

rng = np.random.default_rng(7)
per_layer, hold, blank = int(0.55 * fps), int(1.6 * fps), int(0.4 * fps)


def scribble(mask: np.ndarray, t: float) -> np.ndarray:
    """Zig-zag crayon strokes over the mask's bounding box, the first t of them."""
    yy, xx = np.nonzero(mask)
    if len(yy) == 0:
        return mask
    y0, y1, x0, x1 = yy.min(), yy.max(), xx.min(), xx.max()
    s = np.zeros_like(mask)
    step = 9
    rows = list(range(y0 - step, y1 + step, step))
    n = max(1, int(round(t * len(rows))))
    for i, y in enumerate(rows[:n]):
        a, b = (x0 - 6, x1 + 6) if i % 2 == 0 else (x1 + 6, x0 - 6)
        jit = rng.integers(-3, 4, 2)
        cv2.line(s, (int(a), int(y + jit[0])), (int(b), int(y + step * 1.4 + jit[1])), 1, 14, cv2.LINE_AA)
    return s & mask


canvas_paper = np.full_like(img, paper.astype(np.uint8))
frames = []
done = np.zeros((h, w), np.uint8)
for i in range(blank):
    frames.append(canvas_paper.copy())
for _, m in layers:
    for f in range(per_layer):
        t = (f + 1) / per_layer
        shown = done | scribble(m, t)
        frames.append(np.where(shown[..., None] > 0, img, canvas_paper))
    done |= m
full = np.where(done[..., None] > 0, img, canvas_paper)
for i in range(hold):
    frames.append(full)
for i, f in enumerate(frames):
    cv2.imwrite(os.path.join(out, f"{i:04d}.png"), f)
print(f"{len(frames)} frames, {len(frames) / fps:.1f} s, {len(layers)} colours")
