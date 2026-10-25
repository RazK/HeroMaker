"""API keys: how another app or an agent makes heroes on someone's account.

A key looks like ``hm_sk_<random>`` (secret) or ``hm_pk_<random>``
(publishable). Only its SHA-256 is stored; the key itself is shown once.

- A secret key is for servers and agents. Whoever holds it spends its owner's
  credits, so it must never be put in a web page.
- A publishable key may be put in a web page. It only works when the browser
  says the page is one of its ``allowed_origins``, and it can start at most
  ``daily_limit`` heroes a day. (An Origin header can be forged outside a
  browser: the daily cap is what bounds the damage of a copied key.)
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta
from typing import Optional, Tuple

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiHero, ApiKey, User

SECRET_PREFIX = "hm_sk_"
PUBLISHABLE_PREFIX = "hm_pk_"
KINDS = {"secret": SECRET_PREFIX, "publishable": PUBLISHABLE_PREFIX}
DEFAULT_PUBLISHABLE_DAILY_LIMIT = 20
MAX_KEYS_PER_USER = 20


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def create_key(
    db: Session,
    user: User,
    *,
    name: str,
    kind: str = "secret",
    allowed_origins: Optional[list] = None,
    daily_limit: Optional[int] = None,
) -> Tuple[ApiKey, str]:
    """A new key for `user`. Returns (row, the key itself: shown only now)."""
    if kind not in KINDS:
        raise HTTPException(status_code=400, detail="kind must be 'secret' or 'publishable'")
    origins = [normalise_origin(o) for o in (allowed_origins or [])]
    if kind == "publishable":
        if not origins:
            raise HTTPException(status_code=400, detail="A publishable key needs at least one allowed origin, e.g. https://yourgame.example")
        if daily_limit is None:
            daily_limit = DEFAULT_PUBLISHABLE_DAILY_LIMIT
    if daily_limit is not None and daily_limit < 1:
        raise HTTPException(status_code=400, detail="daily_limit must be at least 1")
    live = db.query(ApiKey).filter(ApiKey.user_id == user.id, ApiKey.revoked_at.is_(None)).count()
    if live >= MAX_KEYS_PER_USER:
        raise HTTPException(status_code=400, detail=f"You have {live} keys. Revoke one first.")
    key = KINDS[kind] + secrets.token_urlsafe(32)
    row = ApiKey(
        user_id=user.id,
        name=(name or "").strip()[:80] or "My key",
        kind=kind,
        prefix=key[:14],
        key_hash=hash_key(key),
        webhook_secret="whsec_" + secrets.token_urlsafe(32),
        allowed_origins=origins,
        daily_limit=daily_limit,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row, key


def normalise_origin(origin: str) -> str:
    """'https://Game.example/' -> 'https://game.example'. Refuses anything else."""
    from urllib.parse import urlsplit

    o = (origin or "").strip()
    parts = urlsplit(o)
    if parts.scheme not in ("https", "http") or not parts.hostname or parts.path not in ("", "/") or parts.query:
        raise HTTPException(status_code=400, detail=f"'{origin}' is not an origin. Use the form https://yourgame.example")
    if parts.scheme == "http" and parts.hostname not in ("localhost", "127.0.0.1"):
        raise HTTPException(status_code=400, detail=f"'{origin}': only https origins (http only for localhost)")
    port = f":{parts.port}" if parts.port else ""
    return f"{parts.scheme}://{parts.hostname.lower()}{port}"


def _bearer(authorization: Optional[str], x_api_key: Optional[str]) -> Optional[str]:
    if x_api_key:
        return x_api_key.strip()
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def authenticate(db: Session, key: Optional[str], origin: Optional[str]) -> ApiKey:
    """The live key for `key`, checked against the request's Origin."""
    if not key or not key.startswith((SECRET_PREFIX, PUBLISHABLE_PREFIX)):
        raise HTTPException(
            status_code=401,
            detail="Send your HeroMaker API key as 'Authorization: Bearer hm_sk_...' (make one on your account page).",
            headers={"WWW-Authenticate": "Bearer"},
        )
    row = db.query(ApiKey).filter(ApiKey.key_hash == hash_key(key)).first()
    if row is None or row.revoked_at is not None or not hmac.compare_digest(row.key_hash, hash_key(key)):
        raise HTTPException(status_code=401, detail="This API key is not valid (revoked, or mistyped).", headers={"WWW-Authenticate": "Bearer"})
    if row.user is None or getattr(row.user, "deleted_at", None):
        raise HTTPException(status_code=401, detail="This API key's account no longer exists.")
    if row.kind == "publishable":
        if not origin or origin.rstrip("/").lower() not in [o.lower() for o in (row.allowed_origins or [])]:
            raise HTTPException(status_code=403, detail="This publishable key does not work from this website. Add the site to the key's allowed origins.")
    row.last_used_at = datetime.utcnow()
    db.commit()
    return row


def require_api_key(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> ApiKey:
    """FastAPI dependency: the calling key (401/403 otherwise)."""
    return authenticate(db, _bearer(authorization, x_api_key), request.headers.get("origin"))


def started_today(db: Session, key: ApiKey, now: Optional[datetime] = None) -> int:
    """Heroes this key started in the last 24 hours."""
    since = (now or datetime.utcnow()) - timedelta(days=1)
    return db.query(ApiHero).filter(ApiHero.api_key_id == key.id, ApiHero.created_at >= since).count()


def check_daily_limit(db: Session, key: ApiKey) -> None:
    if key.daily_limit is None:
        return
    if started_today(db, key) >= key.daily_limit:
        raise HTTPException(
            status_code=429,
            detail=f"This key has started its {key.daily_limit} heroes for the last 24 hours. Try again later, or raise its daily limit.",
            headers={"Retry-After": "3600"},
        )


def sign(secret: str, timestamp: str, body: bytes) -> str:
    """The webhook signature: HMAC-SHA256 of '<timestamp>.<body>'."""
    mac = hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256)
    return "sha256=" + mac.hexdigest()


def public_view(row: ApiKey) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "kind": row.kind,
        "prefix": row.prefix,
        "allowed_origins": row.allowed_origins or [],
        "daily_limit": row.daily_limit,
        "created_at": row.created_at,
        "last_used_at": row.last_used_at,
        "revoked": row.revoked_at is not None,
    }
