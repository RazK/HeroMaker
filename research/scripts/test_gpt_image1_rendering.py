#!/usr/bin/env python3
"""
Test script for OpenAI GPT-Image-1 images.edit() API.
This is the latest model that ChatGPT chat uses for image editing.
"""

import base64
import sys
import os
from pathlib import Path
from openai import OpenAI
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Get API key from environment
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# Prompt for transforming child's drawing to 3D render in T-pose
PROMPT_TEXT = """Transform this child's drawing into a professional 3D character render optimized for Meshy's image-to-3D conversion. 

CRITICAL REQUIREMENTS:
- Preserve EVERY detail from the original: exact colors, clothing, accessories, character features
- Front-facing view, full body visible, standing upright in T-POSE (arms extended horizontally at shoulder level, forming a T shape)
- Plain white or simple background (no distractions)
- High resolution, sharp, well-lit, professional 3D render style
- Maintain the child's original artistic style and character personality
- Clean edges, good contrast between character and background
- Character MUST be in T-pose position - arms straight out horizontally, legs straight, standing upright

The character should look exactly like the original drawing, just rendered in a clean 3D style in T-pose that will work perfectly for 3D model generation and rigging."""


def test_gpt_image1_edit(client: OpenAI, input_path: Path, output_path: Path) -> dict:
    """Test GPT-Image-1 images.edit() with prompt + image (no mask = full edit)."""
    print("\n" + "=" * 60)
    print("Testing: GPT-Image-1 images.edit()")
    print("=" * 60)
    print("Note: This is the latest model ChatGPT chat uses for image editing.")
    print()
    
    try:
        with open(input_path, "rb") as img_file:
            response = client.images.edit(
                model="gpt-image-1",
                image=img_file,
                prompt=PROMPT_TEXT,
                size="1024x1024",
                quality="high",
                n=1
                # Note: GPT-Image-1 always returns base64, no response_format parameter
            )
        
        # GPT-Image-1 returns base64 in b64_json field
        image_base64 = response.data[0].b64_json
        image_bytes = base64.b64decode(image_base64)
        
        # Save the rendered image
        with open(output_path, "wb") as f:
            f.write(image_bytes)
        
        print(f"✓ Success! Saved to: {output_path}")
        return {"success": True, "output_path": output_path}
        
    except Exception as e:
        error_str = str(e)
        print(f"✗ Failed: {error_str}")
        
        if "organization must be verified" in error_str.lower():
            print("\n⚠️  Organization verification required.")
            print("   Try: https://platform.openai.com/settings/organization/general")
        
        return {"success": False, "error": error_str}


def main():
    """Main test function."""
    if not OPENAI_API_KEY:
        print("❌ Error: OPENAI_API_KEY not found. Set it in .env file.")
        return 1
    
    # Use the crayon kid image
    input_path = Path("assets/research/test_data/input_images/Crayon Superhero.png")
    
    if not input_path.exists():
        print(f"❌ Error: Input image not found: {input_path}")
        print("   Please provide the path to your scanned drawing.")
        return 1
    
    # Create output directory for test results
    output_dir = Path("assets/research/test_data/rendering_tests")
    output_dir.mkdir(parents=True, exist_ok=True)
    
    output_path = output_dir / "crayon_kid_gpt_image1_rendered.png"
    
    print("=" * 60)
    print("OpenAI GPT-Image-1 Image Rendering Test")
    print("=" * 60)
    print(f"Input: {input_path}")
    print(f"Output: {output_path}")
    print()
    
    client = OpenAI(api_key=OPENAI_API_KEY)
    
    # Test GPT-Image-1 edit
    result = test_gpt_image1_edit(client, input_path, output_path)
    
    if result["success"]:
        print("\n✓ Success!")
        print(f"  Output: {result['output_path']}")
        return 0
    else:
        print("\n✗ Failed")
        print(f"  Error: {result.get('error', 'Unknown error')}")
        return 1


if __name__ == "__main__":
    sys.exit(main())

