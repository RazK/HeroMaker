"""
OpenAI Image Rendering Service - GPT-Image-1 integration for image-to-image transformation.

Uses OpenAI's GPT-Image-1 model to transform child drawings into 3D renders optimized for Meshy.
"""

import base64
import logging
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

ORIGINAL_PROMPT = """Turn this drawing into a 3D figure that looks exactly like the drawing, in T-pose position.

Requirements:
- One single character, as close to the drawing as possible: the same shapes, the same proportions, the same colors
- Keep the look of the drawing itself: the texture of whatever it was drawn with, its outlines and its coloring
- Keep the face readable: every facial feature in the drawing stays in the same place, size and color, clearly visible
- White counts as a color: areas left white or uncolored inside the character (such as the whites of eyes, teeth or highlights) stay white, never filled in with a neighboring color
- Unfiltered: do not beautify, correct, smooth or add anything; no details that are not in the drawing
- Give it real volume, as if the drawing itself had become a solid handmade figure
- Front view, full body visible, standing upright, fully contained in the view without cropping.
- T-pose: arms extended horizontally, legs straight
- Transparent background: only the character, no paper, no floor, no ground shadow, no scenery
- No added text: leave out any name, caption or signature written beside the character; an emblem drawn on the costume stays
- Well-lit, clean silhouette edges, good contrast

Render the character exactly as drawn, only made three-dimensional, with arms extended horizontally, ready for 3D model generation."""

# Ordered: this is the order the picker shows them in.
STYLES = {
    "pixar": {"label": "Pixar", "prompt": RENDER_PROMPT},
    "lego": {"label": "Lego", "prompt": LEGO_PROMPT},
    "minecraft": {"label": "Minecraft", "prompt": MINECRAFT_PROMPT},
    "anime": {"label": "Anime", "prompt": ANIME_PROMPT},
    "original": {"label": "Original", "prompt": ORIGINAL_PROMPT},
}


def list_styles() -> list:
    """[{key, label}] in picker order. What GET /api/styles answers."""
    return [{"key": key, "label": s["label"]} for key, s in STYLES.items()]


def is_valid_style(style: Optional[str]) -> bool:
    return style in STYLES


def resolve_style(style: Optional[str]) -> str:
    """The style a stored value means. NULL (every hero made before styles) is
    the default. A value no longer in the registry also falls back to it, so a
    retired style can never stop an old hero from being made again."""
    if style is None or style == "":
        return DEFAULT_STYLE
    if style not in STYLES:
        logger.warning("Unknown render style %r; using %r", style, DEFAULT_STYLE)
        return DEFAULT_STYLE
    return style


def style_prompt(style: Optional[str] = None) -> str:
    return STYLES[resolve_style(style)]["prompt"]

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


def render_cache_version(style: Optional[str] = None) -> dict:
    """What a cached render depends on besides the input image.

    The prompt is the chosen style's, so a Lego request on a drawing that was
    cached as Pixar misses instead of returning the Pixar painting. For the
    default style this is exactly what it was before styles existed (no extra
    key), so the entries already in the cache keep hitting.
    """
    return {"prompt": style_prompt(style), **RENDER_PARAMS}


def render_image(
    input_path: Path,
    output_path: Path,
    usage: Optional[UsageContext] = None,
    style: Optional[str] = None,
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
    prompt = STYLES[style]["prompt"]
    client = OpenAI(api_key=OPENAI_API_KEY)
    
    try:
        logger.info(f"Starting OpenAI GPT-Image-1 render for {input_path} (style {style})")
        
        # Use GPT-Image-1's images.edit() for image-to-image transformation
        # GPT-Image-1 supports full image editing without requiring a mask
        # The OpenAI client has built-in retry logic with exponential backoff
        # COST CAPTURE. One usage_event per invocation, whatever the outcome.
        #
        # Caveat worth knowing: the OpenAI SDK does its own retries with
        # exponential backoff INSIDE this single call, and those attempts are
        # invisible from here - we see one call, the SDK may have made three.
        # OpenAI does not bill failed attempts, so the money is right; the
        # attempt COUNT in usage_events is a lower bound. The retries that cost
        # real money are the ones at our level - a user re-running a step, or
        # the pipeline re-running openai_render because a later step failed -
        # and those each come through here and each get their own row.
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
            },
        ) as call:
            with open(input_path, "rb") as img_file:
                response = client.images.edit(
                    image=img_file,
                    prompt=prompt,
                    timeout=120.0,  # 2 minute timeout per request
                    # Note: GPT-Image-1 always returns base64, no response_format parameter needed
                    **RENDER_PARAMS,
                )
            # OpenAI's own request id, so a line in our margin report can be
            # reconciled against a line on their invoice.
            call.provider_ref = getattr(response, "_request_id", None) or getattr(response, "id", None)
        
        logger.info("OpenAI API call succeeded, processing response")
        
        # GPT-Image-1 returns base64 in b64_json field
        image_base64 = response.data[0].b64_json
        image_bytes = base64.b64decode(image_base64)
        
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

