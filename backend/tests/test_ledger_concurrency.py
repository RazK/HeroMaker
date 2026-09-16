"""
The ledger's ceiling, measured in isolation.

PLAYBOOK RULE: "measure the ceiling of anything you build, in isolation. Feed it
a known-perfect input through the real code path and assert what it returns."
Applied to a money invariant, that means: do not claim the ledger is atomic -
fire concurrent spends at one balance through the REAL code path and assert what
comes out.

This file contains three things:

1. `_naive_deduct_credits` - a faithful copy of the read-modify-write code that
    app/services/credits.py used before the ledger. It is the BUG, preserved as
    a harness rather than deleted, so the guard is measured against something.

2. A test that fires N concurrent spends through the naive version and asserts
    it OVERDRAWS - i.e. that the race is real on this machine and this database,
    and the passing test below is not passing for accidental reasons.

3. The same storm through `ledger.spend_credits`, asserting it cannot be
    overdrawn, that exactly `balance // cost` spends succeed, and that the
    ledger sums back to the cached balance afterwards.

Plus the replay storm: N concurrent deliveries of the SAME payment webhook,
asserting the user is credited exactly once.
"""
import threading
import time

import pytest

from app.database import SessionLocal
from app.models import CreditTransaction, User
from app.services import ledger


# ---------------------------------------------------------------------------
# The bug, kept as a harness
# ---------------------------------------------------------------------------

def _naive_deduct_credits(user_id: str, amount: int, db, settle_delay: float = 0.0):
    """
    The pre-ledger implementation, verbatim in shape:

        read balance -> compare -> subtract -> write

    Three statements, three chances for another transaction to interleave. The
    check is made against a value that is already stale by the time the write
    lands, so two spenders can both see "10 credits" and both succeed.

    `settle_delay` widens the window. It does not CREATE the bug - it makes an
    intermittent bug deterministic, which is the difference between a test and
    a coin flip.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise ValueError("no such user")
    if user.credits < amount:
        raise ValueError(f"Insufficient credits. Have {user.credits}, need {amount}")
    if settle_delay:
        time.sleep(settle_delay)
    user.credits -= amount
    db.commit()
    return user.credits


# ---------------------------------------------------------------------------
# Harness
# ---------------------------------------------------------------------------

def _storm(user_id: str, spend_fn, threads: int, amount: int):
    """
    Fire `threads` concurrent spends of `amount` at one balance.

    Each thread gets its OWN database session, because that is the only way to
    get genuinely concurrent transactions - threads sharing one SQLAlchemy
    session share one connection and serialise themselves, which would make the
    test prove nothing.

    Returns (successes, failures, errors).
    """
    barrier = threading.Barrier(threads)
    successes: list = []
    failures: list = []
    errors: list = []
    lock = threading.Lock()

    def worker():
        db = SessionLocal()
        try:
            barrier.wait(timeout=30)  # all threads leave the gate together
            spend_fn(user_id, amount, db)
            with lock:
                successes.append(1)
        except ValueError as exc:
            with lock:
                failures.append(str(exc))
        except Exception as exc:  # anything else is a real problem
            with lock:
                errors.append(f"{type(exc).__name__}: {exc}")
        finally:
            db.rollback()
            db.close()

    workers = [threading.Thread(target=worker) for _ in range(threads)]
    for t in workers:
        t.start()
    for t in workers:
        t.join(timeout=60)

    return len(successes), failures, errors


def _final_state(user_id: str):
    db = SessionLocal()
    try:
        cached = db.query(User).filter(User.id == user_id).first().credits
        ledger_sum = ledger.get_ledger_balance(user_id, db)
        rows = db.query(CreditTransaction).filter(
            CreditTransaction.user_id == user_id
        ).count()
        return cached, ledger_sum, rows
    finally:
        db.close()


# ---------------------------------------------------------------------------
# 1. The old code overdraws. Shown, not assumed.
# ---------------------------------------------------------------------------

def test_naive_read_modify_write_overdraws(make_user, capsys):
    """
    The control experiment. Ten threads each try to spend 5 credits from a
    balance of 10. At most TWO should succeed.

    The naive implementation lets far more than two through, because every
    thread checks a balance that is already stale. Delivering ten heroes for
    ten credits' worth of balance is the bug, and it is asserted here so that
    the guarded test below has something to be better than.
    """
    user = make_user(credits=10)
    threads, cost = 10, 5
    affordable = 10 // cost  # == 2

    successes, failures, errors = _storm(
        user.id,
        lambda uid, amt, db: _naive_deduct_credits(uid, amt, db, settle_delay=0.05),
        threads=threads,
        amount=cost,
    )
    cached, ledger_sum, rows = _final_state(user.id)

    print(
        f"\n  NAIVE read-modify-write: {threads} threads x {cost} credits "
        f"from a balance of 10"
        f"\n    spends that succeeded : {successes}   (only {affordable} were affordable)"
        f"\n    credits actually sold : {successes * cost}   (balance was 10)"
        f"\n    over-delivered        : {max(0, successes * cost - 10)} credits"
        f"\n    final cached balance  : {cached}"
        f"\n    ledger rows written   : {rows - 1}   (the old code wrote no history)"
    )

    assert not errors, f"unexpected errors: {errors}"
    assert successes > affordable, (
        "The naive implementation did NOT overdraw on this run, so this test is "
        "not measuring anything. Increase settle_delay or thread count - do not "
        "delete the test."
    )
    # The other half of the bug: the old code left no history whatsoever. The
    # only row present is the fixture's own opening balance, so ten spends of
    # real money are unexplainable after the fact.
    assert rows == 1


# ---------------------------------------------------------------------------
# 2. The ledger cannot be overdrawn.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("threads,balance,cost", [(10, 10, 5), (25, 21, 7), (16, 3, 1)])
def test_ledger_cannot_be_overdrawn(make_user, threads, balance, cost):
    """
    The same storm through app/services/ledger.py.

    Asserted, in order of how much they matter:
      * the balance never goes negative;
      * EXACTLY balance//cost spends succeed - not fewer (that would mean the
        guard is over-refusing and we are losing revenue), not more;
      * every failure is InsufficientCreditsError, not a lock timeout dressed up
        as one;
      * the ledger sums back to the cached balance, so the audit trail agrees
        with the number the product shows the user.
    """
    user = make_user(credits=balance)
    affordable = balance // cost

    successes, failures, errors = _storm(
        user.id,
        lambda uid, amt, db: ledger.spend_credits(uid, amt, db),
        threads=threads,
        amount=cost,
    )
    cached, ledger_sum, rows = _final_state(user.id)

    print(
        f"\n  LEDGER: {threads} threads x {cost} credits from a balance of {balance}"
        f"\n    succeeded : {successes} (exactly the {affordable} affordable)"
        f"\n    refused   : {len(failures)}"
        f"\n    balance   : {cached} (never below zero)"
        f"\n    ledger    : {ledger_sum} == cached, {rows} rows of history"
    )

    assert not errors, f"unexpected errors: {errors}"
    assert cached >= 0, f"OVERDRAWN: balance went to {cached}"
    assert successes == affordable, (
        f"expected exactly {affordable} spends to succeed, got {successes}"
    )
    assert successes * cost <= balance, "delivered more value than was paid for"
    assert cached == balance - successes * cost
    assert ledger_sum == cached, "ledger disagrees with the cached balance"
    # 1 opening balance + one row per successful spend. No row for a refusal:
    # a refused spend moved nothing.
    assert rows == 1 + successes
    assert all("Insufficient credits" in f for f in failures), failures


def test_ledger_spend_storm_leaves_no_negative_intermediate_balance(make_user):
    """
    Not just the final balance - EVERY ledger row's `balance_after` must be
    non-negative. A run that dips below zero and climbs back would end with a
    clean-looking total and a broken invariant in the middle.
    """
    user = make_user(credits=20)
    _storm(user.id, lambda uid, amt, db: ledger.spend_credits(uid, amt, db),
           threads=20, amount=3)

    db = SessionLocal()
    try:
        rows = db.query(CreditTransaction).filter(
            CreditTransaction.user_id == user.id
        ).order_by(CreditTransaction.created_at).all()
        balances = [r.balance_after for r in rows]
        assert all(b >= 0 for b in balances), f"balance dipped negative: {balances}"
        # The running balances must be exactly the cumulative sum of deltas -
        # no gaps, no double-applies.
        running = 0
        for row in rows:
            running += row.delta
            assert row.balance_after == running, (
                f"balance_after {row.balance_after} != running total {running}"
            )
    finally:
        db.close()


# ---------------------------------------------------------------------------
# 3. A replayed payment webhook credits exactly once.
# ---------------------------------------------------------------------------

def test_concurrent_webhook_replay_credits_exactly_once(make_user):
    """
    Twelve simultaneous deliveries of the SAME payment webhook.

    A payment provider WILL do this. Without the UNIQUE constraint on
    external_ref the user ends up with 12x the credits they paid for.

    Every caller must get the same answer (the same transaction id), because a
    webhook handler that sees an error on a duplicate will retry forever.
    """
    user = make_user(credits=0)
    order_id = "stripe_ch_3PabcDEF1234567"
    threads, credits_bought = 12, 50

    results: list = []
    errors: list = []
    lock = threading.Lock()
    barrier = threading.Barrier(threads)

    def worker():
        db = SessionLocal()
        try:
            barrier.wait(timeout=30)
            tx = ledger.record_purchase(
                user_id=user.id, amount=credits_bought, db=db,
                external_ref=order_id, metadata={"provider": "stripe"},
            )
            with lock:
                results.append(tx.id)
        except Exception as exc:
            with lock:
                errors.append(f"{type(exc).__name__}: {exc}")
        finally:
            db.rollback()
            db.close()

    workers = [threading.Thread(target=worker) for _ in range(threads)]
    for t in workers:
        t.start()
    for t in workers:
        t.join(timeout=60)

    cached, ledger_sum, rows = _final_state(user.id)

    print(
        f"\n  WEBHOOK REPLAY: {threads} simultaneous deliveries of order {order_id}"
        f"\n    callers that got an answer : {len(results)}/{threads}"
        f"\n    distinct transaction ids   : {len(set(results))} (must be 1)"
        f"\n    ledger rows                : {rows} (must be 1)"
        f"\n    balance                    : {cached} (must be {credits_bought})"
    )

    assert not errors, f"webhook handlers saw errors: {errors}"
    assert len(results) == threads, "some callers got no answer at all"
    assert len(set(results)) == 1, f"more than one transaction created: {set(results)}"
    assert rows == 1, f"expected exactly 1 ledger row, found {rows}"
    assert cached == credits_bought, f"balance is {cached}, expected {credits_bought}"
    assert ledger_sum == cached


def test_sequential_webhook_replay_is_a_noop(make_user, db):
    """The same thing the boring way: deliver it twice, one after the other."""
    user = make_user(credits=0)
    first = ledger.record_purchase(user.id, 30, db, external_ref="order-xyz")
    second = ledger.record_purchase(user.id, 30, db, external_ref="order-xyz")

    assert first.id == second.id
    assert ledger.get_balance(user.id, db) == 30
    assert ledger.get_ledger_balance(user.id, db) == 30
    assert db.query(CreditTransaction).filter(
        CreditTransaction.user_id == user.id
    ).count() == 1


# ---------------------------------------------------------------------------
# 4. Postgres: harness ready, skipped unless a server is given
# ---------------------------------------------------------------------------

@pytest.mark.skipif(
    not __import__("os").getenv("TEST_POSTGRES_URL"),
    reason="set TEST_POSTGRES_URL to run the same storm against Postgres "
           "(this is the only way the SELECT ... FOR UPDATE path gets exercised; "
           "on SQLite that lock is a documented no-op and the conditional UPDATE "
           "carries the guarantee)",
)
def test_ledger_cannot_be_overdrawn_on_postgres():
    """
    The identical invariant on Postgres, where `SELECT ... FOR UPDATE` is real.

    Run it with:
        TEST_POSTGRES_URL=postgresql://user:pass@host/db \\
          .venv/bin/python -m pytest backend/tests/test_ledger_concurrency.py -k postgres
    """
    import os
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.models import Base as ModelBase  # noqa: F401  (same declarative Base)
    from app.database import Base

    url = os.environ["TEST_POSTGRES_URL"]
    pg_engine = create_engine(url)
    Base.metadata.create_all(bind=pg_engine)
    PgSession = sessionmaker(bind=pg_engine)

    setup = PgSession()
    try:
        user = User(email="pg@example.test", username="pguser", credits=0)
        setup.add(user)
        setup.commit()
        setup.refresh(user)
        user_id = user.id
        ledger.post(db=setup, user_id=user_id, delta=10,
                    reason="opening_balance", metadata={"source": "pg test"})
    finally:
        setup.close()

    threads, cost = 10, 5
    successes = []
    failures = []
    barrier = threading.Barrier(threads)
    lock = threading.Lock()

    def worker():
        db = PgSession()
        try:
            barrier.wait(timeout=30)
            ledger.spend_credits(user_id, cost, db)
            with lock:
                successes.append(1)
        except ValueError as exc:
            with lock:
                failures.append(str(exc))
        finally:
            db.rollback()
            db.close()

    workers = [threading.Thread(target=worker) for _ in range(threads)]
    for t in workers:
        t.start()
    for t in workers:
        t.join(timeout=60)

    check = PgSession()
    try:
        cached = check.query(User).filter(User.id == user_id).first().credits
        assert cached == 0
        assert len(successes) == 2
        assert len(failures) == threads - 2
    finally:
        check.close()
