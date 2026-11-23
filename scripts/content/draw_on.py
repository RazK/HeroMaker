"""A crayon drawing that draws itself, the way a child draws it.

For the landing's first picture and the ad (docs/content/README.md).

1. Sketch: a light pencil line traces each part's outline, one part after
   another, top to bottom, as one continuous stroke per outline.
2. Colour: each part (a connected patch of one crayon colour) is coloured in
   with back-and-forth diagonal crayon strokes, the way a child scribbles a
   shape full. A crayon in that part's colour rides the stroke being drawn.
3. The sketch fades, what is left is exactly the original drawing; it holds.

Every revealed pixel comes from the original, so the last frame IS the drawing.

usage: python draw_on.py drawing.png frames_dir [--fps=24] [--size=720] [--no-crayon]
"""
import math
import os
import sys

import cv2
import numpy as np

src, out = sys.argv[1], sys.argv[2]
arg = lambda n, d: next((a.split("=", 1)[1] for a in sys.argv if a.startswith(f"--{n}=")), d)
FPS = int(arg("fps", 24))
SIZE = int(arg("size", 720))
CRAYON = "--no-crayon" not in sys.argv
os.makedirs(out, exist_ok=True)
rng = np.random.default_rng(3)

img = cv2.imread(src, cv2.IMREAD_COLOR)
img = cv2.resize(img, (SIZE, SIZE), interpolation=cv2.INTER_AREA)
h, w = img.shape[:2]
paper = np.median(np.concatenate([img[:10].reshape(-1, 3), img[-10:].reshape(-1, 3)]), axis=0).astype(np.uint8)
paper_img = np.empty_like(img); paper_img[:] = paper

# ---- Parts: connected patches of one crayon colour --------------------------
diff = np.abs(img.astype(int) - paper.astype(int)).sum(axis=2)
ink = (diff > 45).astype(np.uint8)
ink = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
lab = cv2.cvtColor(cv2.GaussianBlur(img, (0, 0), 3), cv2.COLOR_BGR2LAB).astype(np.float32)
ys, xs = np.nonzero(ink)
K = 8
_, labels, centers = cv2.kmeans(lab[ys, xs, 1:3].copy(), K, None,
                                (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 60, 0.3), 5, cv2.KMEANS_PP_CENTERS)
cls = np.full((h, w), -1, np.int32); cls[ys, xs] = labels.ravel()
parts = []
min_area = (SIZE / 100) ** 2 * 4
for k in range(K):
    m = (cls == k).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    n, cc, stats, cent = cv2.connectedComponentsWithStats(m)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] < min_area:
            continue
        pm = (cc == i).astype(np.uint8)
        colour = tuple(int(c) for c in np.median(img[pm > 0], axis=0))
        parts.append({"mask": pm, "cy": cent[i][1], "cx": cent[i][0], "area": stats[i, cv2.CC_STAT_AREA], "colour": colour})
# A child colours a figure top to bottom; left before right on one level.
parts.sort(key=lambda p: (round(p["cy"] / (SIZE * 0.08)), p["cx"]))
# Every ink pixel belongs to some part, so the end is exact: give leftovers to the nearest part.
covered = np.zeros((h, w), np.uint8)
for p in parts:
    covered |= p["mask"]
left = ink & (1 - covered)
if left.any():
    _, lab_idx = cv2.distanceTransformWithLabels(1 - covered, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    owner = np.zeros((h, w), np.int32)
    for j, p in enumerate(parts):
        owner[p["mask"] > 0] = j + 1
    # map each label id to the owner at that seed pixel
    seeds = {}
    for y, x in zip(*np.nonzero(covered)):
        seeds.setdefault(lab_idx[y, x], owner[y, x])
    for y, x in zip(*np.nonzero(left)):
        j = seeds.get(lab_idx[y, x], 0)
        if j:
            parts[j - 1]["mask"][y, x] = 1


# ---- Strokes ----------------------------------------------------------------
def outline(mask):
    cs, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    pts = max(cs, key=len)[:, 0, :] if cs else np.zeros((0, 2), int)
    # start the line at the top of the shape, like a hand would
    if len(pts):
        s = int(np.argmin(pts[:, 1])); pts = np.roll(pts, -s, axis=0)
        pts = pts[:: max(1, len(pts) // 400)]
        pts = pts + rng.normal(0, SIZE / 500, pts.shape)
        pts = np.vstack([pts, pts[:1]])
    return pts


def hatch(mask, angle_deg, spacing):
    """Back-and-forth diagonal scribble covering the mask: a list of polylines."""
    a = math.radians(angle_deg)
    d = np.array([math.cos(a), math.sin(a)]); nrm = np.array([-d[1], d[0]])
    yy, xx = np.nonzero(mask)
    P = np.stack([xx, yy], 1).astype(float)
    t = P @ nrm; s = P @ d
    lines = []
    for k, off in enumerate(np.arange(t.min() - spacing, t.max() + spacing, spacing)):
        sel = np.abs(t - off) < spacing * 0.6
        if not sel.any():
            continue
        lo, hi = s[sel].min(), s[sel].max()
        a0, a1 = (lo - 3, hi + 3) if k % 2 == 0 else (hi + 3, lo - 3)
        n = max(2, int(abs(a1 - a0) / 6))
        seg = [d * (a0 + (a1 - a0) * i / (n - 1)) + nrm * (off + rng.normal(0, spacing * 0.12)) for i in range(n)]
        lines.append(np.array(seg))
    # join consecutive lines into one zig-zag: the crayon never lifts inside a part
    zig = np.vstack(lines) if lines else np.zeros((0, 2))
    return zig


SKETCH_S, GAP_S, HOLD_S = 1.4, 0.1, 1.2
STROKE_W = max(6, SIZE // 55)
events = []  # (t0, t1, kind, part index, polyline)
t = 0.25
per_px = SKETCH_S / sum(len(outline(p["mask"])) for p in parts)
for j, p in enumerate(parts):
    o = outline(p["mask"]); dur = len(o) * per_px
    events.append((t, t + dur, "sketch", j, o)); t += dur
t += GAP_S
colour_total = 0.0
for p in parts:
    p["zig"] = hatch(p["mask"], 35 + rng.normal(0, 8), STROKE_W * 0.7)
lengths = [np.linalg.norm(np.diff(p["zig"], axis=0), axis=1).sum() if len(p["zig"]) > 1 else 0 for p in parts]
COLOUR_S = 3.2
speed = sum(lengths) / COLOUR_S
for j, p in enumerate(parts):
    dur = max(0.03, lengths[j] / speed)
    events.append((t, t + dur, "colour", j, p["zig"])); t += dur + (0.03 if parts[j]["area"] > SIZE * SIZE * 0.01 else 0.0)
END_COLOUR = t
FADE_S = 0.35
TOTAL = END_COLOUR + FADE_S + HOLD_S


def prefix(poly, f):
    if len(poly) < 2 or f <= 0:
        return poly[:0]
    seg = np.linalg.norm(np.diff(poly, axis=0), axis=1); cum = np.concatenate([[0], np.cumsum(seg)])
    L = cum[-1] * min(1, f)
    i = int(np.searchsorted(cum, L))
    if i >= len(poly):
        return poly
    a = (L - cum[i - 1]) / max(1e-6, seg[i - 1])
    return np.vstack([poly[:i], poly[i - 1] + (poly[i] - poly[i - 1]) * a])


def draw_crayon(frame, tip, direction, colour):
    """A small crayon at `tip`, leaning back along the stroke: body, paper wrap, cone tip."""
    # A right hand: the crayon leans up and to the right whatever way the stroke goes,
    # rocking a little with it.
    ang = math.radians(-50) + 0.08 * math.copysign(1, direction[0])
    u = np.array([math.cos(ang), math.sin(ang)]); v = np.array([-u[1], u[0]])
    L, Wd, cone = SIZE * 0.17, SIZE * 0.032, SIZE * 0.035
    tip = np.array(tip, float)
    base = tip + u * cone
    body = [base + v * Wd / 2, base + u * L + v * Wd / 2, base + u * L - v * Wd / 2, base - v * Wd / 2]
    shadow = [(p + np.array([SIZE * 0.012, SIZE * 0.018])).astype(np.int32) for p in body]
    over = frame.copy()
    cv2.fillPoly(over, [np.array(shadow)], (60, 50, 60), cv2.LINE_AA)
    cv2.addWeighted(over, 0.18, frame, 0.82, 0, frame)
    col = tuple(int(c * 0.92) for c in colour)
    cv2.fillPoly(frame, [np.array([tip + v * Wd * 0.12, base + v * Wd / 2, base - v * Wd / 2, tip - v * Wd * 0.12]).astype(np.int32)], col, cv2.LINE_AA)
    cv2.fillPoly(frame, [np.array(body).astype(np.int32)], colour, cv2.LINE_AA)
    wrap0, wrap1 = base + u * L * 0.3, base + u * L * 0.8
    cv2.fillPoly(frame, [np.array([wrap0 + v * Wd / 2, wrap1 + v * Wd / 2, wrap1 - v * Wd / 2, wrap0 - v * Wd / 2]).astype(np.int32)],
                 tuple(int(c * 0.6) for c in colour), cv2.LINE_AA)
    hl0, hl1 = base + u * L * 0.05 + v * Wd * 0.25, base + u * L * 0.95 + v * Wd * 0.25
    cv2.line(frame, tuple(hl0.astype(int)), tuple(hl1.astype(int)), tuple(min(255, int(c * 1.25) + 30) for c in colour), max(1, int(Wd * 0.18)), cv2.LINE_AA)


GRAPHITE = np.array([110, 104, 112], np.float32)
N = int(round(TOTAL * FPS))
for fi in range(N):
    tt = fi / FPS
    sketch = np.zeros((h, w), np.uint8)
    reveal = np.zeros((h, w), np.uint8)
    tip = None
    for (t0, t1, kind, j, poly) in events:
        if tt < t0:
            continue
        f = 1.0 if tt >= t1 else (tt - t0) / (t1 - t0)
        pre = prefix(poly, f)
        if len(pre) >= 2:
            if kind == "sketch":
                cv2.polylines(sketch, [pre.astype(np.int32)], False, 1, max(1, SIZE // 400), cv2.LINE_AA)
            else:
                m = np.zeros((h, w), np.uint8)
                cv2.polylines(m, [pre.astype(np.int32)], False, 1, STROKE_W, cv2.LINE_AA)
                reveal |= m & parts[j]["mask"]
        if f >= 1 and kind == "colour":
            reveal |= parts[j]["mask"]
        if 0 < f < 1 and len(pre) >= 2:
            tip = (pre[-1], pre[-1] - pre[-2], parts[j]["colour"] if kind == "colour" else (90, 90, 96))
    frame = paper_img.astype(np.float32)
    sk_alpha = 0.42 * (1 - min(1, max(0, (tt - END_COLOUR) / FADE_S)))
    s = cv2.GaussianBlur(sketch.astype(np.float32), (0, 0), 0.6)[..., None] * sk_alpha
    frame = frame * (1 - s) + GRAPHITE * s
    r = reveal[..., None].astype(np.float32)
    frame = frame * (1 - r) + img.astype(np.float32) * r
    frame = frame.clip(0, 255).astype(np.uint8)
    if CRAYON and tip is not None:
        d = tip[1] if np.linalg.norm(tip[1]) > 1e-3 else np.array([1.0, 0.3])
        draw_crayon(frame, tip[0], d / np.linalg.norm(d), tip[2])
    cv2.imwrite(os.path.join(out, f"{fi:04d}.png"), frame)

last = cv2.imread(os.path.join(out, f"{N - 1:04d}.png"))
err = np.abs(last.astype(int) - np.where(ink[..., None] > 0, img, paper_img).astype(int)).mean()
print(f"{N} frames, {TOTAL:.1f} s at {FPS} fps, {len(parts)} parts; last frame vs drawing: {err:.2f} mean abs diff")
