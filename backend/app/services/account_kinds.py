"""
Which accounts are test accounts, in one place.

The staging robot (e2e/staging-robot.mjs) signs up a fresh account on every
run - `robot_<stamp>` / `robot+<stamp>@example.com` - and anyone testing by
hand tends to use an @example.com address. Those accounts are real rows, but
in the admin Users list they bury the people who actually use the product, so
the list hides them unless asked.

`example.com` is reserved for documentation (RFC 2606): no person can receive
mail there, so no real customer can have such an address.

This is the broad, *display* rule. Deleting accounts uses a much narrower one:
see backend/scripts/cleanup_test_accounts.py.
"""
from typing import Optional

from sqlalchemy import func, or_

from app.models import User

TEST_EMAIL_DOMAIN = "@example.com"
ROBOT_USERNAME_PREFIX = "robot_"


def is_test_account(username: Optional[str], email: Optional[str]) -> bool:
    return (username or "").startswith(ROBOT_USERNAME_PREFIX) or (email or "").lower().endswith(TEST_EMAIL_DOMAIN)


def sql_is_test_account():
    """SQL twin of is_test_account. `_` is a LIKE wildcard, hence the escape."""
    return or_(
        User.username.like(ROBOT_USERNAME_PREFIX.replace("_", "\\_") + "%", escape="\\"),
        func.lower(User.email).like("%" + TEST_EMAIL_DOMAIN),
    )
