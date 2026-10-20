"""Cut a hero painting out of an opaque studio background.

Older pipeline versions asked OpenAI for a painting without
``background="transparent"``, so their ``rendered.png`` stands on a light
studio backdrop: a near-white or grey sweep with a soft vignette and a contact
shadow under the feet. On a pastel plate that shows as a beige rectangle.

``cut_out`` decides how a painting should be shown and, for an opaque one,
makes a transparent copy. It never touches the original: the caller stores
the copy as a derived file (``cut_rendered.png``, see api/files.py), exactly as
thumbnails are.

How, in order:

1. **Already transparent?** Nothing to do: ``TRANSPARENT``.
2. **Is the background a studio backdrop?** The frame (a 3% border) must be
   mostly light, unsaturated and smooth, and a smooth model of the backdrop
   (a low-order polynomial per channel, so the vignette is part of it) must
   explain it closely. Otherwise: ``FRAMED``.
3. **Flood fill from the border** through pixels the model explains, stopped
   by edges and never squeezing through a gap of a few pixels. Anything it
   cannot reach stays, so regions enclosed by the figure (eyes, teeth, the
   space inside a looped arm) are never removed.
4. **A guide for white on white.** Where the figure's colour is the
   backdrop's (a snowman on a white sweep) colour cannot tell them apart and
   a flood pours through any stretch of faint outline. A small salient-object
   network (U^2-Net-p, 4.6 MB, a fraction of a second on one CPU core) says
   roughly where the figure is; the flood may not enter what it is sure of,
   and patches of backdrop it is sure of (a vignette's darker corner) go too.
   The network only guides: every edge of the cut is the flood's, at full
   resolution.
5. **Contact shadow.** The backdrop's darkening under the feet becomes
   semi-transparent black of the same darkness: on any plate it darkens the
   plate as it darkened the backdrop.
6. **Soft, clean edge.** Along the outline the alpha is solved from the
   colour (``I = a*F + (1-a)*B``, ``F`` the nearby inside colour, ``B`` the
   backdrop model) and the edge colour is decontaminated against ``B``: no
   white halo around hair or fur.
7. **Sanity.** If the cut kept too little or too much of the picture, swept
   through texture, or left standing backdrop the guide is sure of, it is
   not trusted: ``FRAMED``, and the client shows the painting as a
   polaroid instead.

Bump ``CUTOUT_VERSION`` whenever the output can change: it is folded into the
URL version of every file derived from a painting, and stale cuts are remade.
"""
from __future__ import annotations

import io
import logging
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Optional

import numpy as np

if TYPE_CHECKING:
    from PIL import Image

logger = logging.getLogger(__name__)

CUTOUT_VERSION = 1

TRANSPARENT = "transparent"  # the painting has its own alpha: shown as it is
CUT = "cut"                  # an opaque backdrop was removed: shown from cut_rendered.png
FRAMED = "framed"            # no confident cut: shown in a polaroid frame
KINDS = (TRANSPARENT, CUT, FRAMED)

# --- tuning, measured on every production and staging render ----------------
WORK_SIZE = 512          # masks are found at this size; the edge is made at full size
FRAME = 0.03             # border width, as a share of the shorter side
SEED_MIN_FRACTION = 0.5  # share of the frame that must look like backdrop
SEED_MIN_LUMA = 0.55     # the backdrop is light...
SEED_MAX_SAT = 0.14      # ...and nearly grey
MODEL_MAX_RESIDUAL = 0.03  # RMS of the backdrop model over the frame
CHROMA_TOL = 0.045       # colour distance (luminance taken out) the flood allows
LUMA_UP_TOL = 0.035      # how much brighter than the backdrop the flood allows
LUMA_DOWN_TOL = 0.10     # how much darker, before it counts as shadow
SHADOW_MAX = 0.60        # the darkest shadow the flood walks through (1 - L/Lb)
FLOOR_BAND = 0.12        # shadows are walked through only in this share of the figure's height, at its feet
EDGE_BARRIER = 0.035     # gradient (per pixel at WORK_SIZE) that stops the flood;
                         # 99% of backdrop pixels are under 0.01, silhouettes over 0.05
GAP = 3                  # the flood never squeezes through a gap narrower than ~2*GAP+1 px
GUIDE_SURE = 0.85        # guide probability above which a pixel is surely the figure
GUIDE_NONE = 0.05        # ...and below which surely not
MIN_FOREGROUND = 0.04    # the figure covers at least this share of the picture
MAX_FOREGROUND = 0.80    # ...and at most this
MAX_TEXTURED_BACKGROUND = 0.02  # share of the removed area that may be textured
MAX_BACKDROP_LEFT = 0.03        # share of the figure that may be backdrop the guide is sure of

GUIDE_MODEL = Path(__file__).with_name("models") / "u2netp.onnx"


@dataclass
class Cutout:
    kind: str
    image: Optional["Image.Image"] = None  # the RGBA cut (PIL), only for kind == CUT
    reason: str = ""
    stats: dict = field(default_factory=dict)


def has_transparency(img) -> bool:
    """True when the image's alpha channel is actually used (over 1% of it see-through)."""
    if img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info):
        hist = img.convert("RGBA").getchannel("A").histogram()
        return sum(hist[:250]) > 0.01 * img.width * img.height
    return False


def cut_out(data: bytes) -> Cutout:
    """Decide how a painting should be shown and, for an opaque one, cut it out."""
    from PIL import Image

    started = time.perf_counter()
    with Image.open(io.BytesIO(data)) as src:
        src.load()
        if has_transparency(src):
            return Cutout(TRANSPARENT, reason="already transparent")
        rgb = src.convert("RGB")
    result = _cut(rgb)
    result.stats["seconds"] = round(time.perf_counter() - started, 3)
    return result


# --- the guide ---------------------------------------------------------------

_guide_lock = threading.Lock()
_guide_session = None


def _guide(rgb, size: tuple[int, int]):
    """Probability that each pixel is the figure, at ``size`` (w, h); None if unavailable.

    U^2-Net-p (Qin et al. 2020, Apache-2.0), the ONNX export rembg ships, run
    with rembg's own pre- and post-processing.
    """
    global _guide_session
    from PIL import Image
    try:
        import onnxruntime as ort
    except ImportError:
        logger.warning("onnxruntime is not installed: cutting out without a guide")
        return None
    with _guide_lock:
        if _guide_session is None:
            if not GUIDE_MODEL.exists():
                logger.warning(f"Cut-out guide model missing: {GUIDE_MODEL}")
                return None
            opts = ort.SessionOptions()
            # One core: cut-outs run in request threads, next to everything else.
            opts.intra_op_num_threads = 1
            opts.inter_op_num_threads = 1
            # No memory arena: it would keep ~300 MB per process for one
            # 320 x 320 inference made once per old hero.
            opts.enable_cpu_mem_arena = False
            opts.enable_mem_pattern = False
            _guide_session = ort.InferenceSession(str(GUIDE_MODEL), opts, providers=["CPUExecutionProvider"])
        session = _guide_session
    x = np.asarray(rgb.resize((320, 320), Image.LANCZOS), dtype=np.float32)
    x = x / max(float(x.max()), 1e-6)
    x = (x - (0.485, 0.456, 0.406)) / (0.229, 0.224, 0.225)
    pred = session.run(None, {session.get_inputs()[0].name: x.transpose(2, 0, 1)[None].astype(np.float32)})[0][0, 0]
    lo, hi = float(pred.min()), float(pred.max())
    pred = (pred - lo) / max(hi - lo, 1e-6)
    return np.asarray(Image.fromarray(pred.astype(np.float32), "F").resize(size, Image.BILINEAR))


# --- the cut -----------------------------------------------------------------

def _luma(a):
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def _design(h: int, w: int, ys, xs):
    """Bi-cubic terms in normalised coordinates: the vignette's shape."""
    y = ys / max(h - 1, 1) * 2 - 1
    x = xs / max(w - 1, 1) * 2 - 1
    return np.stack([np.ones_like(x), x, y, x * x, y * y, x * y, x * x * y, x * y * y, x ** 3, y ** 3], axis=-1)


def _fit_backdrop(img, mask):
    """Least-squares backdrop model over ``mask``: an (H, W, 3) image and its RMS residual."""
    h, w = mask.shape
    ys, xs = np.nonzero(mask)
    if len(ys) > 40000:
        pick = np.linspace(0, len(ys) - 1, 40000).astype(int)
        ys, xs = ys[pick], xs[pick]
    A = _design(h, w, ys.astype(np.float32), xs.astype(np.float32))
    target = img[ys, xs]
    coef, *_ = np.linalg.lstsq(A, target, rcond=None)
    resid = float(np.sqrt(np.mean((A @ coef - target) ** 2)))
    gy, gx = np.mgrid[0:h, 0:w].astype(np.float32)
    return np.clip(_design(h, w, gy, gx) @ coef, 0, 1).astype(np.float32), resid


def _flood(seed, passable):
    """Everything reachable from ``seed`` through ``passable``, never through a
    gap narrower than about 2*GAP+1 pixels.

    A soft, shaded outline can have a pixel or two of weak edge, and a plain
    flood pours through it. So the flood runs on the passable area eroded by
    GAP, where such pinholes are closed, then grows back GAP+1 pixels to
    reach the outline again.
    """
    from scipy import ndimage
    core = ndimage.binary_erosion(passable, iterations=GAP, border_value=1)
    reached = ndimage.binary_propagation(seed & core, mask=core)
    return ndimage.binary_dilation(reached, iterations=GAP + 1, mask=passable) | (seed & passable)


def _floor(standing):
    """Rows of the figure's feet: the bottom FLOOR_BAND of what ``standing`` covers."""
    rows = np.arange(standing.shape[0])[:, None]
    ys = np.nonzero(standing.any(axis=1))[0]
    if not len(ys):
        return np.zeros(standing.shape, bool)
    top, bottom = ys.min(), ys.max()
    return np.broadcast_to(rows >= bottom - FLOOR_BAND * (bottom - top), standing.shape)


def _cut(rgb) -> Cutout:
    from PIL import Image
    from scipy import ndimage

    full_w, full_h = rgb.size
    scale = min(1.0, WORK_SIZE / max(full_w, full_h))
    small = rgb.resize((max(1, round(full_w * scale)), max(1, round(full_h * scale))), Image.BILINEAR) if scale < 1 else rgb
    img = np.asarray(small, dtype=np.float32) / 255.0
    h, w = img.shape[:2]
    luma = _luma(img)
    sat = img.max(axis=-1) - img.min(axis=-1)
    smooth = ndimage.gaussian_filter(img, sigma=(0.8, 0.8, 0))
    grad = np.sqrt(sum(ndimage.sobel(smooth[..., c], axis=a) ** 2 for c in range(3) for a in (0, 1)) / 3) / 8

    b = max(2, round(FRAME * min(h, w)))
    frame = np.zeros((h, w), bool)
    frame[:b] = frame[-b:] = True
    frame[:, :b] = frame[:, -b:] = True

    # An edge stops the flood, thickened by a pixel so it has no pinholes.
    barrier = ndimage.binary_dilation(grad > EDGE_BARRIER)
    seed = frame & (luma > SEED_MIN_LUMA) & (sat < SEED_MAX_SAT) & ~barrier
    stats = {"seed_fraction": round(float(seed.sum() / frame.sum()), 3)}
    if stats["seed_fraction"] < SEED_MIN_FRACTION:
        return Cutout(FRAMED, reason="the border is not a plain backdrop", stats=stats)
    model, resid = _fit_backdrop(img, seed)
    stats["seed_residual"] = round(resid, 4)
    if resid > MODEL_MAX_RESIDUAL:
        return Cutout(FRAMED, reason="the border is not uniform", stats=stats)

    guide = _guide(small, (w, h))
    if guide is not None:
        sure_figure = ndimage.binary_erosion(guide > GUIDE_SURE, iterations=3)
        sure_backdrop = guide < GUIDE_NONE
    else:
        sure_figure = np.zeros((h, w), bool)
        sure_backdrop = np.zeros((h, w), bool)
    seed &= ~sure_figure

    background = seed
    for _ in range(2):
        ratio = luma / np.maximum(_luma(model), 1e-3)
        chroma = np.linalg.norm(img - model * ratio[..., None], axis=-1)
        near = (chroma < CHROMA_TOL) & (ratio < 1 + LUMA_UP_TOL) & ~barrier & ~sure_figure
        plain = near & (ratio > 1 - LUMA_DOWN_TOL)
        # First the plain backdrop, which stops at the contact shadow...
        background = _flood(seed, plain)
        # ...then the shadow, only at the figure's feet: higher up, a grey
        # that dark is the figure's own shading (a snowman's underside).
        shadowy = near & (ratio > 1 - SHADOW_MAX) & _floor(~background)
        background = _flood(background, plain | shadowy)
        # Refit on the plain backdrop the flood found, so the model also
        # knows the middle of the picture, not just its frame.
        fit_on = background & plain
        if fit_on.sum() < 0.05 * h * w:
            break
        model, resid = _fit_backdrop(img, fit_on)
    stats["model_residual"] = round(resid, 4)
    ratio = luma / np.maximum(_luma(model), 1e-3)
    chroma = np.linalg.norm(img - model * ratio[..., None], axis=-1)

    # Backdrop the flood could not reach but the guide is sure of, and that
    # is smooth and grey (a vignette's darker corner, a shadow's far end).
    if guide is not None:
        stray = sure_backdrop & ~barrier & (sat < SEED_MAX_SAT) & (ratio > 1 - SHADOW_MAX) & (chroma < 2 * CHROMA_TOL)
        background = ndimage.binary_propagation(background, mask=background | stray)

    # The flood stops a pixel or two short of every edge (the barrier is
    # thickened, gaps are closed): let it creep the last few pixels through
    # anything that still looks like backdrop.
    backdrop_like = (chroma < CHROMA_TOL) & (np.abs(ratio - 1) < LUMA_DOWN_TOL) & ~sure_figure
    background = ndimage.binary_dilation(background, iterations=GAP + 2, mask=backdrop_like | background)

    # The figure: everything the flood did not reach. Specks it stepped round
    # are tidied away, as is any patch that stands apart from the hero and
    # looks like backdrop (the sweep's lip along the edge). Holes inside the
    # hero are not separate components, so they stay.
    figure = ~background
    labels, n = ndimage.label(figure)
    if n == 0:
        return Cutout(FRAMED, reason="nothing was left after the cut", stats=stats)
    index = np.arange(1, n + 1)
    sizes = ndimage.sum(figure, labels, index=index)
    likeness = ndimage.mean(np.linalg.norm(img - model, axis=-1), labels, index=index)
    on_frame = ndimage.maximum(frame, labels, index=index) > 0
    largest = int(np.argmax(sizes))
    keep = np.zeros(n + 1, bool)
    for k in range(n):
        speck = sizes[k] < max(24, 0.0015 * h * w)
        backdrop_patch = sizes[k] < 0.02 * h * w and (likeness[k] < 0.05 or (on_frame[k] and likeness[k] < 0.08))
        keep[k + 1] = k == largest or not (speck or backdrop_patch)
    figure = keep[labels]

    fg = float(figure.mean())
    stats["foreground"] = round(fg, 3)
    if not MIN_FOREGROUND <= fg <= MAX_FOREGROUND:
        return Cutout(FRAMED, reason=f"the cut kept {fg:.0%} of the picture", stats=stats)

    # The removed area must be overwhelmingly smooth: a flood that leaked
    # into the figure crosses texture the backdrop never has.
    removed = ~ndimage.binary_dilation(figure, iterations=2)
    textured = float((removed & (grad > EDGE_BARRIER)).sum() / max(removed.sum(), 1))
    stats["textured_background"] = round(textured, 4)
    if textured > MAX_TEXTURED_BACKGROUND:
        return Cutout(FRAMED, reason="the backdrop is textured", stats=stats)

    # Nothing the guide is sure is backdrop, and that looks like backdrop,
    # may be left standing: that is the beige patch this exists to remove.
    # (The guide is coarse and misses thin things, hair, a wand, so it is
    # never asked to agree on the figure itself.)
    if guide is not None:
        theirs = guide > 0.5
        stats["guide_agreement"] = round(float((figure & theirs).sum() / max((figure | theirs).sum(), 1)), 3)
        smooth_grey = ~barrier & (sat < SEED_MAX_SAT) & (chroma < 2 * CHROMA_TOL) & (ratio > 1 - SHADOW_MAX)
        left = float((figure & sure_backdrop & smooth_grey).sum() / max(figure.sum(), 1))
        stats["backdrop_left"] = round(left, 4)
        if left > MAX_BACKDROP_LEFT:
            return Cutout(FRAMED, reason="backdrop was left around the figure", stats=stats)

    cut = _compose(rgb, figure, model, ratio, scale, stats)
    return Cutout(CUT, image=cut, reason="studio backdrop removed", stats=stats)


def _compose(rgb, figure_small, model_small, ratio_small, scale, stats):
    """The full-size RGBA cut: soft edge, decontaminated colours, contact shadow."""
    from PIL import Image
    from scipy import ndimage

    full_w, full_h = rgb.size
    img = np.asarray(rgb, dtype=np.float32) / 255.0

    def up(a):
        if a.shape[:2] == (full_h, full_w):
            return a.astype(np.float32)
        if a.ndim == 2:
            return np.asarray(Image.fromarray(a.astype(np.float32), "F").resize((full_w, full_h), Image.BILINEAR))
        return np.stack([up(a[..., c]) for c in range(a.shape[-1])], axis=-1)

    model = up(model_small)
    figure = up(figure_small.astype(np.float32)) > 0.5
    k = max(1, round(1 / scale))  # full-size pixels per working pixel
    r = k + 1

    # The band either side of the outline where the edge is made.
    grown = ndimage.binary_dilation(figure, iterations=r)
    core = ndimage.binary_erosion(figure, iterations=r)
    band = grown & ~core

    # F: the colour just inside the figure, carried out across the band.
    s = 1.5 * r
    weight = ndimage.gaussian_filter(core.astype(np.float32), s)
    fg = np.stack([ndimage.gaussian_filter(img[..., c] * core, s) for c in range(3)], axis=-1)
    fg = np.where(weight[..., None] > 1e-3, fg / np.maximum(weight, 1e-3)[..., None], img)

    diff = fg - model
    denom = (diff * diff).sum(-1)
    solved = np.clip(((img - model) * diff).sum(-1) / np.maximum(denom, 1e-4), 0, 1)
    # Where the figure's colour is close to the backdrop's the solve means
    # nothing: there, the (anti-aliased) mask.
    soft = ndimage.gaussian_filter(figure.astype(np.float32), sigma=0.9 * k)
    alpha = np.where(denom > 0.02, solved, soft)
    alpha = np.where(band, alpha, figure.astype(np.float32))
    alpha = np.where(band & ~figure, np.minimum(alpha, np.clip(soft * 1.5, 0, 1)), alpha)
    alpha = ndimage.gaussian_filter(alpha, sigma=0.5)
    alpha = np.where(core, 1.0, np.where(grown, alpha, 0.0)).astype(np.float32)

    # Decontaminate: take the backdrop's share back out of the edge colour.
    colour = np.clip((img - (1 - alpha[..., None]) * model) / np.maximum(alpha, 1e-3)[..., None], 0, 1)
    weak = np.clip((0.5 - alpha) / 0.5, 0, 1)[..., None]
    colour = np.where(band[..., None], colour * (1 - weak) + fg * weak, img)

    # Contact shadow: the backdrop's darkening around the feet, as black.
    shade = np.clip((1 - up(ratio_small) - 0.03) / 0.97, 0, 1)
    shade = ndimage.gaussian_filter(shade, sigma=1.5 * k)
    ys, xs = np.nonzero(figure_small)
    if len(ys):
        h, w = figure_small.shape
        top, bottom, left, right = ys.min(), ys.max(), xs.min(), xs.max()
        span = max(right - left, 1)
        rows = np.arange(h)[:, None]
        cols = np.arange(w)[None, :]
        region = (rows > top + 0.6 * (bottom - top)) & (cols > left - 0.15 * span) & (cols < right + 0.15 * span)
        # Fade it with distance from the figure, so a vignette's darker
        # corners never come back as a smudge.
        away = ndimage.distance_transform_edt(~figure_small)
        fade = np.where(region, np.clip(1 - away / max(0.3 * span, 8), 0, 1), 0)
        shade = shade * up(fade)
    else:
        shade = np.zeros_like(alpha)
    shade = np.where(figure, 0, shade)
    stats["shadow_px"] = int((shade > 0.05).sum())

    out_alpha = alpha + (1 - alpha) * shade
    out_colour = colour * (alpha / np.maximum(out_alpha, 1e-3))[..., None]
    rgba = np.concatenate([out_colour, out_alpha[..., None]], axis=-1)
    rgba = (np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")
