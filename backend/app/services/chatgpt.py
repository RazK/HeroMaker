"""
Image Rendering Service - OpenAI GPT-Image-1 integration for image-to-image transformation.

Uses OpenAI's GPT-Image-1 model to transform child drawings into 3D renders optimized for Meshy.
"""

import base64
from pathlib import Path
from openai import OpenAI
from app.config.settings import OPENAI_API_KEY


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
        # Use GPT-Image-1's images.edit() for image-to-image transformation
        # GPT-Image-1 supports full image editing without requiring a mask
        with open(input_path, "rb") as img_file:
            response = client.images.edit(
                model="gpt-image-1",
                image=img_file,
                prompt=prompt_text,
                size="1024x1024",
                quality="high",
                n=1
                # Note: GPT-Image-1 always returns base64, no response_format parameter needed
            )
        
        # GPT-Image-1 returns base64 in b64_json field
        image_base64 = response.data[0].b64_json
        image_bytes = base64.b64decode(image_base64)
        
        # Save to output path
        with open(output_path, "wb") as f:
            f.write(image_bytes)
        
        return output_path
        
    except Exception as e:
        error_str = str(e)
        
        # Provide helpful error message for organization verification
        if "organization must be verified" in error_str.lower():
            raise Exception(
                f"OpenAI API error: {error_str}\n"
                "Your organization must be verified to use GPT-Image-1. "
                "Please go to: https://platform.openai.com/settings/organization/general "
                "and click on Verify Organization. If you just verified, it can take up to 15 minutes for access to propagate."
            ) from e
        
        # Handle moderation/safety system rejection
        if "moderation_blocked" in error_str.lower() or "rejected by the safety system" in error_str.lower():
            raise Exception(
                f"OpenAI API error: {error_str}\n"
                "The image or prompt was rejected by OpenAI's safety system. "
                "This can happen if the content violates OpenAI's usage policies. "
                "Try using a different image or contact OpenAI support if you believe this is an error."
            ) from e
        
        # Wrap other errors with descriptive message
        raise Exception(f"OpenAI API error: {error_str}") from e
