"""
Sign in with Google, via Google Identity Services' ID-token flow.

The browser gets a signed ID token (a JWT) from Google and posts it to us. We
check Google's signature, that the token was minted for OUR client id, and
that it has not expired. Nothing else is trusted: the browser cannot tell us
who the user is, only hand us a token Google signed.

Only the public OAuth Web Client ID is needed. There is no client secret in
this flow, so there is nothing secret to leak.
"""
import os
import re
from typing import Optional

from google.auth import exceptions as google_exceptions
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from sqlalchemy.orm import Session

from app.models import User


class GoogleNotConfigured(Exception):
    """GOOGLE_CLIENT_ID is unset: this deployment does not offer Google sign-in."""


class GoogleUnavailable(Exception):
    """We could not reach Google to fetch its signing keys."""


class InvalidGoogleToken(Exception):
    """The token is forged, expired, for another app, or its email is unverified."""


class GoogleAccountConflict(Exception):
    """The email belongs to an account already linked to a DIFFERENT Google account."""


def client_id() -> Optional[str]:
    """The public OAuth Web Client ID, or None when Google sign-in is off.

    Read per call, not at import, so a deployment's env is what counts.
    """
    value = (os.getenv("GOOGLE_CLIENT_ID") or "").strip()
    return value or None


# One transport for the process: it reuses the HTTPS connection to Google's
# key endpoint instead of opening a new one per sign-in.
_transport = google_requests.Request()


def verify_credential(credential: str) -> dict:
    """Verify a GIS ID token and return its claims.

    Raises GoogleNotConfigured, GoogleUnavailable or InvalidGoogleToken.
    """
    audience = client_id()
    if not audience:
        raise GoogleNotConfigured()
    try:
        claims = id_token.verify_oauth2_token(
            credential, _transport, audience, clock_skew_in_seconds=10
        )
    except google_exceptions.TransportError as exc:
        raise GoogleUnavailable() from exc
    except (ValueError, google_exceptions.GoogleAuthError) as exc:
        raise InvalidGoogleToken(str(exc)) from exc

    # An unverified address is a claim, not a fact. Linking on it would let
    # anyone who registers a Google account with someone else's email walk
    # into that person's HeroMaker account.
    if claims.get("email_verified") is not True or not claims.get("email") or not claims.get("sub"):
        raise InvalidGoogleToken("email not verified")
    return claims


def _unique_username(email: str, db: Session) -> str:
    """A free username derived from the email's local part: ada, ada2, ada3..."""
    local = email.split("@", 1)[0].lower()
    base = re.sub(r"[^a-z0-9_]", "", local.replace(".", "_").replace("-", "_"))[:24] or "hero"
    candidate, n = base, 1
    while db.query(User.id).filter(User.username == candidate).first():
        n += 1
        candidate = f"{base}{n}"
    return candidate


def find_or_create_user(claims: dict, db: Session) -> User:
    """The account this Google identity signs into, creating it if needed.

    1. the account already linked to this Google id;
    2. else the account with the same (Google-verified) email, which gets linked;
    3. else a new account with no password and no credits, as signup gives.
    """
    google_id = claims["sub"]
    email = claims["email"].strip().lower()

    user = db.query(User).filter(User.google_id == google_id).first()
    if user:
        return user

    user = db.query(User).filter(User.email == email).first()
    if user:
        if user.google_id and user.google_id != google_id:
            raise GoogleAccountConflict()
        user.google_id = google_id
        if not user.name and claims.get("name"):
            user.name = claims["name"]
        db.commit()
        db.refresh(user)
        return user

    user = User(
        username=_unique_username(email, db),
        email=email,
        google_id=google_id,
        name=(claims.get("name") or claims.get("given_name") or "").strip() or None,
        password_hash=None,
        credits=0,  # as signup: new users start with 0 credits
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
