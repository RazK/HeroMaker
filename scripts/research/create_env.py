#!/usr/bin/env python3
"""Create .env file with Meshy API key."""

from pathlib import Path

env_content = """MESHY_API_KEY=msy_7oMC8QcW6EMjWo5jnTazpCQJCEh2ZN7OIwu9
"""

project_root = Path(__file__).parent.parent.parent
env_file = project_root / ".env"

env_file.write_text(env_content)
print(f"✓ Created .env file at: {env_file}")
print("✓ API key configured")
