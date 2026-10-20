"""
What a failed step tells the person who made the hero, and what it tells us.

A step fails with whatever the provider said, and that text is for us: on
staging a painting failed and its owner read

    OpenAI API error: Error code: 400 - {'error': {'message': 'Your request was
    rejected by the safety system... request ID req_...', 'type':
    'image_generation_user_error', 'code': 'moderation_blocked', ...

So every failure is stored twice over, on the step:

- ``error_code``: one of CODES, the only thing the app decides on. Set by
  ``mark_failed`` at every place a step is failed (pipeline.execute_step, the
  task_manager timeout, the startup reconciliation, the run-step fallback,
  a cancel).
- ``error_message``: the raw text, unchanged. Admins only (``error_detail``).

and served (``response_fields``) as ``error_code`` plus ``error_user``, one
short line in the brand's parent voice, to everyone; the raw text and the
provider's request ID only to an admin. A step failed before this existed has
no code: it is classified from its raw text when read.

``credits_refunded`` (in the step's metadata) is set only when a refund was
actually written, so "Credits returned" is never said when it is not true: a
step that failed before it was charged, a cancel (which keeps its charge), or
a step a restart cut off.
"""
import re
from typing import Optional, Union

SAFETY_BLOCKED = "safety_blocked"
PROVIDER_BUSY = "provider_busy"
BAD_INPUT = "bad_input"
OUT_OF_CREDITS_PROVIDER = "out_of_credits_provider"  # OUR account at a provider, not the user's
NOT_ENOUGH_CREDITS = "not_enough_credits"  # the user's balance
CANCELLED = "cancelled"
UNKNOWN = "unknown"

CODES = (
    SAFETY_BLOCKED, PROVIDER_BUSY, BAD_INPUT, OUT_OF_CREDITS_PROVIDER,
    NOT_ENOUGH_CREDITS, CANCELLED, UNKNOWN,
)

# The raw text of a user cancel. Compared as-is by the pipeline and the cancel
# endpoint, so it is not reworded here.
CANCELLED_MESSAGE = "Step cancelled by user"

REFUND_KEY = "credits_refunded"


# ---------------------------------------------------------------------------
# Classifying
# ---------------------------------------------------------------------------

_SAFETY = (
    "moderation_blocked", "safety system", "content_policy", "content policy",
    "safety_violation", "moderation", "inappropriate", "nsfw", "prohibited content",
    "violates our", "usage policies",
)
_PROVIDER_EMPTY = (
    "our account is out of credits", "insufficient_quota", "no credits remaining",
    "exceeded your current quota", "nomorependingtasks", "payment required",
    "insufficient balance", "billing_hard_limit",
)
_BUSY = (
    "rate limit", "rate_limit", "too many requests", "overloaded", "timed out",
    "timeout", "server error", "server_error", "gateway error", "connection error",
    "connection refused", "connection reset", "temporarily unavailable",
    "service unavailable", "bad gateway", "try again later",
)
_BUSY_STATUS = re.compile(r"(error code:?\s*|status\s*|\()(429|5\d\d)\b", re.IGNORECASE)
_BAD_INPUT = (
    "cannot identify image", "unidentifiedimageerror", "invalid_image", "invalid image",
    "image_parse_error", "unsupported image", "unsupported mimetype", "image too small",
    "image is too small", "too small", "could not decode", "corrupt",
)


def _text(error: Union[BaseException, str, None]) -> str:
    if error is None:
        return ""
    if isinstance(error, BaseException):
        text = str(error)
        cause = error.__cause__ or error.__context__
        if cause is not None and str(cause) not in text:
            text = f"{text} {cause}"
        return text
    return str(error)


def classify(error: Union[BaseException, str, None]) -> str:
    """One of CODES for an exception or a stored raw message. Never raises."""
    try:
        from app.services.provider_errors import ProviderOutOfCredits
        if isinstance(error, ProviderOutOfCredits):
            return OUT_OF_CREDITS_PROVIDER
        if isinstance(error, (TimeoutError, ConnectionError)):
            return PROVIDER_BUSY
        text = _text(error)
        low = text.lower()
        if not low.strip():
            return UNKNOWN
        if text.strip() == CANCELLED_MESSAGE:
            return CANCELLED
        # Before any 429 or "insufficient credit": an empty provider account
        # also answers 429, and says "insufficient", but is ours to fix.
        if any(m in low for m in _PROVIDER_EMPTY):
            return OUT_OF_CREDITS_PROVIDER
        if low.startswith("insufficient credits. need"):
            return NOT_ENOUGH_CREDITS
        # Before bad input: a moderation block is also an HTTP 400.
        if any(m in low for m in _SAFETY):
            return SAFETY_BLOCKED
        if any(m in low for m in _BUSY) or _BUSY_STATUS.search(text):
            return PROVIDER_BUSY
        if any(m in low for m in _BAD_INPUT):
            return BAD_INPUT
        return UNKNOWN
    except Exception:
        return UNKNOWN


_REQUEST_ID = re.compile(r"\b(req_[A-Za-z0-9]{6,})\b|request[ _-]?id[\"':\s]+([A-Za-z0-9_-]{8,})", re.IGNORECASE)


def request_id(raw: Optional[str]) -> Optional[str]:
    """The provider's request ID in a raw error, for an admin to quote to support."""
    if not raw:
        return None
    m = _REQUEST_ID.search(raw)
    if not m:
        return None
    return (m.group(1) or m.group(2)).rstrip(".")


# ---------------------------------------------------------------------------
# What the person sees
# ---------------------------------------------------------------------------

# (what the step does, who does it), for the line under "<Step> failed".
_STEP_WORDS = {
    "image_processing": ("read", "workshop"),
    "openai_render": ("paint", "painter"),
    "meshy_3d": ("sculpt", "sculptor"),
    "meshy_rig": ("animate", "animator"),
    "convert_vrm": ("pack", "workshop"),
}

RETURNED = "Credits returned."


def user_message(code: str, step_name: str, refunded: bool = False) -> str:
    """One line of 12 words or fewer, parent voice, never blaming the user."""
    verb, worker = _STEP_WORDS.get(step_name, ("make", "workshop"))
    back = f" {RETURNED}" if refunded else ""
    if code == SAFETY_BLOCKED:
        return f"We couldn't {verb} this picture.{back} Try another drawing or photo."
    if code == PROVIDER_BUSY:
        if refunded:
            return f"Our {worker} is busy.{back} Try again in a minute."
        return f"Our {worker} is busy right now. Try again in a minute."
    if code == BAD_INPUT:
        return f"We couldn't read this picture.{back} Try a clearer one."
    if code == OUT_OF_CREDITS_PROVIDER:
        return f"We're having a hiccup on our side.{back} Try again later."
    if code == NOT_ENOUGH_CREDITS:
        return "You need more credits to finish this hero."
    if code == CANCELLED:
        return "Stopped before it finished. Try again any time."
    return f"Something went wrong.{back} Try again."


# ---------------------------------------------------------------------------
# Writing and reading it on a step
# ---------------------------------------------------------------------------

def mark_failed(step, error: Union[BaseException, str, None], code: Optional[str] = None) -> str:
    """Fail ``step``: the raw text in error_message, its code in error_code.
    Does not commit. Returns the code."""
    raw = _text(error) if isinstance(error, BaseException) else (error or "")
    code = code if code in CODES else classify(error)
    step.status = "failed"
    step.error_message = raw or None
    step.error_code = code
    return code


def clear(step) -> None:
    step.error_message = None
    step.error_code = None


def note_refund(step, refund_tx) -> None:
    """Record on the step that its charge really was given back."""
    if refund_tx is None:
        return
    from sqlalchemy.orm.attributes import flag_modified
    step.metadata_json = {**(step.metadata_json or {}), REFUND_KEY: abs(int(getattr(refund_tx, "delta", 0) or 0)) or True}
    flag_modified(step, "metadata_json")


def code_of(step) -> Optional[str]:
    if getattr(step, "status", None) != "failed":
        return None
    code = getattr(step, "error_code", None)
    return code if code in CODES else classify(step.error_message)


def response_fields(step, admin: bool, in_class: bool = False) -> dict:
    """The error fields of a step as the API serves them.

    Everyone: ``error_code``, ``error_user``, ``credits_refunded``, and
    ``error_message`` set to the safe line (older clients read it). An admin
    also gets ``error_detail`` (the raw text, also in ``error_message``) and
    ``error_request_id``. A class hero's line never mentions credits: the
    child did not pay any.
    """
    code = code_of(step)
    if code is None:
        return {"error_code": None, "error_user": None, "credits_refunded": False,
                "error_message": step.error_message if admin else None,
                "error_detail": step.error_message if admin else None,
                "error_request_id": None}
    refunded = bool((step.metadata_json or {}).get(REFUND_KEY))
    safe = user_message(code, step.step_name, refunded and not in_class)
    raw = step.error_message
    return {
        "error_code": code,
        "error_user": safe,
        "credits_refunded": refunded,
        "error_message": raw if admin else safe,
        "error_detail": raw if admin else None,
        "error_request_id": request_id(raw) if admin else None,
    }
