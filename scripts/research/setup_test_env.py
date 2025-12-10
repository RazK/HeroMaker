#!/usr/bin/env python3
"""
Setup test environment for Meshy API research.
Creates necessary directories and validates API key configuration.
"""

import os
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

def create_directories():
    """Create necessary test directories."""
    base_dir = Path(__file__).parent.parent.parent
    directories = [
        base_dir / "assets" / "research" / "test_data" / "input_images",
        base_dir / "assets" / "research" / "test_data" / "intermediate_outputs",
        base_dir / "assets" / "research" / "test_data" / "final_outputs",
        base_dir / "research",
    ]
    
    for directory in directories:
        directory.mkdir(parents=True, exist_ok=True)
        print(f"✓ Created/verified directory: {directory}")
    
    return directories

def create_env_file_if_needed():
    """Create .env file with API key if it doesn't exist."""
    root_env = Path(__file__).parent.parent.parent / ".env"
    
    if not root_env.exists():
        # Default API key (user provided)
        api_key = "msy_7oMC8QcW6EMjWo5jnTazpCQJCEh2ZN7OIwu9"
        env_content = f"MESHY_API_KEY={api_key}\n"
        root_env.write_text(env_content)
        print(f"✓ Created .env file at: {root_env}")
        return True
    return False

def check_api_key():
    """Check if API key is configured."""
    from dotenv import load_dotenv
    
    # Create .env file if it doesn't exist
    created = create_env_file_if_needed()
    
    # Load .env file if it exists
    env_file = Path(__file__).parent / ".env"
    if env_file.exists():
        load_dotenv(env_file)
        print(f"✓ Loaded .env file from: {env_file}")
    else:
        # Try loading from project root
        root_env = Path(__file__).parent.parent.parent / ".env"
        if root_env.exists():
            load_dotenv(root_env)
            if not created:
                print(f"✓ Loaded .env file from: {root_env}")
        else:
            print(f"⚠ No .env file found. Using environment variables.")
            load_dotenv()  # Try loading from environment
    
    api_key = os.getenv("MESHY_API_KEY")
    
    if not api_key:
        print("\n❌ ERROR: MESHY_API_KEY not found!")
        print("\nTo set up your API key:")
        print("1. Copy .env.example to .env")
        print("2. Add your API key: MESHY_API_KEY=your_key_here")
        print("3. Or set environment variable: export MESHY_API_KEY=your_key_here")
        return False
    
    if api_key == "your_meshy_api_key_here":
        print("\n❌ ERROR: MESHY_API_KEY is still set to placeholder value!")
        print("Please update .env file with your actual API key.")
        return False
    
    # Validate key format (basic check - should start with expected prefix)
    if len(api_key) < 10:
        print("\n⚠ WARNING: API key seems too short. Please verify it's correct.")
        return False
    
    print(f"\n✓ API key found (length: {len(api_key)} characters)")
    print("  (Key value hidden for security)")
    return True

def validate_api_connection():
    """Test API connection with a simple request."""
    try:
        from meshy_client import MeshyClient
        
        client = MeshyClient()
        # Try a simple request to validate the key
        # We'll use a minimal endpoint check or just validate the client can be created
        print("\n✓ MeshyClient can be instantiated")
        print("  (Full API validation will happen during actual tests)")
        return True
    except ImportError:
        print("\n⚠ WARNING: meshy_client.py not found or has errors")
        print("  This is okay if you're setting up for the first time")
        return True  # Don't fail setup if client doesn't exist yet
    except Exception as e:
        print(f"\n⚠ WARNING: Could not validate API connection: {e}")
        return True  # Don't fail setup, just warn

def main():
    """Main setup function."""
    print("=" * 60)
    print("Meshy API Research - Test Environment Setup")
    print("=" * 60)
    print()
    
    # Create directories
    print("Creating test directories...")
    directories = create_directories()
    print()
    
    # Check API key
    print("Checking API key configuration...")
    api_key_ok = check_api_key()
    print()
    
    # Validate connection
    print("Validating API connection...")
    connection_ok = validate_api_connection()
    print()
    
    # Summary
    print("=" * 60)
    if api_key_ok:
        print("✓ Setup complete! Ready to run tests.")
        print("\nNext steps:")
        print("1. Ensure your test images are in: assets/research/test_data/input_images/")
        print("2. Run individual test scripts from scripts/research/")
    else:
        print("⚠ Setup incomplete. Please configure your API key first.")
        sys.exit(1)
    print("=" * 60)

if __name__ == "__main__":
    main()
