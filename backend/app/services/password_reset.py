"""
"Forgot password?": single-use reset tokens and a simple rate limit.

A token is 32 random bytes (urlsafe base64 in the link). Only its sha256 is
stored, with a one-hour expiry. Using a token marks it used and also marks
every other outstanding token of that user used, so an older email in the
inbox stops working the moment the password changes.
"""
import hashlib
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from app.models import PasswordResetToken, User

TOKEN_BYTES = 32
TOKEN_TTL = timedelta(hours=1)

# Per-process, in-memory sliding windows. The backend runs as one uvicorn
# process, so this is the whole picture; a restart forgets the counts, which
# is acceptable for a brake on abuse rather than an accounting record.
RATE_WINDOW_SECONDS = 3600
MAX_PER_EMAIL = 3
MAX_PER_IP = 20


class _RateLimiter:
    def __init__(self):
        self._hits = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window: float = RATE_WINDOW_SECONDS) -> bool:
        """Count one attempt for `key`; False if it is over `limit` in `window`."""
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > window:
                hits.popleft()
            if len(hits) >= limit:
                return False
            hits.append(now)
            return True

    def reset(self):
        with self._lock:
            self._hits.clear()


rate_limiter = _RateLimiter()


def allow_request(email: str, ip: str) -> bool:
    """Both limits are counted on every request, so neither can be dodged by
    rotating the other."""
    ip_ok = rate_limiter.allow(f"ip:{ip}", MAX_PER_IP)
    email_ok = rate_limiter.allow(f"email:{email}", MAX_PER_EMAIL)
    return ip_ok and email_ok


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_token(db: Session, user: User) -> str:
    """Store a new token's hash for `user` and return the token itself."""
    token = secrets.token_urlsafe(TOKEN_BYTES)
    db.add(PasswordResetToken(
        user_id=user.id,
        token_hash=hash_token(token),
        expires_at=datetime.utcnow() + TOKEN_TTL,
    ))
    db.commit()
    return token


def find_valid(db: Session, token: str) -> Optional[Tuple[PasswordResetToken, User]]:
    """The token's row and user if it exists, is unused and unexpired."""
    if not token:
        return None
    row = db.query(PasswordResetToken).filter(
        PasswordResetToken.token_hash == hash_token(token)
    ).first()
    if row is None or row.used_at is not None or row.expires_at <= datetime.utcnow():
        return None
    user = db.query(User).filter(User.id == row.user_id).first()
    if user is None:
        return None
    return row, user


def consume(db: Session, row: PasswordResetToken) -> bool:
    """
    Mark `row` and every other outstanding token of its user used.

    The UPDATE is conditional on `used_at IS NULL`, so of two requests racing
    with the same token exactly one wins. Returns False for the loser. The
    caller commits.
    """
    now = datetime.utcnow()
    won = db.query(PasswordResetToken).filter(
        PasswordResetToken.id == row.id,
        PasswordResetToken.used_at.is_(None),
    ).update({PasswordResetToken.used_at: now}, synchronize_session=False)
    if won != 1:
        return False
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == row.user_id,
        PasswordResetToken.used_at.is_(None),
    ).update({PasswordResetToken.used_at: now}, synchronize_session=False)
    return True
