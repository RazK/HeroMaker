"""
Image Rendering Service - OpenAI GPT-Image-1 integration for image-to-image transformation.

Uses OpenAI's GPT-Image-1 model to transform child drawings into 3D renders optimized for Meshy.
"""

import base64
import logging
from pathlib import Path
from openai import OpenAI
from openai import APIError, APIConnectionError, APITimeoutError, RateLimitError
from app.config.settings import OPENAI_API_KEY

logger = logging.getLogger(__name__)


def render_image(input_path: Path, output_path: Path) -> Path:
    """
    Convert scanned drawing to rendered figure using OpenAI's GPT-Image-1.
    
    Args:
        input_path: Path to input scanned image
        output_path: Path where rendered image should be saved
    
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
    
    client = OpenAI(api_key=OPENAI_API_KEY)
    
    # Prompt for transforming drawing to 3D render in T-pose
    # Note: Keep prompt neutral to avoid OpenAI's safety filters
    # Avoid words like "child", "weapon", "violence", character names that might trigger moderation
    prompt_text = """Transform this drawing into a professional 3D character render in T-pose position. 

Requirements:
- Keep all original details: colors, clothing, accessories, features
- Front view, full body visible, standing upright
- T-pose: arms extended horizontally, legs straight
- White or simple background
- High quality 3D render style, well-lit
- Clean edges, good contrast

Render the character exactly as shown, in a clean 3D style with arms extended horizontally, ready for 3D model generation."""
    
    try:
        logger.info(f"Starting OpenAI GPT-Image-1 render for {input_path}")
        
        # Use GPT-Image-1's images.edit() for image-to-image transformation
        # GPT-Image-1 supports full image editing without requiring a mask
        # The OpenAI client has built-in retry logic with exponential backoff
        with open(input_path, "rb") as img_file:
            response = client.images.edit(
                model="gpt-image-1",
                image=img_file,
                prompt=prompt_text,
                size="1024x1024",
                quality="high",
                n=1,
                timeout=120.0  # 2 minute timeout per request
                # Note: GPT-Image-1 always returns base64, no response_format parameter needed
            )
        
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

