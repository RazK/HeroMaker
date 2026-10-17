#!/usr/bin/env python3
"""
Name the heroes made before automatic naming existed.

Finds every completed, not-deleted creation whose character_name is empty and
names it from its drawing, exactly as the pipeline now does for a new hero
(app/services/hero_naming.py::name_creation): same prompt, same model, same
sanitizing, one usage_event per OpenAI call, no credits charged, and a name a
user has set is never touched.

The target database comes from the environment, never from a default:

    # what would be named; no OpenAI calls, no writes
    .venv/bin/python backend/scripts/backfill_hero_names.py --env-file .env.staging --dry-run

    # do it
    .venv/bin/python backend/scripts/backfill_hero_names.py --env-file .env.staging

--env-file loads DATABASE_URL, OPENAI_API_KEY and the storage settings (S3_*)
from a dotenv file; --database-url overrides DATABASE_URL alone. Without either,
DATABASE_URL must already be set in the environment.

Production is written to only by a person who means it: this script never runs
in CI or the pipeline.
"""
import argparse
import os
import sys
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import urlsplit, urlunsplit

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _masked(url: str) -> str:
    """The database URL with its password hidden, for the log line."""
    try:
        parts = urlsplit(url)
        if parts.password:
            netloc = parts.netloc.replace(f":{parts.password}@", ":***@")
            return urlunsplit(parts._replace(netloc=netloc))
    except Exception:
        pass
    return url


def find_unnamed_completed(db, limit: Optional[int] = None) -> list:
    """Completed, live creations with no character_name, oldest first."""
    from sqlalchemy import func, or_
    from app.models import Creation

    candidates = (
        db.query(Creation)
        .filter(
            Creation.deleted_at.is_(None),
            or_(Creation.character_name.is_(None), func.trim(Creation.character_name) == ""),
        )
        .order_by(Creation.created_at.asc())
        .all()
    )
    # "completed" is computed from the steps, so it is filtered here, not in SQL.
    done = [c for c in candidates if c.status == "completed"]
    return done[:limit] if limit else done


def run(dry_run: bool = False, limit: Optional[int] = None,
        out: Callable[[str], None] = print) -> dict:
    """Name every candidate. Returns counts: candidates, named, skipped."""
    from app.database import SessionLocal
    from app.services import hero_naming

    db = SessionLocal()
    try:
        targets = [(c.id, c.user_id) for c in find_unnamed_completed(db, limit)]
    finally:
        db.close()

    out(f"{len(targets)} completed hero(es) without a name")
    named = 0
    for creation_id, user_id in targets:
        if dry_run:
            out(f"  would name {creation_id}")
            continue
        name = hero_naming.name_creation(creation_id, user_id)
        if name:
            named += 1
            out(f"  {creation_id} -> {name}")
        else:
            out(f"  {creation_id} -> (left unnamed; see the log)")

    result = {"candidates": len(targets), "named": named,
              "skipped": 0 if dry_run else len(targets) - named, "dry_run": dry_run}
    out(("DRY RUN - nothing written. " if dry_run else "") + f"named {named} of {len(targets)}")
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    parser.add_argument("--env-file", help="dotenv file to load first (DATABASE_URL, OPENAI_API_KEY, S3_*)")
    parser.add_argument("--database-url", help="overrides DATABASE_URL")
    parser.add_argument("--dry-run", action="store_true", help="list what would be named; no calls, no writes")
    parser.add_argument("--limit", type=int, default=None, help="name at most this many")
    args = parser.parse_args(argv)

    # All of this must happen BEFORE any app module is imported: the database
    # engine and storage backend are built from the environment at import time.
    if args.env_file:
        from dotenv import load_dotenv
        if not load_dotenv(args.env_file, override=True):
            print(f"error: could not read {args.env_file}", file=sys.stderr)
            return 2
    if args.database_url:
        os.environ["DATABASE_URL"] = args.database_url
    if not os.environ.get("DATABASE_URL"):
        print("error: no database. Pass --env-file or --database-url, or set DATABASE_URL.",
              file=sys.stderr)
        return 2
    if not args.dry_run and not os.environ.get("OPENAI_API_KEY"):
        print("error: OPENAI_API_KEY is not set; nothing could be named.", file=sys.stderr)
        return 2

    if str(BACKEND_DIR) not in sys.path:
        sys.path.insert(0, str(BACKEND_DIR))
    print(f"database: {_masked(os.environ['DATABASE_URL'])}")
    run(dry_run=args.dry_run, limit=args.limit)
    return 0


if __name__ == "__main__":
    sys.exit(main())
