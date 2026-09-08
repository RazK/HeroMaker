"""
Copy creations from one HeroMaker deployment into another, over HTTPS.

Why this exists
---------------
`scripts/clone_env_data.py` is the real cloning tool, but its database half
needs raw TCP to Railway's Postgres proxy on a non-443 port. From a sandboxed
agent - or any network that only allows HTTPS - that is unreachable. This module
is the HTTPS-only path: the *destination* backend pulls the files from the
source's public file endpoint and writes the rows itself, so the only thing the
caller needs is an ordinary HTTPS request to the destination.

This is developer plumbing, not product. Three gates keep it that way:

1. the endpoint using it requires an authenticated **admin** user,
2. `ALLOW_DATA_IMPORT=true` must be set - default off, so the code is inert
   wherever it has not been deliberately switched on (production included), and
3. files may only be fetched from a small allowlist of hosts, over https.

Every import logs a loud banner, so nobody has to wonder afterwards whether a
creation in the gallery was made by the pipeline or copied in by hand.
"""
import logging
import os
from typing import Iterable, Optional
from urllib.parse import urlparse

import requests

from sqlalchemy.orm import Session

from app.models import User

logger = logging.getLogger(__name__)

# Files the importer will fetch. A whitelist rather than "whatever was asked
# for", so a caller cannot use an admin session to pull arbitrary paths off the
# source host and park them in this environment's bucket. Thumbnails and
# web_-optimised models are deliberately absent: they regenerate on first
# request from the originals.
ALLOWED_FILENAMES = frozenset({
    "original.jpg",
    "processed.jpg",
    "rendered.png",
    "model.glb",
    "rigged.glb",
    "walking.glb",
    "avatar.vrm",
})

# Hosts the importer may fetch files from, unless DATA_IMPORT_SOURCE_HOSTS says
# otherwise. Production's file endpoint is public, which is what makes the whole
# HTTPS path possible.
DEFAULT_SOURCE_HOSTS = "heromaker.up.railway.app"

# A rigged GLB is a few megabytes; anything far past that is not one of ours.
MAX_FILE_BYTES = 128 * 1024 * 1024

FETCH_TIMEOUT_SECONDS = 180


class ImportDisabled(RuntimeError):
    """Raised when the import path is switched off in this environment."""


class ImportSourceRejected(ValueError):
    """Raised when the requested source URL or filename is not permitted."""


def import_enabled() -> bool:
    """True only when ALLOW_DATA_IMPORT is explicitly set to 'true'."""
    return os.getenv("ALLOW_DATA_IMPORT", "").strip().lower() == "true"


def require_import_enabled() -> None:
    """Guard for callers: raise unless this environment opted in."""
    if not import_enabled():
        raise ImportDisabled(
            "Data import is disabled. Set ALLOW_DATA_IMPORT=true on this "
            "environment to enable it. It must stay off in production."
        )


def allowed_source_hosts() -> frozenset[str]:
    """Hosts files may be fetched from (comma-separated env override)."""
    raw = os.getenv("DATA_IMPORT_SOURCE_HOSTS", DEFAULT_SOURCE_HOSTS)
    return frozenset(h.strip().lower() for h in raw.split(",") if h.strip())


def validate_source_base_url(base_url: str) -> str:
    """
    Check a source base URL and return it without its trailing slash.

    Only https, only an allowlisted host - the endpoint runs server-side, so an
    unchecked URL here would be a request forgery primitive handed to anyone
    holding an admin token.
    """
    parsed = urlparse(base_url or "")
    if parsed.scheme != "https":
        raise ImportSourceRejected(f"Source must be https, got: {base_url!r}")
    host = (parsed.hostname or "").lower()
    if host not in allowed_source_hosts():
        raise ImportSourceRejected(
            f"Source host {host!r} is not allowed. "
            f"Allowed: {', '.join(sorted(allowed_source_hosts()))}"
        )
    return base_url.rstrip("/")


def validate_filenames(filenames: Iterable[str]) -> list[str]:
    """Reject anything outside the whitelist, preserving the caller's order."""
    checked = []
    for name in filenames:
        if name not in ALLOWED_FILENAMES:
            raise ImportSourceRejected(
                f"Filename {name!r} is not importable. "
                f"Allowed: {', '.join(sorted(ALLOWED_FILENAMES))}"
            )
        checked.append(name)
    return checked


def _validate_id(value: str, label: str) -> str:
    """Ids go straight into a URL path and a storage key; keep them boring."""
    if not value or "/" in value or ".." in value or any(c.isspace() for c in value):
        raise ImportSourceRejected(f"Invalid {label}: {value!r}")
    return value


def fetch_source_file(
    base_url: str,
    source_user_id: str,
    source_creation_id: str,
    filename: str,
    session: Optional[requests.Session] = None,
) -> bytes:
    """
    Download one file from the source deployment's public file endpoint.

    Returns the bytes. Raises requests.HTTPError for a missing file, so the
    caller can decide whether that file was optional.
    """
    base = validate_source_base_url(base_url)
    _validate_id(source_user_id, "source_user_id")
    _validate_id(source_creation_id, "source_creation_id")
    validate_filenames([filename])

    url = f"{base}/api/files/{source_user_id}/{source_creation_id}/{filename}"
    http = session or requests
    response = http.get(url, timeout=FETCH_TIMEOUT_SECONDS)
    response.raise_for_status()
    data = response.content
    if len(data) > MAX_FILE_BYTES:
        raise ImportSourceRejected(
            f"{filename} is {len(data)} bytes, over the {MAX_FILE_BYTES} byte limit"
        )
    return data


def resolve_owner(
    db: Session,
    fallback: User,
    username: Optional[str] = None,
    name: Optional[str] = None,
) -> User:
    """
    Find or create the user a copied creation should belong to.

    Imported creations look far more like a real gallery when they are spread
    over a few accounts rather than all filed under whoever ran the import.
    Created accounts get no password hash, so they cannot be logged into.
    """
    if not username:
        return fallback

    user = db.query(User).filter(User.username == username).first()
    if user:
        if name and not user.name:
            user.name = name
            db.commit()
        return user

    user = User(
        username=username,
        email=f"{username}@imported.heromaker.local",
        name=name,
        password_hash=None,
        credits=0,
        is_admin=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    logger.warning("DATA IMPORT: created placeholder user %r (%s)", username, user.id)
    return user


def bootstrap_admin(db: Session) -> Optional[User]:
    """
    Promote one named account to admin at startup, so an environment that has
    opted into imports has something to authenticate the import endpoint with.

    Gated on the same ALLOW_DATA_IMPORT flag plus DATA_IMPORT_ADMIN_USERNAME,
    both of which are unset in production. Without this there is a chicken and
    egg problem: the only way to set is_admin is an endpoint that already
    requires an admin.

    Returns the promoted user, or None when nothing was done.
    """
    if not import_enabled():
        return None

    username = (os.getenv("DATA_IMPORT_ADMIN_USERNAME") or "").strip()
    if not username:
        return None

    user = db.query(User).filter(User.username == username).first()
    if not user:
        logger.warning(
            "DATA IMPORT: DATA_IMPORT_ADMIN_USERNAME=%r but no such user exists", username
        )
        return None

    if user.is_admin:
        return user

    user.is_admin = True
    db.commit()
    db.refresh(user)
    logger.warning(
        "=" * 60 + "\nDATA IMPORT: promoted user %r (%s) to admin because "
        "ALLOW_DATA_IMPORT=true and DATA_IMPORT_ADMIN_USERNAME is set.\n" + "=" * 60,
        username,
        user.id,
    )
    return user
