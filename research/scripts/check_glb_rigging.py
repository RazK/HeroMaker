#!/usr/bin/env python3
"""
Standalone script to check if a GLB file contains rigging/skeleton data.

Usage:
    python check_glb_rigging.py <path_to_glb_file>
    python check_glb_rigging.py assets/research/test_data/intermediate_outputs/girl_superhero_rigged.glb
"""

import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from research.scripts.test_utils import check_glb_rigging

def main():
    parser = argparse.ArgumentParser(
        description="Check if a GLB file contains rigging/skeleton data",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python check_glb_rigging.py model.glb
  python check_glb_rigging.py assets/research/test_data/intermediate_outputs/*.glb
        """
    )
    parser.add_argument(
        "glb_file",
        type=str,
        help="Path to GLB file to check"
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Show detailed joint information"
    )
    
    args = parser.parse_args()
    
    glb_path = Path(args.glb_file)
    
    if not glb_path.exists():
        print(f"❌ Error: File not found: {glb_path}")
        return 1
    
    print(f"Checking GLB file: {glb_path}")
    print("=" * 60)
    
    rigging_info = check_glb_rigging(glb_path)
    
    if rigging_info.get("error"):
        print(f"❌ Error: {rigging_info['error']}")
        return 1
    
    if rigging_info.get("has_rigging"):
        print("✓ Rigging detected!")
        print(f"  Skins: {rigging_info['skin_count']}")
        print(f"  Joints: {rigging_info['joint_count']}")
        
        if args.verbose and rigging_info.get("joint_names"):
            print("\nJoint names:")
            for i, joint_name in enumerate(rigging_info['joint_names'], 1):
                print(f"  {i:2d}. {joint_name}")
        elif rigging_info.get("joint_names"):
            print(f"\nFirst 10 joints: {', '.join(rigging_info['joint_names'][:10])}")
            if len(rigging_info['joint_names']) > 10:
                print(f"  ... and {len(rigging_info['joint_names']) - 10} more")
                print(f"  (Use --verbose to see all joints)")
    else:
        print("⚠️  No rigging data found in GLB file")
        print("   This file does not contain skeleton/armature data.")
    
    print("=" * 60)
    return 0

if __name__ == "__main__":
    sys.exit(main())

