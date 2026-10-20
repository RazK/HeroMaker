"""
OpenAI Image Rendering Service - GPT-Image-1 integration for image-to-image transformation.

Uses OpenAI's GPT-Image-1 model to transform child drawings into 3D renders optimized for Meshy.
"""

import base64
import io
import json
import logging
import re
import time
import unicodedata
from pathlib import Path
from typing import Optional
from openai import OpenAI
from openai import APIError, APIConnectionError, APITimeoutError, RateLimitError
from app.config.settings import OPENAI_API_KEY
from app.config import pricing
from app.services import usage as usage_service
from app.services.usage import UsageContext
from app.services import provider_errors

logger = logging.getLogger(__name__)


# Prompt for transforming drawing to 3D render in T-pose
# Note: Keep prompt neutral to avoid OpenAI's safety filters
# Avoid words like "child", "weapon", "violence", character names that might trigger moderation
# (The " \" on the first line keeps the trailing space the prompt has always
# shipped with, which editors that strip trailing whitespace would remove.)
RENDER_PROMPT = """Transform this drawing into a professional 3D character render in T-pose position. \


Requirements:
- Keep all original details: colors, clothing, accessories, features
- Front view, full body visible, standing upright, fully contained in the view without cropping.
- T-pose: arms extended horizontally, legs straight
- Transparent background: only the character, no floor, no ground shadow, no scenery
- High quality 3D render style, well-lit
- Clean edges, good contrast

Render the character exactly as shown, in a clean 3D style with arms extended horizontally, ready for 3D model generation."""


# ---------------------------------------------------------------------------
# Styles: what the painting looks like. The user picks one before Go.
#
# Every style's prompt keeps what Meshy needs to make a riggable model from the
# picture: ONE full-body character, front view, T-pose (arms out, legs
# straight), nothing cropped, a transparent background with no floor or
# shadow, and no text. Change a style's look freely; never drop those lines.
#
# "pixar" is RENDER_PROMPT itself, byte for byte. Existing heroes (style NULL)
# are this style, and the staging result cache keys on the prompt text, so
# keeping it identical keeps every cached render a hit.
#
# The prompts describe each look in plain words rather than naming the brand:
# brand and character names are what OpenAI's moderation is most likely to
# refuse (see the note above RENDER_PROMPT). The brand names are UI labels.
# ---------------------------------------------------------------------------

DEFAULT_STYLE = "pixar"

LEGO_PROMPT = """Transform this drawing into a 3D toy figure built like a classic plastic building-brick minifigure, in T-pose position.

Requirements:
- One single character, built from the drawing: keep its colors, clothing, accessories and features as molded plastic parts and printed details
- Minifigure build: round cylindrical head with a stud on top, simple printed face, blocky trapezoid torso, short straight legs, simple rounded hands
- Glossy molded plastic, crisp seams between the parts, small round studs where bricks would have them
- Front view, full body visible, standing upright, fully contained in the view without cropping.
- T-pose: arms extended horizontally, legs straight
- Transparent background: only the character, no floor, no baseplate, no ground shadow, no scenery
- No added text: no captions, labels, logos or brand marks; an emblem drawn on the costume stays
- High quality 3D render, well-lit, clean edges, good contrast

Render the character as a plastic brick-toy figure that is clearly the one in the drawing, with arms extended horizontally, ready for 3D model generation."""

MINECRAFT_PROMPT = """Transform this drawing into a blocky voxel-game 3D character in T-pose position.

Requirements:
- One single character, built from the drawing: keep its colors, clothing, accessories and features, rebuilt from cubes
- Faithful to the drawing: every color, marking and piece of clothing comes from the drawing. Add nothing it does not show: no default game outfit, no extra clothing, letters, symbols, logos or patterns. A part drawn plainly stays plain, in the drawing's own color; white or uncolored areas inside the character, such as the whites of eyes, count as colors and stay white
- A cube-shaped head, a rectangular box body, box-shaped arms and box-shaped legs, all with sharp square edges
- Pixel-art skin on every face of every block: flat squares of color, no smooth gradients, no curves
- Hair and accessories as small blocks attached to the body
- Front view, full body visible, standing upright, fully contained in the view without cropping.
- T-pose: arms extended horizontally, legs straight
- Transparent background: only the character, no floor, no ground shadow, no scenery, no terrain blocks
- No added text: no captions, labels or logos
- High quality 3D render, well-lit, clean edges, good contrast

Render the character as a blocky voxel figure that is clearly the one in the drawing, with arms extended horizontally, ready for 3D model generation."""

ANIME_PROMPT = """Transform this drawing into an anime-style cel-shaded 3D character in T-pose position.

Requirements:
- One single character, built only from what the drawing shows: its colors, clothing, accessories and features
- Add nothing the drawing does not show: no new hair, clothing, accessories or props
- Anime look applied to the drawn character: large expressive eyes where the eyes are drawn, small nose and mouth, clean sculpted shapes
- Cel shading: flat areas of color, crisp shadow edges, clean dark outlines
- Front view, full body visible, standing upright, fully contained in the view without cropping.
- T-pose: arms extended horizontally, legs straight
- Transparent background: only the character, no floor, no ground shadow, no scenery
- No added text: no captions, speech bubbles or sound effects; an emblem drawn on the costume stays
- High quality 3D render, well-lit, clean edges, good contrast

Render the character in anime cel-shaded 3D, clearly the one in the drawing, with arms extended horizontally, ready for 3D model generation."""

# Ordered: this is the order the picker shows them in.
STYLES = {
    "pixar": {"label": "Pixar", "prompt": RENDER_PROMPT},
    "lego": {"label": "Lego", "prompt": LEGO_PROMPT},
    "minecraft": {"label": "Minecraft", "prompt": MINECRAFT_PROMPT},
    "anime": {"label": "Anime", "prompt": ANIME_PROMPT},
}

# Styles that were offered once and are not any more. Heroes made in one keep
# its id in the database: nothing rewrites them. Wherever the id is read it
# means DEFAULT_STYLE, so an old hero's page, a retried step and "Make it
# again" all work, and anything repainted comes out in the default look. The
# API takes a retired id as "no style given" (creations._checked_style), so an
# old tab, or a retry that still sends one, is never refused.
#   "original": the drawing's own look, "only made three-dimensional".
#   Retired 2026-10-19: it came out flat.
RETIRED_STYLES = frozenset({"original"})


def list_styles() -> list:
    """[{key, label}] in picker order. What GET /api/styles answers."""
    return [{"key": key, "label": s["label"]} for key, s in STYLES.items()]


def is_valid_style(style: Optional[str]) -> bool:
    return style in STYLES


def is_retired_style(style: Optional[str]) -> bool:
    return style in RETIRED_STYLES


def resolve_style(style: Optional[str]) -> str:
    """The style a stored value means. NULL (every hero made before styles) is
    the default, and so is a retired style (RETIRED_STYLES). Any other value
    no longer in the registry also falls back to it, so a style can never stop
    an old hero from being made again."""
    if style is None or style == "" or style in RETIRED_STYLES:
        return DEFAULT_STYLE
    if style not in STYLES:
        logger.warning("Unknown render style %r; using %r", style, DEFAULT_STYLE)
        return DEFAULT_STYLE
    return style


def style_prompt(style: Optional[str] = None) -> str:
    return STYLES[resolve_style(style)]["prompt"]


# ---------------------------------------------------------------------------
# Framing: the whole character, feet included, with room around it.
#
# Every style asks for the character "fully contained in the view without
# cropping", and the model still paints it edge to edge. Measured on the
# transparent renders made so far: a tall character fills the full height with
# 2-6 px left above the head and below the feet, so the smallest overshoot cuts
# the feet off, and Meshy then builds a hero with no feet. Asking harder alone
# does not hold, so three things are done, all generic (nothing here knows
# about any one drawing):
#
#   1. the drawing is sent centred on a square canvas (the shape of the output)
#      with empty paper around it - a phone photo is portrait, the painting is
#      square, and squeezing one into the other is where the model reframes;
#   2. FRAMING_PROMPT, the same for every style, asks for the margin in words;
#   3. the painting is checked: if the character's opaque pixels run into an
#      edge of the image, the render is tried once more with a wider margin, and
#      the better of the two is kept. Both tries are the same pipeline step, so
#      the user is charged once (execute_step charges per step, before it runs);
#      the second call is ours to pay and is recorded as its own usage_event.
#
# The style prompts stay byte for byte what they were (Pixar's is pinned by
# tests/test_render_styles.py): framing is not a look, so it is appended here.
# It does enter the result cache's version, so a render cached before this fix
# - possibly a cropped one - is never handed out again.
# ---------------------------------------------------------------------------

FRAMING_PROMPT = """Framing: show the whole character, small enough to leave clear empty space on every side of it. Nothing touches or crosses the edges of the image: the top of the head, both hands at the ends of the outstretched arms, and both feet with their shoes all stay inside, with empty space below the feet. If anything would not fit, make the whole character smaller; never cut part of it off."""

# ---------------------------------------------------------------------------
# Photos of real people: a likeness they will love.
#
# Most uploads are drawings, and a drawing is painted exactly as drawn. Some
# are photos of a real person (a parent, a teacher, the child), and the style
# prompts, written for drawings, let the model stylise the body: measured on
# one such hero, a slim, tall woman (7.5 heads tall in her photo) was painted
# 5.6 heads tall with legs ~40% thicker for her height, and every 3D step after
# the painting kept that shape. Product rule: a person looks at least as good
# as in their photo - at least as tall and slim, never heavier, older or less
# attractive; if anything, flattered.
#
# So a photo of a person (and only that: see classify_input below) gets this
# clause after the framing. A drawing gets nothing new, so its prompt - and its
# result-cache key - stay exactly as they were. Unsure means drawing.
# ---------------------------------------------------------------------------

INPUT_KIND_PHOTO = "photo_of_person"
INPUT_KIND_DRAWING = "drawing"
INPUT_KIND_OTHER = "other"
INPUT_KINDS = (INPUT_KIND_PHOTO, INPUT_KIND_DRAWING, INPUT_KIND_OTHER)

PHOTO_LIKENESS_PROMPT = """This picture is a photograph of a real person, not a drawing. Make the character a flattering likeness of them, one they will love:
- Keep who they are: the same face, hair colour and hairstyle, skin tone, ethnicity and clothing
- Keep their body proportions, or improve them slightly: at least as tall and as slim as in the photo, with real human proportions rather than a cartoon's
- The head stays in the same proportion to the full height as in the photo (for a grown-up, about one seventh of it or less): do not enlarge the head, do not shorten the legs or the body
- A slim person stays slim: slim arms and legs, a narrow waist and hips, clothes that fit as they do in the photo
- Never make them shorter, wider, heavier or older than in the photo, and never less attractive
- If anything, flatter them: fuller hair, a fit build, clear skin, a warm smile
- Where this style has a body shape of its own (a toy figure, a figure built from blocks), keep that shape and carry the likeness in the face, hair, skin tone and clothing
- Where a line above speaks of a drawing, read it as this photo; these points about the person come first"""

# The drawing goes to OpenAI on a square canvas this size, its longer side
# spanning FRAME_FILL of it, the rest filled with the drawing's own paper colour.
FRAME_CANVAS_PX = 1024
FRAME_FILL = 0.78
# The second try, when the first painting ran into an edge: more room still.
FRAME_RETRY_FILL = 0.62

# A painting "touches" an edge when at least this many pixels of its outermost
# row or column are opaque (alpha >= EDGE_ALPHA). A cut-off foot leaves a solid
# run there; a stray antialiased speck does not reach the count.
EDGE_ALPHA = 128
EDGE_MIN_PIXELS = 5
# Below this share of see-through pixels the background was not removed, and
# edges say nothing about cropping: no check, no retry.
EDGE_MIN_TRANSPARENT_SHARE = 0.02

# A second try only if the first came back within this many seconds, and never
# for longer than RETRY_TIMEOUT_S: the step's own timeout (app/config/steps.py,
# 300 s) must never turn a usable painting into a failed, refunded step.
RETRY_IF_FIRST_WITHIN_S = 120.0
RETRY_TIMEOUT_S = 120.0

FRAMING_PARAMS = {
    "canvas_px": FRAME_CANVAS_PX,
    "fill": FRAME_FILL,
    "retry_fill": FRAME_RETRY_FILL,
    "edge_alpha": EDGE_ALPHA,
    "edge_min_pixels": EDGE_MIN_PIXELS,
}


def render_prompt(style: Optional[str] = None, input_kind: Optional[str] = None) -> str:
    """Exactly what is sent to OpenAI for this style: its look, then the
    framing every style shares, then - for a photo of a real person only -
    the flattering-likeness clause. A drawing's prompt is byte for byte what
    it was before photos were told apart."""
    prompt = style_prompt(style) + "\n\n" + FRAMING_PROMPT
    if input_kind == INPUT_KIND_PHOTO:
        prompt += "\n\n" + PHOTO_LIKENESS_PROMPT
    return prompt


def _paper_colour(img) -> tuple:
    """The median colour of the drawing's outer ring: the paper it is on."""
    small = img.convert("RGB")
    small.thumbnail((128, 128))
    w, h = small.size
    px = small.load()
    ring = [px[x, y] for y in (0, 1, h - 2, h - 1) if 0 <= y < h for x in range(w)]
    ring += [px[x, y] for x in (0, 1, w - 2, w - 1) if 0 <= x < w for y in range(h)]
    return tuple(sorted(p[c] for p in ring)[len(ring) // 2] for c in range(3))


def frame_drawing(image_bytes: bytes, fill: float = FRAME_FILL,
                  canvas_px: int = FRAME_CANVAS_PX) -> Optional[bytes]:
    """
    The drawing as a square PNG, centred, its longer side `fill` of the canvas,
    on its own paper colour. None if the bytes are not an image Pillow reads;
    the caller then sends them unchanged, so framing can never break a render.
    """
    from PIL import Image, ImageOps

    try:
        with Image.open(io.BytesIO(image_bytes)) as opened:
            img = ImageOps.exif_transpose(opened)
            img.load()
    except Exception:
        return None

    if img.mode in ("RGBA", "LA", "P", "PA"):
        img = img.convert("RGBA")
        flat = Image.new("RGB", img.size, (255, 255, 255))
        flat.paste(img, mask=img.getchannel("A"))
        img = flat
    else:
        img = img.convert("RGB")

    paper = _paper_colour(img)
    scale = fill * canvas_px / max(img.size)
    size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
    img = img.resize(size, Image.LANCZOS)
    canvas = Image.new("RGB", (canvas_px, canvas_px), paper)
    canvas.paste(img, ((canvas_px - img.width) // 2, (canvas_px - img.height) // 2))
    out = io.BytesIO()
    canvas.save(out, format="PNG")
    return out.getvalue()


def touched_edges(png_bytes: bytes) -> Optional[dict]:
    """
    Which edges of a transparent painting the character runs into:
    {"top": n, "bottom": n, "left": n, "right": n} with n the opaque pixels on
    that outermost row/column, listing only edges at or above EDGE_MIN_PIXELS.
    An empty dict is a clean painting. None means it cannot be judged: not an
    image, or no transparent background to tell the character from.
    """
    from PIL import Image

    try:
        with Image.open(io.BytesIO(png_bytes)) as opened:
            opened.load()
            if "A" not in opened.getbands() and "transparency" not in opened.info:
                return None
            alpha = opened.convert("RGBA").getchannel("A")
    except Exception:
        return None

    w, h = alpha.size
    hist = alpha.histogram()
    if sum(hist[:EDGE_ALPHA]) < EDGE_MIN_TRANSPARENT_SHARE * w * h:
        return None
    mask = alpha.point(lambda v: 255 if v >= EDGE_ALPHA else 0)
    lines = {
        "top": (0, 0, w, 1), "bottom": (0, h - 1, w, h),
        "left": (0, 0, 1, h), "right": (w - 1, 0, w, h),
    }
    found = {}
    for edge, box in lines.items():
        n = mask.crop(box).histogram()[255]
        if n >= EDGE_MIN_PIXELS:
            found[edge] = n
    return found

# Everything sent to images.edit() that shapes the picture we get back. Kept in
# one place for two readers: the call below, and the staging result cache
# (app/services/result_cache.py), which keys on a hash of the style's prompt
# plus these - so editing either one, or picking another style, makes the
# cached render miss, as it should.
#
# The model/size/quality must stay in step with
# pricing.OPENAI_IMAGE_USD_MICROS, which is quoted for exactly
# gpt-image-1 @ 1024x1024 @ quality=high.
RENDER_PARAMS = {
    "model": "gpt-image-1",
    "size": "1024x1024",
    "quality": "high",
    # A cut-out hero with an alpha channel: the app can place it on
    # any surface, and Meshy reads the alpha as the silhouette.
    # Same price as an opaque render.
    "background": "transparent",
    "output_format": "png",
    "n": 1,
}


def render_cache_version(style: Optional[str] = None, input_kind: Optional[str] = None) -> dict:
    """What a cached render depends on besides the input image.

    The prompt is the chosen style's plus the shared framing, so a Lego request
    on a drawing that was cached as Pixar misses instead of returning the Pixar
    painting, and a render cached before the framing fix (possibly cropped)
    misses instead of being handed out again. A photo of a person adds the
    likeness clause, so it misses a painting made without it; a drawing's
    version is unchanged.
    """
    return {"prompt": render_prompt(style, input_kind), **RENDER_PARAMS, "framing": FRAMING_PARAMS}


class _Painting:
    """One painting OpenAI sent back, and how it sits in its frame."""

    def __init__(self, image_bytes: bytes, edges: Optional[dict], attempt: int):
        self.image_bytes = image_bytes
        self.edges = edges          # touched_edges(); {} clean, None unjudged
        self.attempt = attempt

    @property
    def cropped(self) -> bool:
        return bool(self.edges)

    @property
    def score(self) -> float:
        """Lower is better: opaque pixels on the image's edges."""
        return float(sum(self.edges.values())) if self.edges is not None else float("inf")


def _paint_once(client, input_path: Path, prompt: str, style: str,
                usage: Optional[UsageContext], attempt: int,
                fill: Optional[float], timeout: float) -> _Painting:
    """One images.edit call, recorded as one usage_event whatever happens.

    `fill` None sends the drawing file unchanged; otherwise it is framed with
    frame_drawing(fill) first (unchanged too if Pillow cannot read it).
    """
    framed = frame_drawing(input_path.read_bytes(), fill=fill) if fill is not None else None
    # COST CAPTURE. One usage_event per call, whatever the outcome.
    #
    # Caveat worth knowing: the OpenAI SDK does its own retries with
    # exponential backoff INSIDE this single call, and those attempts are
    # invisible from here - we see one call, the SDK may have made three.
    # OpenAI does not bill failed attempts, so the money is right; the
    # attempt COUNT in usage_events is a lower bound. The retries that cost
    # real money are the ones at our level - the framing retry below, a user
    # re-running a step, or the pipeline re-running openai_render because a
    # later step failed - and those each come through here and each get their
    # own row.
    #
    # The model/size/quality in RENDER_PARAMS must stay in step with
    # pricing.OPENAI_IMAGE_USD_MICROS.
    with usage_service.track(
        usage,
        pricing.PROVIDER_OPENAI,
        pricing.OP_OPENAI_IMAGE_EDIT,
        quantity=1,
        metadata={
            **{
                k: RENDER_PARAMS[k]
                for k in ("model", "size", "quality", "background", "n")
            },
            "style": style,
            "attempt": attempt,
            "frame_fill": fill if framed is not None else None,
        },
    ) as call:
        if framed is not None:
            response = client.images.edit(
                image=("drawing.png", framed, "image/png"),
                prompt=prompt,
                timeout=timeout,
                **RENDER_PARAMS,
            )
        else:
            with open(input_path, "rb") as img_file:
                response = client.images.edit(
                    image=img_file,
                    prompt=prompt,
                    timeout=timeout,
                    # Note: GPT-Image-1 always returns base64, no response_format parameter needed
                    **RENDER_PARAMS,
                )
        # OpenAI's own request id, so a line in our margin report can be
        # reconciled against a line on their invoice.
        call.provider_ref = getattr(response, "_request_id", None) or getattr(response, "id", None)
        # GPT-Image-1 returns base64 in b64_json field
        image_bytes = base64.b64decode(response.data[0].b64_json)
        edges = touched_edges(image_bytes)
        call.metadata["touched_edges"] = edges
    return _Painting(image_bytes, edges, attempt)


def _retry_paint(client, input_path: Path, prompt: str, style: str,
                 usage: Optional[UsageContext]) -> Optional[_Painting]:
    """The second try, with a wider margin. Never raises: the first painting
    is already in hand, and a failed retry must not turn it into a failure.
    No SDK-level retries and a bounded timeout, so it fits in the step."""
    try:
        quick = client.with_options(max_retries=0) if hasattr(client, "with_options") else client
        return _paint_once(quick, input_path, prompt, style, usage, attempt=2,
                           fill=FRAME_RETRY_FILL, timeout=RETRY_TIMEOUT_S)
    except Exception as e:
        if isinstance(e, RateLimitError) and provider_errors.is_openai_out_of_credits(e):
            provider_errors.alert_out_of_credits(pricing.PROVIDER_OPENAI, str(e))
        logger.warning("Framing retry for %s failed; keeping the first painting: %s",
                       input_path, e)
        return None


def render_image(
    input_path: Path,
    output_path: Path,
    usage: Optional[UsageContext] = None,
    style: Optional[str] = None,
    report: Optional[dict] = None,
    framing: bool = True,
    input_kind: Optional[str] = None,
) -> Path:
    """
    Convert scanned drawing to rendered figure using OpenAI's GPT-Image-1.

    Args:
        input_path: Path to input scanned image
        output_path: Path where rendered image should be saved
        usage: Optional cost-attribution context (user/creation/step). When
            given, every invocation of this function - success, failure, or
            retry - writes one row to usage_events. See app/services/usage.py.
        style: a key of STYLES; None means DEFAULT_STYLE.
        report: if given, filled with how the framing went:
            {"attempts": 1|2, "touched_edges": {...} of the painting kept,
             "first_touched_edges": {...}} (see touched_edges()).
        framing: False sends the drawing and the style's prompt exactly as
            before the framing fix, with no check and no retry. Only for
            before/after comparisons (scripts/render_check.py); the pipeline
            never passes it.
        input_kind: what the upload is (classify_input). INPUT_KIND_PHOTO adds
            the likeness clause; anything else paints it as a drawing.

    Returns:
        Path to output file

    Raises:
        ValueError: If OPENAI_API_KEY is not set
        FileNotFoundError: If input file doesn't exist
        Exception: If API call fails
    """
    if not OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY not found. Set it in .env file.")

    if not input_path.exists():
        raise FileNotFoundError(f"Input image not found: {input_path}")

    # Ensure output directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)

    style = resolve_style(style)
    prompt = render_prompt(style, input_kind) if framing else style_prompt(style)
    client = OpenAI(api_key=OPENAI_API_KEY)

    try:
        logger.info(f"Starting OpenAI GPT-Image-1 render for {input_path} (style {style})")
        started = time.monotonic()

        # Use GPT-Image-1's images.edit() for image-to-image transformation
        # GPT-Image-1 supports full image editing without requiring a mask
        # The OpenAI client has built-in retry logic with exponential backoff
        best = _paint_once(client, input_path, prompt, style, usage, attempt=1,
                           fill=FRAME_FILL if framing else None, timeout=120.0)
        first_edges = best.edges
        attempts = 1

        elapsed = time.monotonic() - started
        if framing and best.cropped:
            if elapsed <= RETRY_IF_FIRST_WITHIN_S:
                logger.warning(
                    "Render of %s runs into the image edge %s; painting it once more with more room",
                    input_path, best.edges,
                )
                attempts = 2
                second = _retry_paint(client, input_path, prompt, style, usage)
                if second is not None and second.score < best.score:
                    best = second
            else:
                logger.warning(
                    "Render of %s runs into the image edge %s; no time left in the step to retry (%.0fs)",
                    input_path, best.edges, elapsed,
                )
            if best.cropped:
                logger.warning("Render of %s keeps touching the edge %s after %d attempt(s)",
                               input_path, best.edges, best.attempt)

        if report is not None:
            report.update({
                "attempts": attempts,
                "kept_attempt": best.attempt,
                "touched_edges": best.edges,
                "first_touched_edges": first_edges,
            })

        logger.info("OpenAI API call succeeded, processing response")
        image_bytes = best.image_bytes

        # Ensure output directory exists
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Save to output path
        with open(output_path, "wb") as f:
            f.write(image_bytes)

        logger.info(f"Successfully saved rendered image to {output_path}")
        return output_path

    except APITimeoutError as e:
        error_msg = (
            f"OpenAI API timeout: The request took longer than 120 seconds.\n"
            f"Original error: {str(e)}\n"
            "This may be due to high API load. The request will be retried automatically, "
            "or you can retry the task manually."
        )
        logger.error(error_msg)
        raise Exception(error_msg) from e
        
    except RateLimitError as e:
        # OpenAI sends "our account is empty" as a 429 too. That is not a rate
        # limit and waiting does not fix it: name it, and raise the ops alert.
        if provider_errors.is_openai_out_of_credits(e):
            provider_errors.alert_out_of_credits(pricing.PROVIDER_OPENAI, str(e))
            raise provider_errors.ProviderOutOfCredits(pricing.PROVIDER_OPENAI, str(e)) from e
        error_msg = (
            f"OpenAI API rate limit exceeded: {str(e)}\n"
            "You've hit OpenAI's rate limits. The request will be retried automatically with backoff. "
            "If this persists, please wait a few minutes and try again."
        )
        logger.warning(error_msg)
        raise Exception(error_msg) from e
        
    except APIConnectionError as e:
        error_msg = (
            f"OpenAI API connection error: {str(e)}\n"
            "Failed to connect to OpenAI's servers. This may be a network issue. "
            "The request will be retried automatically."
        )
        logger.error(error_msg)
        raise Exception(error_msg) from e
        
    except APIError as e:
        error_str = str(e)
        status_code = getattr(e, 'status_code', None)
        
        # Handle 500 Internal Server Error specifically
        if status_code == 500:
            error_msg = (
                f"OpenAI API server error (500): {error_str}\n"
                "OpenAI's servers returned an internal error. This is usually temporary. "
                "The OpenAI client will automatically retry with exponential backoff. "
                "If this persists after several retries, please try again later or contact OpenAI support."
            )
            logger.warning(f"OpenAI 500 error (will retry): {error_msg}")
            raise Exception(error_msg) from e
        
        # Handle 502/503/504 gateway errors
        if status_code in (502, 503, 504):
            error_msg = (
                f"OpenAI API gateway error ({status_code}): {error_str}\n"
                "OpenAI's gateway is experiencing issues. The request will be retried automatically."
            )
            logger.warning(f"OpenAI gateway error (will retry): {error_msg}")
            raise Exception(error_msg) from e
        
        # Provide helpful error message for organization verification
        if "organization must be verified" in error_str.lower() or status_code == 403:
            error_msg = (
                f"OpenAI API error: {error_str}\n"
                "Your organization must be verified to use GPT-Image-1. "
                "Please go to: https://platform.openai.com/settings/organization/general "
                "and click on Verify Organization. If you just verified, it can take up to 15 minutes for access to propagate."
            )
            logger.error(error_msg)
            raise Exception(error_msg) from e
        
        # Handle moderation/safety system rejection
        if "moderation_blocked" in error_str.lower() or "rejected by the safety system" in error_str.lower():
            error_msg = (
                f"OpenAI API error: {error_str}\n"
                "The image or prompt was rejected by OpenAI's safety system. "
                "This can happen if the content violates OpenAI's usage policies. "
                "Try using a different image or contact OpenAI support if you believe this is an error."
            )
            logger.error(error_msg)
            raise Exception(error_msg) from e
        
        # Handle 400 Bad Request
        if status_code == 400:
            error_msg = (
                f"OpenAI API bad request (400): {error_str}\n"
                "The request was invalid. This may be due to an unsupported image format or size. "
                "Please check that the input image is valid."
            )
            logger.error(error_msg)
            raise Exception(error_msg) from e
        
        # Wrap other API errors with descriptive message
        error_msg = f"OpenAI API error (status {status_code}): {error_str}"
        logger.error(error_msg)
        raise Exception(error_msg) from e
        
    except Exception as e:
        error_str = str(e)
        error_msg = f"Unexpected error during OpenAI API call: {error_str}"
        logger.error(error_msg, exc_info=True)
        raise Exception(error_msg) from e


# ---------------------------------------------------------------------------
# Hero naming: one cheap vision call that names a new hero from its drawing.
#
# Runs alongside the free image_processing step (see
# app/services/hero_naming.py), is never charged to the user in credits, and
# is recorded as a usage_event so finance sees it. Everything here may fail;
# the caller swallows it and the hero keeps the UI's "Your hero".
#
# The prompt is generic on purpose: nothing in it describes a particular
# drawing. The example names show the KIND of name; the prompt says not to
# reuse them.
# ---------------------------------------------------------------------------

HERO_NAME_MODEL = "gpt-4.1-mini"

# A hard ceiling on the HTTP call, with no SDK retries: a name is a nicety and
# must never hold anything up.
HERO_NAME_TIMEOUT_S = 10.0

# The drawing is shrunk before it is sent: "low" detail is all a name needs,
# and a phone photo of a page is megabytes that would only slow the upload.
HERO_NAME_IMAGE_MAX_PX = 512
HERO_NAME_IMAGE_DETAIL = "low"

HERO_NAME_MAX_WORDS = 3
HERO_NAME_MAX_CHARS = 24

HERO_NAME_PROMPT = """You give names to characters that children draw. Look at this drawing and name the character in it.

How to choose the name:
- Base it on what is visibly drawn: what the character is (for example an animal, a robot, a monster, a person, a creature or an object), what it looks like, and its main colours.
- Make it fun and kid-friendly: an alliterative or playful name of 1 to 3 words that a child would love. These show the kind of name only; do not reuse them: "Prickle Pete", "Brick Bo", "Ruby Rocket".
- If the child wrote a name for the character in the drawing, prefer that name. If it is only a first name, add one playful word to it.
- English only, each word starting with a capital letter.

Never use:
- a real person's name on its own, or the name of a famous person or of a character from a film, show, game or book
- a brand, company, product or trademark name
- anything scary, rude or mean, or anything that mocks how the drawing looks
- numbers, emoji, quotation marks or other symbols

Answer with JSON only, in the form {"name": "..."}."""

# Structured Outputs: the model can only answer {"name": "<string>"}.
HERO_NAME_RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "hero_name",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
            "additionalProperties": False,
        },
    },
}

# Straight, curly and angle quotes. All are dropped from a name.
_QUOTES = "\"'`‘’‚‛“”„‟«»‹›"


def hero_name_cache_version() -> dict:
    """What a cached name depends on besides the drawing (result_cache key)."""
    return {
        "prompt": HERO_NAME_PROMPT,
        "model": HERO_NAME_MODEL,
        "image_max_px": HERO_NAME_IMAGE_MAX_PX,
        "detail": HERO_NAME_IMAGE_DETAIL,
    }


def sanitize_hero_name(raw) -> Optional[str]:
    """
    Make whatever the model said safe to show as a hero's name, or None.

    Trimmed; quotes, emoji, digits and other symbols removed (letters, spaces
    and inner hyphens survive); at most HERO_NAME_MAX_WORDS words and
    HERO_NAME_MAX_CHARS characters, cut at a word boundary where possible.
    """
    if not isinstance(raw, str):
        return None
    text = unicodedata.normalize("NFKC", raw)
    text = "".join(" " if ch in _QUOTES else ch for ch in text)
    text = "".join(ch if (ch.isalpha() or ch in " -") else " " for ch in text)
    words = [re.sub(r"-{2,}", "-", w.strip("-")) for w in text.split()]
    words = [w for w in words if w][:HERO_NAME_MAX_WORDS]
    while len(words) > 1 and len(" ".join(words)) > HERO_NAME_MAX_CHARS:
        words.pop()
    name = " ".join(words)[:HERO_NAME_MAX_CHARS].strip(" -")
    return name or None


def _hero_name_image_data_url(image_bytes: bytes) -> str:
    """The drawing as a small JPEG data URL."""
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(image_bytes)) as opened:
        img = ImageOps.exif_transpose(opened)
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            flat = Image.new("RGB", img.size, (255, 255, 255))
            flat.paste(img, mask=img.split()[-1])
            img = flat
        else:
            img = img.convert("RGB")
        img.thumbnail((HERO_NAME_IMAGE_MAX_PX, HERO_NAME_IMAGE_MAX_PX))
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode("ascii")


def suggest_hero_name(image_bytes: bytes, usage: Optional[UsageContext] = None) -> Optional[str]:
    """
    Ask HERO_NAME_MODEL for a name for the character in this drawing.

    Returns the sanitized name, or None if the answer had nothing usable in
    it. RAISES on a missing key, an unreadable image, a timeout or any API
    error: the caller (hero_naming.name_creation) turns every failure into
    "no name" and logs it.

    Every call that reaches OpenAI writes one usage_event (provider "openai",
    operation pricing.OP_OPENAI_HERO_NAME), costed from the token counts the
    response reports.
    """
    if not OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY not set")

    data_url = _hero_name_image_data_url(image_bytes)
    client = OpenAI(api_key=OPENAI_API_KEY, timeout=HERO_NAME_TIMEOUT_S, max_retries=0)

    with usage_service.track(
        usage,
        pricing.PROVIDER_OPENAI,
        pricing.OP_OPENAI_HERO_NAME,
        quantity=1,
        metadata={"model": HERO_NAME_MODEL, "detail": HERO_NAME_IMAGE_DETAIL},
    ) as call:
        response = client.chat.completions.create(
            model=HERO_NAME_MODEL,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": HERO_NAME_PROMPT},
                    {"type": "image_url",
                     "image_url": {"url": data_url, "detail": HERO_NAME_IMAGE_DETAIL}},
                ],
            }],
            response_format=HERO_NAME_RESPONSE_FORMAT,
            max_completion_tokens=40,
            temperature=0.9,
            timeout=HERO_NAME_TIMEOUT_S,
        )
        call.provider_ref = getattr(response, "_request_id", None) or getattr(response, "id", None)
        tokens = getattr(response, "usage", None)
        if tokens is not None:
            prompt_tokens = int(getattr(tokens, "prompt_tokens", 0) or 0)
            completion_tokens = int(getattr(tokens, "completion_tokens", 0) or 0)
            call.metadata["prompt_tokens"] = prompt_tokens
            call.metadata["completion_tokens"] = completion_tokens
            call.cost_usd_micros = pricing.hero_name_cost_usd_micros(
                prompt_tokens, completion_tokens
            )

    content = response.choices[0].message.content or ""
    try:
        raw = json.loads(content).get("name")
    except (ValueError, AttributeError):
        # Not the JSON we asked for: let the sanitizer judge the raw text.
        raw = content
    name = sanitize_hero_name(raw)
    logger.info("Hero name suggested: %r (raw %r)", name, raw)
    return name


# ---------------------------------------------------------------------------
# What the upload is: a drawing, or a photo of a real person.
#
# One small vision call, the same model and image size as the naming call, made
# once per hero (app/services/input_kind.py stores the answer on the creation
# and in the staging result cache). Never charged to the user in credits;
# recorded as a usage_event like the naming call. Every failure, and every
# answer that is not exactly one of INPUT_KINDS, means "drawing": a drawing
# painted as a drawing is what the product has always done.
#
# A photo OF a drawing is a drawing: that is how most drawings arrive.
# ---------------------------------------------------------------------------

INPUT_KIND_MODEL = HERO_NAME_MODEL
INPUT_KIND_TIMEOUT_S = 10.0
INPUT_KIND_IMAGE_DETAIL = HERO_NAME_IMAGE_DETAIL

INPUT_KIND_PROMPT = """Look at this picture and say what kind of picture it is.

- "photo_of_person": a photograph, taken with a camera, of one or more real people.
- "drawing": a drawing, painting, sketch, cartoon, comic or any other artwork, of anyone or anything. A photograph of a drawing on paper or on a screen is a drawing. A drawing of a person is a drawing.
- "other": any other photograph, such as a toy, a doll, a figurine, a statue, an animal, an object or a place, with no real person in it.

If you are not sure, answer "drawing".

Answer with JSON only, in the form {"kind": "..."}."""

INPUT_KIND_RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "input_kind",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {"kind": {"type": "string", "enum": list(INPUT_KINDS)}},
            "required": ["kind"],
            "additionalProperties": False,
        },
    },
}


def input_kind_cache_version() -> dict:
    """What a cached classification depends on besides the image (result_cache key)."""
    return {
        "prompt": INPUT_KIND_PROMPT,
        "model": INPUT_KIND_MODEL,
        "image_max_px": HERO_NAME_IMAGE_MAX_PX,
        "detail": INPUT_KIND_IMAGE_DETAIL,
        "kinds": list(INPUT_KINDS),
    }


def parse_input_kind(raw) -> str:
    """The model's answer as one of INPUT_KINDS; anything unexpected is a drawing."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return INPUT_KIND_DRAWING
    kind = raw.get("kind") if isinstance(raw, dict) else None
    return kind if kind in INPUT_KINDS else INPUT_KIND_DRAWING


def classify_input(image_bytes: bytes, usage: Optional[UsageContext] = None) -> str:
    """
    Ask INPUT_KIND_MODEL whether this upload is a photo of a real person.

    Returns one of INPUT_KINDS. RAISES on a missing key, an unreadable image, a
    timeout or an API error: the caller (input_kind.kind_for_creation) turns
    every failure into INPUT_KIND_DRAWING and logs it. An unreadable image is
    caught before any request is made, so it costs nothing.

    Every call that reaches OpenAI writes one usage_event (provider "openai",
    operation pricing.OP_OPENAI_INPUT_KIND), costed from its token counts.
    """
    if not OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY not set")

    # The naming call's shrink: a small JPEG, "low" detail.
    data_url = _hero_name_image_data_url(image_bytes)
    client = OpenAI(api_key=OPENAI_API_KEY, timeout=INPUT_KIND_TIMEOUT_S, max_retries=0)

    with usage_service.track(
        usage,
        pricing.PROVIDER_OPENAI,
        pricing.OP_OPENAI_INPUT_KIND,
        quantity=1,
        metadata={"model": INPUT_KIND_MODEL, "detail": INPUT_KIND_IMAGE_DETAIL},
    ) as call:
        response = client.chat.completions.create(
            model=INPUT_KIND_MODEL,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": INPUT_KIND_PROMPT},
                    {"type": "image_url",
                     "image_url": {"url": data_url, "detail": INPUT_KIND_IMAGE_DETAIL}},
                ],
            }],
            response_format=INPUT_KIND_RESPONSE_FORMAT,
            max_completion_tokens=20,
            temperature=0,
            timeout=INPUT_KIND_TIMEOUT_S,
        )
        call.provider_ref = getattr(response, "_request_id", None) or getattr(response, "id", None)
        tokens = getattr(response, "usage", None)
        if tokens is not None:
            prompt_tokens = int(getattr(tokens, "prompt_tokens", 0) or 0)
            completion_tokens = int(getattr(tokens, "completion_tokens", 0) or 0)
            call.metadata["prompt_tokens"] = prompt_tokens
            call.metadata["completion_tokens"] = completion_tokens
            # Same model, same list rates as the naming call.
            call.cost_usd_micros = pricing.hero_name_cost_usd_micros(
                prompt_tokens, completion_tokens
            )
        kind = parse_input_kind(response.choices[0].message.content or "")
        call.metadata["kind"] = kind

    logger.info("Input classified as %r", kind)
    return kind

