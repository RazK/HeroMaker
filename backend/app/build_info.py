"""Which commit this running container was built from.

A health check that only answers "healthy" cannot tell a fresh deploy from one
that silently never happened. That is not hypothetical: production served a
four-day-old build - missing auth, coupons, admin and payments entirely - while
every workflow run showed green, because `railway up --detach` reports success
for handing the source over, not for running it.

So the deploy writes the commit into `app/BUILD_SHA` just before `railway up`
uploads the directory, the image picks it up through the Dockerfile's
`COPY app/ ./app/`, and `/health` reports it back. A deploy is then verifiable
from outside by anyone with the URL: ask the service which commit it is, and
compare.

The file is deliberately not committed - it is a property of a build, not of
the source - so a local or developer run reports "unknown" rather than lying
about being some commit.
"""
import os
from pathlib import Path

UNKNOWN = "unknown"

_SHA_FILE = Path(__file__).with_name("BUILD_SHA")


def build_sha() -> str:
    """The full commit SHA this build came from, or "unknown".

    Read on every call rather than cached at import: the cost is one small
    file read on a health check, and caching would mean a container that
    somehow outlived its file kept reporting a commit it no longer is.
    """
    try:
        sha = _SHA_FILE.read_text(encoding="utf-8").strip()
        if sha:
            return sha
    except OSError:
        pass

    # Fallback for platforms that inject it as a variable instead.
    return os.getenv("BUILD_SHA", "").strip() or UNKNOWN


def build_sha_short() -> str:
    sha = build_sha()
    return sha if sha == UNKNOWN else sha[:7]
