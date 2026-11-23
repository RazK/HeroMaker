"""
Startup guards: fix, on every boot, a hole that once shipped in the public repo.

backend/scripts/migrate_debug_user.py (deleted 2026-11-23, still in git history)
created an ADMIN account, username "debug", email debug@heromaker.local, with
its password written in the file. The repository is public, so anyone could
read it. Whether that account exists on staging or production cannot be
checked safely from outside, so the backend disarms it itself, every time it
starts: harmless where the account is absent, decisive where it is present.

It cannot touch a real user: ".local" is not an address anyone can sign up
with, and only an account that is ALSO an admin is changed.
"""
import logging
import secrets

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import User
from app.services.auth import hash_password

logger = logging.getLogger(__name__)

LEAKED_EMAIL = "debug@heromaker.local"
LEAKED_USERNAME = "debug"


def disarm_leaked_debug_admin(db: Session) -> int:
    """Take admin away from the leaked debug account and make its password
    unusable. Returns how many accounts it changed; 0 on every later boot."""
    leaked = db.query(User).filter(
        or_(User.email == LEAKED_EMAIL, User.username == LEAKED_USERNAME),
        User.is_admin.is_(True),
    ).all()
    for user in leaked:
        user.is_admin = False
        # A fresh random password nobody knows: the published one stops working.
        user.password_hash = hash_password(secrets.token_urlsafe(32))
        logger.warning(
            "SECURITY: disarmed the leaked debug admin account %s (admin removed, password replaced)",
            user.id,
        )
    if leaked:
        db.commit()
    return len(leaked)
