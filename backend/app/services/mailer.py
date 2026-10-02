"""
Outgoing email, through the Resend HTTPS API.

    RESEND_API_KEY   Bearer key. Unset = email is off (nothing is sent).
    MAIL_FROM        "Name <address>" on a domain verified in Resend.

Both are read on every call, so tests and a redeploy with new variables need
nothing else.

With RESEND_API_KEY unset nothing is sent. Outside production the reset link
is logged at INFO instead, so a developer (or a staging robot reading logs) can
still finish the flow. In production it is NEVER logged: a reset link is a
password, and logs are read by more people than the account owner.
"""
import html
import logging
import os

import requests

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"
DEFAULT_FROM = "HeroMaker <onboarding@resend.dev>"
TIMEOUT_SECONDS = 10


def is_configured() -> bool:
    return bool(os.getenv("RESEND_API_KEY", "").strip())


def _is_production() -> bool:
    # Same test as app/services/result_cache.py: Railway names the environment.
    env = os.getenv("RAILWAY_ENVIRONMENT_NAME") or os.getenv("RAILWAY_ENVIRONMENT") or ""
    return env.strip().lower() == "production"


def send_email(to: str, subject: str, text: str, html_body: str) -> bool:
    """Send one email. Returns True if Resend accepted it. Never raises."""
    api_key = os.getenv("RESEND_API_KEY", "").strip()
    if not api_key:
        return False
    try:
        response = requests.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "from": os.getenv("MAIL_FROM", "").strip() or DEFAULT_FROM,
                "to": [to],
                "subject": subject,
                "text": text,
                "html": html_body,
            },
            timeout=TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        logger.error("Resend request failed: %s", exc)
        return False
    if response.status_code >= 300:
        logger.error("Resend refused the email: HTTP %s %s", response.status_code, response.text[:300])
        return False
    return True


def send_password_reset(to: str, link: str) -> bool:
    """Email a password-reset link."""
    if not is_configured():
        if _is_production():
            logger.warning("Password reset requested but RESEND_API_KEY is unset; no email sent.")
        else:
            # Not production: log the link so the flow can be finished without
            # email. Never do this in production - the link is a password.
            logger.info("RESEND_API_KEY unset; password reset link for %s: %s", to, link)
        return False

    text = (
        "Hi!\n\n"
        "Someone (hopefully you) asked to reset your HeroMaker password.\n"
        f"Pick a new one here:\n\n{link}\n\n"
        "The link works once, for one hour. If you didn't ask, ignore this email.\n"
    )
    safe = html.escape(link, quote=True)
    html_body = (
        '<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#222">'
        "<p>Hi!</p>"
        "<p>Someone (hopefully you) asked to reset your HeroMaker password.</p>"
        f'<p><a href="{safe}" style="display:inline-block;padding:12px 20px;border-radius:12px;'
        'background:#6b4ce6;color:#fff;font-weight:700;text-decoration:none">Pick a new password</a></p>'
        "<p style=\"color:#666;font-size:14px\">The link works once, for one hour. "
        "If you didn't ask, ignore this email.</p>"
        "</div>"
    )
    return send_email(to, "Reset your HeroMaker password", text, html_body)
