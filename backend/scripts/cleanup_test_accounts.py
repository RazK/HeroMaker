#!/usr/bin/env python3
"""
Delete the staging robot's leftover accounts. Dry run unless --apply.

Before e2e/staging-robot.mjs deleted its own account at the end of each run,
every run left one behind: robot_<stamp> / robot+<stamp>@example.com, about
20 credits and a deleted hero. This removes those, and only those.

    .venv/bin/python backend/scripts/cleanup_test_accounts.py --env-file .env.staging
    .venv/bin/python backend/scripts/cleanup_test_accounts.py --database-url "$URL" --apply

What it matches, exactly - nothing broader:
    username  robot_<lowercase letters and digits>
    email     robot+<lowercase letters and digits>@example.com
A live account matching either is a candidate. Every candidate must match the
robot shape on *both* fields that it has (an account whose email is not a
robot address is a person who happens to call themselves robot_..., and the
run refuses outright rather than skip it silently). Admins are refused too.

Each account goes through app.services.account_deletion.delete_account, the
same code a person's own "Delete account" runs: heroes and files removed,
purchases and the ledger kept and consistent, the balance forfeited through
the ledger.

Staging runs it through .github/workflows/cleanup-test-accounts-staging.yml.
It never runs against production.
"""
import argparse
import os
import re
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent

ROBOT_USERNAME = re.compile(r"robot_[a-z0-9]+")
ROBOT_EMAIL = re.compile(r"robot\+[a-z0-9]+@example\.com")


def is_robot_username(username) -> bool:
    return bool(username) and ROBOT_USERNAME.fullmatch(username) is not None


def is_robot_email(email) -> bool:
    return bool(email) and ROBOT_EMAIL.fullmatch(email) is not None


class Refused(Exception):
    """The matched set holds an account that is not unmistakably the robot's."""


def find_robot_accounts(db, keep=()):
    """Live accounts that are the robot's. Raises Refused if any account that
    looks like the robot on one field is not the robot on the other."""
    from sqlalchemy import or_
    from app.models import User

    # A coarse SQL net (LIKE treats `_` as a wildcard, so this over-matches on
    # purpose); the exact regexes below decide.
    rows = (
        db.query(User)
        .filter(User.deleted_at.is_(None))
        .filter(or_(User.username.like("robot%"), User.email.like("robot+%@example.com")))
        .order_by(User.created_at)
        .all()
    )
    keep = set(keep)
    matched, suspicious = [], []
    for user in rows:
        by_name, by_email = is_robot_username(user.username), is_robot_email(user.email)
        if not (by_name or by_email):
            continue  # e.g. "robotics_fan": never ours, never touched
        if user.username in keep:
            continue
        # Both fields must be the robot's. The robot always sets both.
        if not (by_name and by_email) or user.is_admin:
            suspicious.append(user)
        else:
            matched.append(user)
    if suspicious:
        listed = ", ".join(f"{u.username} <{u.email}>{' (admin)' if u.is_admin else ''}" for u in suspicious)
        raise Refused(f"refusing: these match only part of the robot pattern, or are admins: {listed}")
    return matched


def cleanup(db, apply: bool = False, keep=(), task_manager=None, out=print) -> int:
    """Delete (or with apply=False, list) the robot's accounts. Returns how many."""
    from app.services import account_deletion

    accounts = find_robot_accounts(db, keep=keep)
    verb = "deleting" if apply else "would delete"
    for user in accounts:
        out(f"{verb} {user.username} <{user.email}> credits={user.credits} created={user.created_at:%Y-%m-%d}")
    if apply:
        for user in accounts:
            account_deletion.delete_account(db, user, task_manager)
    out(f"{'deleted' if apply else 'dry run: would delete'} {len(accounts)} robot account(s)"
        + ("" if apply else ". Pass --apply to delete them."))
    return len(accounts)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    parser.add_argument("--apply", action="store_true", help="really delete (default: dry run)")
    parser.add_argument("--keep", action="append", default=[], metavar="USERNAME",
                        help="a robot account to leave alone (repeatable), e.g. one reused with LOGIN_AS")
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
        cleanup(db, apply=args.apply, keep=args.keep)
    except Refused as e:
        print(f"error: {e}. Nothing was deleted.", file=sys.stderr)
        return 1
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
