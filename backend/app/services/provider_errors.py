"""
A provider telling us WE are out of money is not a rate limit.

OpenAI answers an empty account with HTTP 429 and `code: insufficient_quota`
("You have no credits remaining"), which the SDK raises as `RateLimitError`.
Stored as "rate limit exceeded ... will be retried automatically", it read like
a blip that waiting would fix. Nothing fixes it but topping the account up, and
until then every hero fails at that step. Meshy says the same thing as HTTP 402
or `NoMorePendingTasks`.

So that case gets its own exception, its own stored message ("... unavailable:
out of credits"), and one ERROR log line with a fixed marker an alert can match:

    PROVIDER_OUT_OF_CREDITS openai
"""
import logging

logger = logging.getLogger(__name__)

ALERT_MARKER = "PROVIDER_OUT_OF_CREDITS"


class ProviderOutOfCredits(Exception):
    """Our account at a provider has no credits left. Service unavailable."""

    def __init__(self, provider: str, detail: str):
        self.provider = provider
        self.detail = detail
        super().__init__(
            f"{provider_label(provider)} service unavailable: our account is out of credits. "
            f"The step failed and its credits were refunded; it is not retried. "
            f"Not a rate limit; it will not clear until the account is topped up. "
            f"Provider said: {detail}"
        )


def provider_label(provider: str) -> str:
    return {"openai": "OpenAI", "meshy": "Meshy"}.get(provider, provider)


def alert_out_of_credits(provider: str, detail: str) -> None:
    """The ops alert. No alerting service exists in the backend yet, so this is
    an ERROR log with a fixed marker; point a log alert at the marker."""
    logger.error("%s %s: %s", ALERT_MARKER, provider, detail)


# ---------------------------------------------------------------------------
# Recognising it
# ---------------------------------------------------------------------------

_OPENAI_MARKERS = ("insufficient_quota", "no credits remaining", "exceeded your current quota")
_MESHY_MARKERS = ("nomorependingtasks", "insufficient credit", "insufficient balance", "payment required")


def is_openai_out_of_credits(exc: BaseException) -> bool:
    """True for OpenAI's 'your account is empty' 429, false for a real rate limit."""
    code = getattr(exc, "code", None)
    if code == "insufficient_quota":
        return True
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        err = body.get("error", body)
        if isinstance(err, dict) and err.get("code") == "insufficient_quota":
            return True
    text = str(exc).lower()
    return any(m in text for m in _OPENAI_MARKERS)


def is_meshy_out_of_credits(status_code, message: str) -> bool:
    if status_code == 402:
        return True
    text = (message or "").lower()
    return any(m in text for m in _MESHY_MARKERS)
