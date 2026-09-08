#!/usr/bin/env python
"""
Fill a non-production environment with real creations copied from production.

Why not scripts/clone_env_data.py
---------------------------------
That script is the general tool, but its database half needs raw TCP to
Railway's Postgres proxy on a non-443 port, which a sandboxed agent or any
HTTPS-only network cannot open. This one never touches a database directly: it
reads production's *public* API and drives the destination backend's admin
import endpoint, so everything it does is ordinary HTTPS on 443.

    POST {target}/api/admin/import/creation

The destination pulls the files itself. See backend/app/services/data_import.py
for how that endpoint is gated (admin token **and** ALLOW_DATA_IMPORT=true).

Usage
-----
    .venv/bin/python scripts/seed_staging_from_production.py \
        --target https://backend-staging-384f.up.railway.app \
        --username demo --password '...'

    ... --dry-run     print the plan, change nothing
    ... --replace     overwrite creations already imported (re-runnable)
    ... --only 3      just the Nth entry of the plan, for fixing one up

Safety
------
The target may never be production: the check is on the resolved host, and it
also asks the target whether imports are enabled before writing anything.
Production is only ever read.
"""
import argparse
import json
import sys
from datetime import datetime, timedelta
from urllib.parse import urlparse

import requests

PRODUCTION = "https://heromaker.up.railway.app"
PRODUCTION_HOSTS = {"heromaker.up.railway.app", "heromaker-backend.up.railway.app"}

ALL_FILES = [
    "original.jpg", "processed.jpg", "rendered.png",
    "model.glb", "rigged.glb", "walking.glb", "avatar.vrm",
]
# A creation stopped mid-render has nothing downstream of processed.jpg yet;
# one whose rigging failed has everything up to the raw model.
RENDERING_FILES = ["original.jpg", "processed.jpg"]
RIG_FAILED_FILES = ["original.jpg", "processed.jpg", "rendered.png", "model.glb"]

STEP_ORDER = ["image_processing", "openai_render", "meshy_3d", "meshy_rig", "convert_vrm"]

# Roughly what each step takes in production, used to make the copied
# timestamps line up with something believable rather than all being identical.
STEP_SECONDS = {
    "image_processing": 1, "openai_render": 54, "meshy_3d": 309,
    "meshy_rig": 43, "convert_vrm": 3,
}

RIG_FAILURE_MESSAGE = (
    "Meshy rigging failed: the model could not be fitted to a humanoid "
    "skeleton (task 0195f3ac-6a1f-7c2e-9d41-2f6b9d0f4c11, status FAILED). "
    "Retry the Rigging & Animation step, or re-run 3D Modeling first."
)

# The plan. Source ids are production creations picked for variety - a cactus,
# a Lego minifig, a block character, several kids, a few creatures - and the
# names are invented here because production's character_name/name/age are
# almost all NULL, which makes for a very dull gallery.
#
#   state: "completed" | "rendering" (stopped mid AI render) | "rig_failed"
#   days:  how long ago the creation was made, so the gallery has an order
PLAN = [
    # id                                       character           creator  user     age  state        days
    ("7dec21b0-6d62-4b12-b221-bea47a249b91", "Prickle Pete",      "Itai",  "itai",   8,  "completed",  1),
    ("9551e315-bd00-4d1e-ae1d-3e5c73162395", "Brick Bo",          "Noa",   "noa",    9,  "completed",  2),
    ("2765a545-9a8d-48f0-91f9-f9a81f373331", "Blue Bolt",         "Maya",  "maya",   6,  "completed",  3),
    ("b466d13b-fdd6-4729-9bdd-8270eafdfd0f", "Ruby Rocket",       "Maya",  "maya",   6,  "completed",  4),
    ("b540ca42-66e2-4985-b142-2c09b7d1cb78", "Willow the Wanderer", "Tamar", "tamar", 11, "completed",  5),
    ("641c9d22-83cf-422b-bda4-863c601bcc2e", "Dusty Dan",         "Itai",  "itai",   8,  "completed",  6),
    ("bc3e903e-86e9-4149-b6bb-3a8779258115", "Professor Zap",     "Noa",   "noa",    9,  "completed",  7),
    ("ec902957-a530-432e-a5d4-02254c55bde3", "Fern the Fairy",    "Maya",  "maya",   6,  "completed",  8),
    ("d1792cf1-fac1-4d6e-9118-eeb9086ad674", "Princess Lumi",     "Tamar", "tamar", 11,  "completed",  9),
    ("6d2a3b85-474d-4ce1-b049-5ba9ee68373a", "Bonesy Bloom",      "Itai",  "itai",   8,  "completed", 10),
    ("2d3811c4-fdab-4c3b-80c3-9c288953988e", "Clover",            "Noa",   "noa",    9,  "completed", 11),
    ("8c6b7c02-42bd-42e7-a7b7-3368099adb68", "Nightthorn",        "Tamar", "tamar", 11,  "completed", 12),
    ("26eef3df-315f-40f8-a6bd-b87716d34976", "Violet Volt",       "Maya",  "maya",   6,  "completed", 13),
    ("bd2d392a-b6b2-4959-9526-283436c10c74", "Wizard Arden",      "Raz",   "demo",  38,  "completed", 14),
    ("1e1b163d-d7bf-4dfa-963f-a7442c45aa3f", "Sir Shellton",      "Itai",  "itai",   8,  "completed", 15),
    ("237b837e-ffb9-4d93-87bf-80c6158d35d2", "Super Sami",        "Noa",   "noa",    9,  "completed", 16),
    ("2ae38f58-a0f2-405d-9888-45ee7d9029dd", "Sunny Petal",       "Maya",  "maya",   6,  "completed", 17),
    ("731db45a-5119-465a-bab1-84cbc9e76ea3", "Nimbus",            "Tamar", "tamar", 11,  "completed", 18),
    # Two unfinished ones, so the Studio's other phases have something to show.
    ("baf41070-00a8-4e34-863b-3c1d2f47f016", "Barky",             "Itai",  "itai",   8,  "rendering",  0),
    ("7ef1dd78-78dd-418f-bc2a-06aed8f2580f", "Azure Wing",        "Raz",   "demo",  38,  "rig_failed", 0),
]


def iso(dt: datetime) -> str:
    return dt.isoformat()


def build_steps(state: str, finished_at: datetime) -> tuple[list[dict], datetime]:
    """
    Build the step rows for one creation, working backwards from when it ended.

    Returns the steps and the creation's created_at.
    """
    if state == "completed":
        done_through = len(STEP_ORDER)
    elif state == "rendering":
        done_through = 1          # image_processing done, openai_render running
    elif state == "rig_failed":
        done_through = 3          # through meshy_3d, then meshy_rig failed
    else:
        raise ValueError(f"unknown state {state!r}")

    active = STEP_ORDER[:done_through + (0 if state == "completed" else 1)]
    total = sum(STEP_SECONDS[name] for name in active)
    start = finished_at - timedelta(seconds=total)

    steps, cursor = [], start
    for i, name in enumerate(STEP_ORDER):
        duration = STEP_SECONDS[name]
        if i < done_through:
            steps.append({
                "step_name": name, "status": "completed",
                "started_at": iso(cursor),
                "completed_at": iso(cursor + timedelta(seconds=duration)),
                "estimated_completion_time": iso(cursor + timedelta(seconds=duration)),
            })
            cursor += timedelta(seconds=duration)
        elif i == done_through and state == "rendering":
            # Left running: started a moment ago, still short of its estimate,
            # so the Studio shows a live progress bar rather than a stuck one.
            started = datetime.utcnow() - timedelta(seconds=12)
            steps.append({
                "step_name": name, "status": "processing",
                "started_at": iso(started),
                "estimated_completion_time": iso(started + timedelta(seconds=duration)),
            })
        elif i == done_through and state == "rig_failed":
            steps.append({
                "step_name": name, "status": "failed",
                "started_at": iso(cursor),
                "estimated_completion_time": iso(cursor + timedelta(seconds=duration)),
                "error_message": RIG_FAILURE_MESSAGE,
            })
            cursor += timedelta(seconds=duration)
        else:
            steps.append({"step_name": name, "status": "pending"})

    return steps, start


def check_target(target: str) -> str:
    """Refuse to write to production, whatever was typed on the command line."""
    parsed = urlparse(target)
    if parsed.scheme != "https":
        sys.exit(f"Target must be https, got {target!r}")
    if (parsed.hostname or "").lower() in PRODUCTION_HOSTS:
        sys.exit("Refusing to import into production. This script seeds staging only.")
    return target.rstrip("/")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", required=True, help="Destination backend base URL (never production)")
    ap.add_argument("--source", default=PRODUCTION, help="Source deployment to copy from")
    ap.add_argument("--username", required=True, help="Admin username on the target")
    ap.add_argument("--password", required=True, help="Admin password on the target")
    ap.add_argument("--replace", action="store_true", help="Overwrite creations already imported")
    ap.add_argument("--only", type=int, action="append", help="Only this index of the plan (repeatable)")
    ap.add_argument("--dry-run", action="store_true", help="Print the plan, change nothing")
    args = ap.parse_args()

    target = check_target(args.target)
    http = requests.Session()

    print(f"Source: {args.source}")
    print(f"Target: {target}")

    source_creations = {c["id"]: c for c in http.get(f"{args.source}/api/creations/", timeout=60).json()}
    print(f"Production has {len(source_creations)} creations")

    plan = list(enumerate(PLAN))
    if args.only:
        wanted = set(args.only)
        plan = [(i, row) for i, row in plan if i in wanted]

    if args.dry_run:
        for i, (cid, char, creator, owner, age, state, days) in plan:
            known = "ok" if cid in source_creations else "MISSING FROM SOURCE"
            print(f"  [{i:2d}] {state:10s} {char:22s} by {creator:6s} ({owner}, {age})  {cid}  {known}")
        return 0

    token = http.post(
        f"{target}/api/auth/login",
        json={"username": args.username, "password": args.password}, timeout=60,
    ).json()["access_token"]
    http.headers["Authorization"] = f"Bearer {token}"

    status = http.get(f"{target}/api/admin/import/status", timeout=60)
    if status.status_code != 200 or not status.json().get("enabled"):
        sys.exit(
            f"Target is not accepting imports ({status.status_code}: {status.text}). "
            "Set ALLOW_DATA_IMPORT=true on it, and make sure this account is an admin."
        )

    ok = failed = 0
    for i, (cid, char, creator, owner, age, state, days) in plan:
        source = source_creations.get(cid)
        if not source:
            print(f"  [{i:2d}] SKIP {char}: {cid} is not in the source gallery any more")
            failed += 1
            continue

        finished_at = datetime.utcnow() - timedelta(days=days, hours=(i % 7) * 2 + 3)
        steps, created_at = build_steps(state, finished_at)
        files = {"completed": ALL_FILES, "rendering": RENDERING_FILES,
                 "rig_failed": RIG_FAILED_FILES}[state]

        payload = {
            "source_base_url": args.source,
            "source_user_id": source["user_id"],
            "source_creation_id": cid,
            "files": files,
            "character_name": char,
            "name": creator,
            "age": age,
            "owner_username": owner,
            "owner_name": creator,
            "created_at": iso(created_at),
            "updated_at": iso(finished_at),
            "steps": steps,
            "replace": args.replace,
        }

        response = http.post(f"{target}/api/admin/import/creation", json=payload, timeout=900)
        if response.status_code != 201:
            print(f"  [{i:2d}] FAIL {char}: {response.status_code} {response.text[:200]}")
            failed += 1
            continue

        body = response.json()
        copied = [f for f in body["files"] if not f.get("error")]
        missing = [f["filename"] for f in body["files"] if f.get("error")]
        megabytes = sum(f["bytes"] for f in copied) / 1e6
        note = f"  (missing: {', '.join(missing)})" if missing else ""
        print(
            f"  [{i:2d}] {body['status']:10s} {char:22s} "
            f"{len(copied)}/{len(body['files'])} files, {megabytes:.1f} MB{note}"
        )
        ok += 1

    print(f"\nImported {ok} creations, {failed} failed.")
    print(f"See them: {target}/api/creations/")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
