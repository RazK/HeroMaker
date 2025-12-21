"""
Image Processing Service - Simple image processing utilities.
For now, this is a pass-through (copy file). Future enhancements can include:
- Image enhancement
- Resizing
- Format conversion
- Quality optimization
"""

import shutil
from pathlib import Path


def process_image(input_path: Path, output_path: Path) -> Path:
    """
    Process an image file. Currently just copies the file.
    
    Args:
        input_path: Path to input image file
        output_path: Path where output should be saved
    
    Returns:
        Path to output file
    
    Raises:
        FileNotFoundError: If input file doesn't exist
        IOError: If file operations fail
    """
    if not input_path.exists():
        raise FileNotFoundError(f"Input image not found: {input_path}")
    
    # Ensure output directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Copy file (simple pass-through for now)
    shutil.copy2(input_path, output_path)
    
    return output_path

