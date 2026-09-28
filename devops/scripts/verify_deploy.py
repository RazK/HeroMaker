#!/usr/bin/env python3
"""Wait until a deployed service reports the commit it was supposed to get.

Why this exists
---------------
`railway up --detach` returns as soon as the source has been handed over. It
says nothing about whether Railway built it, whether the build succeeded, or
whether the container ever started. Every deploy in this repository reported
success that way, and production still served a four-day-old image missing
auth, coupons, admin and payments. Nothing was red. Nothing could have been:
no step ever asked the running service what it was.

This asks. The deploy stamps the commit into `backend/app/BUILD_SHA` before
uploading, `/health` reports it back, and this polls until the answer matches
- or fails the job. A deploy is then either verified or red; there is no third
state that looks like success.

Usage
-----
    verify_deploy.py https://host --expect-sha <sha> [--timeout 900]
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request

# A redeploy takes the container down briefly, so connection errors and 5xx are
# expected for a while and are not failures until the deadline passes.
POLL_SECONDS = 10
REQUEST_TIMEOUT = 15


# Why the outcome is three-valued and not two: "cannot reach it" and "reached
# it and it is the wrong build" have entirely different fixes, and collapsing
# them sends whoever reads the failure to the wrong place.
UNREACHABLE = "unreachable"   # nothing answered, or the answer made no sense
STALE = "stale"               # answered, but it is not the commit we deployed
MATCH = "match"


def probe(url, expected):
    """Return (outcome, sha, note)."""
    try:
        with urllib.request.urlopen(url, timeout=REQUEST_TIMEOUT) as response:
            body = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return UNREACHABLE, None, f"HTTP {exc.code}"
    except Exception as exc:  # noqa: BLE001 - any transport failure is "not up yet"
        return UNREACHABLE, None, type(exc).__name__

    try:
        payload = json.loads(body)
    except ValueError:
        return UNREACHABLE, None, "response was not JSON"

    version = payload.get("version")
    if not version:
        # The service answered, so it is up - it is just an image built before
        # build_info.py existed. That is itself proof the deploy did not land,
        # so it is STALE, not UNREACHABLE.
        return STALE, None, "running a build from before deploy verification existed"

    if version == expected:
        return MATCH, version, ""
    return STALE, version, f"still serving {version[:7]}"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base_url", help="Service base URL, e.g. https://heromaker-backend.up.railway.app")
    parser.add_argument("--expect-sha", required=True, help="Commit the deploy was made from")
    parser.add_argument("--timeout", type=int, default=900, help="Seconds to wait (default 900)")
    parser.add_argument("--label", default="service", help="Name used in messages")
    args = parser.parse_args(argv)

    expected = args.expect_sha.strip()
    health_url = args.base_url.rstrip("/") + "/health"
    deadline = time.monotonic() + args.timeout

    print(f"Waiting for {args.label} at {health_url}")
    print(f"  expecting commit {expected[:7]} ({expected})")

    outcome, last_note = UNREACHABLE, "not polled yet"
    while True:
        outcome, _seen, note = probe(health_url, expected)
        if outcome == MATCH:
            print(f"\n{args.label} is running {expected[:7]}. Deploy verified.")
            return 0

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break

        last_note = note
        print(f"  [{int(remaining)}s left] {last_note}", flush=True)
        time.sleep(min(POLL_SECONDS, max(1, remaining)))

    print(f"\n::error title={args.label} deploy not verified::", end="")
    if outcome == STALE:
        print(
            f"{args.label} answered for {args.timeout}s but is {last_note}, not "
            f"{expected[:7]}. Railway accepted the upload and kept the old "
            f"container running, which means the new build never became live - "
            f"open that service's Deployments tab and read the failed build."
        )
    else:
        print(
            f"{args.label} could not be read for {args.timeout}s ({last_note}). "
            f"Either the service is down or {health_url} is not its URL."
        )
    return 1


if __name__ == "__main__":
    sys.exit(main())
