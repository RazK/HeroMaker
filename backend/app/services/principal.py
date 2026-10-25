"""Who is calling the API, and what they may do: one answer for every client.

HeroMaker has one API (/api/v1). The app is a client of it like any other;
what differs between clients is only their access:

    heroes   make, follow, list and delete the account's heroes; estimates;
             read the account's credits. What an API key gets.
    app      everything a signed-in person can do in the app (implies heroes).
             What the app's login (a session token) gets.
    admin    the admin console. A session of an admin account.

A request carries either a session token (the app) or an API key, in
`Authorization: Bearer ...` (or `X-Api-Key`). Both resolve to a Principal.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Set

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey, User
from app.services import api_keys

HEROES = "heroes"
APP = "app"
ADMIN = "admin"


@dataclass
class Principal:
    user: User
    scopes: Set[str] = field(default_factory=set)
    # Set when the caller is an API key (its daily limit, its webhooks).
    api_key: Optional[ApiKey] = None

    @property
    def user_id(self) -> str:
        return self.user.id

    def can(self, scope: str) -> bool:
        return scope in self.scopes


def _session_principal(db: Session, token: str) -> Optional[Principal]:
    from app.services.auth import verify_access_token

    user_id = verify_access_token(token)
    if not user_id:
        return None
    user = db.query(User).filter(User.id == user_id).first()
    if user is None or getattr(user, "deleted_at", None):
        return None
    scopes = {HEROES, APP} | ({ADMIN} if user.is_admin else set())
    return Principal(user=user, scopes=scopes)


def resolve(db: Session, credential: Optional[str], origin: Optional[str]) -> Principal:
    """The caller behind a bearer credential: an API key or an app session."""
    if credential and credential.startswith((api_keys.SECRET_PREFIX, api_keys.PUBLISHABLE_PREFIX)):
        key = api_keys.authenticate(db, credential, origin)
        return Principal(user=key.user, scopes={HEROES}, api_key=key)
    if credential:
        found = _session_principal(db, credential)
        if found:
            return found
    raise HTTPException(
        status_code=401,
        detail="Sign in, or send a HeroMaker API key as 'Authorization: Bearer hm_sk_...' (make one on your account page).",
        headers={"WWW-Authenticate": "Bearer"},
    )


def require(scope: str):
    """FastAPI dependency: the caller, if they have `scope` (401/403 otherwise)."""

    def dependency(
        request: Request,
        authorization: Optional[str] = Header(None),
        x_api_key: Optional[str] = Header(None),
        db: Session = Depends(get_db),
    ) -> Principal:
        who = resolve(db, api_keys._bearer(authorization, x_api_key), request.headers.get("origin"))
        if not who.can(scope):
            raise HTTPException(status_code=403, detail="This key can't do that. It is limited to making and reading heroes.")
        return who

    dependency.__name__ = f"require_{scope}"
    return dependency
