"""
The deployed app version, "v<N> · <short sha>" (see devops/scripts/app-version.sh).

Resolution order: the APP_VERSION env var, then app/VERSION (written by the
deploy job before `railway up`), then "dev".
"""
import os
from pathlib import Path

VERSION_FILE = Path(__file__).resolve().parent / "VERSION"


def get_version() -> str:
    env = os.getenv("APP_VERSION", "").strip()
    if env:
        return env
    try:
        text = VERSION_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        text = ""
    return text or "dev"
