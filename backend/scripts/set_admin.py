#!/usr/bin/env python3
"""
Make an account an admin (or take it back), by email.

The account must already exist: the person signs in once (Google or
password), then this flips is_admin on that row. A deleted account is never
touched. The target database comes from the environment, never from a
default:

    .venv/bin/python backend/scripts/set_admin.py --env-file .env.staging raz@example.com
    .venv/bin/python backend/scripts/set_admin.py --database-url "$URL" raz@example.com --revoke

Staging runs it through .github/workflows/set-admin-staging.yml. Production is
written to only by a person who means it: this script never runs in the
pipeline.
"""
import argparse
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent


def set_admin(db, email: str, admin: bool = True) -> str:
    """Set is_admin on the live account with this email. Returns what happened."""
    from sqlalchemy import func
    from app.models import User

    user = (
        db.query(User)
        .filter(func.lower(User.email) == email.strip().lower(), User.deleted_at.is_(None))
        .one_or_none()
    )
    if user is None:
        return "not-found"
    if bool(user.is_admin) == admin:
        return "unchanged"
    user.is_admin = admin
    db.commit()
    return "granted" if admin else "revoked"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    parser.add_argument("email")
    parser.add_argument("--revoke", action="store_true", help="take admin away instead")
    parser.add_argument("--env-file", help="dotenv file to load first (DATABASE_URL)")
    parser.add_argument("--database-url", help="overrides DATABASE_URL")
    args = parser.parse_args(argv)

    # Before any app import: the engine is built from the environment.
    if args.env_file:
        from dotenv import load_dotenv
        if not load_dotenv(args.env_file, override=True):
            print(f"error: could not read {args.env_file}", file=sys.stderr)
            return 2
    if args.database_url:
        os.environ["DATABASE_URL"] = args.database_url
    if not os.environ.get("DATABASE_URL"):
        print("error: no database. Pass --env-file or --database-url, or set DATABASE_URL.", file=sys.stderr)
        return 2

    sys.path.insert(0, str(BACKEND_DIR))
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        result = set_admin(db, args.email, admin=not args.revoke)
    finally:
        db.close()
    messages = {
        "granted": f"{args.email} is now an admin.",
        "revoked": f"{args.email} is no longer an admin.",
        "unchanged": f"{args.email} was already {'not ' if args.revoke else ''}an admin; nothing changed.",
        "not-found": f"No live account with email {args.email}. Sign in once first, then run this again.",
    }
    print(messages[result])
    return 1 if result == "not-found" else 0


if __name__ == "__main__":
    sys.exit(main())
