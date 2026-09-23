"""
m008_financial_spine: creating the financial tables and backfilling the ledger.

Run against a throwaway database built to look like the world BEFORE the ledger
existed - a `users` table with a bare `credits` integer and nothing else - which
is exactly what Railway holds today.

The point of the backfill is stated in the migration and asserted here: no
history is invented, but nothing is lost. Every pre-existing balance becomes one
`opening_balance` row, so `SUM(delta) == users.credits` holds from the first
moment the ledger exists.
"""
import json
import uuid

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app.migrations import m008_financial_spine


@pytest.fixture
def pre_ledger_db(tmp_path):
    """A database with the pre-ledger schema and some real-looking balances."""
    engine = create_engine(f"sqlite:///{tmp_path}/pre-ledger.db")
    Session = sessionmaker(bind=engine)
    db = Session()
    db.execute(text("""
        CREATE TABLE users (
            id TEXT PRIMARY KEY,
            email TEXT,
            username TEXT,
            credits INTEGER DEFAULT 0,
            is_admin BOOLEAN DEFAULT 0,
            created_at TIMESTAMP
        )
    """))
    db.execute(text("""
        CREATE TABLE creations (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            created_at TIMESTAMP
        )
    """))
    balances = {"rich": 137, "typical": 7, "empty": 0, "negative": -3, "null": None}
    ids = {}
    for name, credits in balances.items():
        uid = str(uuid.uuid4())
        ids[name] = uid
        db.execute(
            text("INSERT INTO users (id, email, username, credits) "
                 "VALUES (:id, :email, :username, :credits)"),
            {"id": uid, "email": f"{name}@x.test", "username": name, "credits": credits},
        )
    db.commit()
    yield db, ids, balances
    db.close()


def _ledger_rows(db, user_id):
    return db.execute(
        text("SELECT delta, reason, balance_after, external_ref, metadata "
             "FROM credit_transactions WHERE user_id = :uid"),
        {"uid": user_id},
    ).fetchall()


def test_migration_creates_the_three_tables(pre_ledger_db):
    db, _ids, _ = pre_ledger_db
    m008_financial_spine.migrate(db)

    tables = set(inspect(db.bind).get_table_names())
    assert {"credit_transactions", "usage_events", "payments"} <= tables


def test_backfill_turns_each_balance_into_one_opening_row(pre_ledger_db):
    db, ids, balances = pre_ledger_db
    m008_financial_spine.migrate(db)

    for name, credits in balances.items():
        rows = _ledger_rows(db, ids[name])
        if not credits:  # 0 and NULL
            # A delta=0 row is noise, and an empty ledger already agrees with a
            # zero balance.
            assert rows == [], f"{name} should have no ledger row"
            continue
        assert len(rows) == 1, f"{name} should have exactly one opening row"
        delta, reason, balance_after, external_ref, metadata = rows[0]
        assert delta == credits
        assert balance_after == credits
        assert reason == "opening_balance"
        assert external_ref is None
        assert json.loads(metadata)["source"].startswith("m008")


def test_backfill_makes_the_ledger_agree_with_every_cached_balance(pre_ledger_db):
    """The invariant the whole design rests on, checked straight after migration."""
    db, ids, _ = pre_ledger_db
    m008_financial_spine.migrate(db)

    drift = db.execute(text("""
        SELECT u.id, COALESCE(u.credits, 0), COALESCE(SUM(ct.delta), 0)
          FROM users u
          LEFT JOIN credit_transactions ct ON ct.user_id = u.id
         GROUP BY u.id
        HAVING COALESCE(u.credits, 0) <> COALESCE(SUM(ct.delta), 0)
    """)).fetchall()
    assert drift == [], f"cache and ledger disagree after backfill: {drift}"


def test_backfill_does_not_invent_a_reason_it_does_not_know(pre_ledger_db):
    """
    Labelling a pre-ledger balance "signup_grant" or "purchase" would be
    fabricating history. "opening_balance" says exactly what is known.
    """
    db, ids, _ = pre_ledger_db
    m008_financial_spine.migrate(db)

    reasons = {r[0] for r in db.execute(
        text("SELECT DISTINCT reason FROM credit_transactions")
    ).fetchall()}
    assert reasons == {"opening_balance"}


def test_running_the_migration_twice_changes_nothing(pre_ledger_db):
    """
    The runner only runs a migration once, but a migration that is not
    idempotent is a landmine for anyone who replays it by hand.
    """
    db, ids, _ = pre_ledger_db
    m008_financial_spine.migrate(db)
    before = db.execute(text("SELECT COUNT(*) FROM credit_transactions")).scalar()

    m008_financial_spine.migrate(db)
    after = db.execute(text("SELECT COUNT(*) FROM credit_transactions")).scalar()

    assert before == after == 3  # rich, typical, negative


def test_backfill_leaves_a_user_who_already_has_history_alone(pre_ledger_db):
    """
    Half-migrated state: a user who has already transacted must not get a second
    opening balance stapled on top, which would double their balance.
    """
    db, ids, _ = pre_ledger_db
    m008_financial_spine.migrate(db)

    # Pretend this user then bought credits the normal way.
    db.execute(
        text("INSERT INTO credit_transactions "
             "(id, user_id, delta, reason, balance_after, metadata, created_at) "
             "VALUES (:id, :uid, 10, 'purchase', 147, '{}', CURRENT_TIMESTAMP)"),
        {"id": str(uuid.uuid4()), "uid": ids["rich"]},
    )
    db.execute(text("UPDATE users SET credits = 147 WHERE id = :uid"),
               {"uid": ids["rich"]})
    db.commit()

    m008_financial_spine._backfill_opening_balances(db)
    db.commit()

    rows = _ledger_rows(db, ids["rich"])
    assert len(rows) == 2
    assert sum(r[0] for r in rows) == 147


def test_unique_index_on_external_ref_is_enforced_after_migration(pre_ledger_db):
    """
    The replay defence must exist at the DATABASE level, not just in Python -
    a second process, a script, or a future endpoint must hit it too.
    """
    from sqlalchemy.exc import IntegrityError

    db, ids, _ = pre_ledger_db
    m008_financial_spine.migrate(db)

    insert = text(
        "INSERT INTO credit_transactions "
        "(id, user_id, delta, reason, external_ref, balance_after, metadata, created_at) "
        "VALUES (:id, :uid, 5, 'purchase', 'dup-ref', 5, '{}', CURRENT_TIMESTAMP)"
    )
    db.execute(insert, {"id": str(uuid.uuid4()), "uid": ids["typical"]})
    db.commit()
    with pytest.raises(IntegrityError):
        db.execute(insert, {"id": str(uuid.uuid4()), "uid": ids["typical"]})
        db.commit()
    db.rollback()


def test_many_null_external_refs_are_allowed(pre_ledger_db):
    """NULLs are distinct in a unique index - spends must not collide."""
    db, ids, _ = pre_ledger_db
    m008_financial_spine.migrate(db)
    for _ in range(5):
        db.execute(
            text("INSERT INTO credit_transactions "
                 "(id, user_id, delta, reason, external_ref, balance_after, metadata, created_at) "
                 "VALUES (:id, :uid, -1, 'spend', NULL, 0, '{}', CURRENT_TIMESTAMP)"),
            {"id": str(uuid.uuid4()), "uid": ids["typical"]},
        )
    db.commit()
    assert db.execute(
        text("SELECT COUNT(*) FROM credit_transactions WHERE external_ref IS NULL")
    ).scalar() == 3 + 5


def test_payments_provider_ref_is_unique(pre_ledger_db):
    """Same replay defence on the revenue side, for the payments agent."""
    from sqlalchemy.exc import IntegrityError

    db, ids, _ = pre_ledger_db
    m008_financial_spine.migrate(db)

    insert = text(
        "INSERT INTO payments "
        "(id, user_id, provider, provider_ref, gross_usd_micros, fee_usd_micros, "
        " net_usd_micros, status, metadata, created_at) "
        "VALUES (:id, :uid, 'stripe', 'ch_dup', 1000000, 0, 1000000, 'succeeded', "
        "'{}', CURRENT_TIMESTAMP)"
    )
    db.execute(insert, {"id": str(uuid.uuid4()), "uid": ids["typical"]})
    db.commit()
    with pytest.raises(IntegrityError):
        db.execute(insert, {"id": str(uuid.uuid4()), "uid": ids["typical"]})
        db.commit()
    db.rollback()


def test_migration_is_registered_in_the_runner():
    """A migration that is not in the registry never runs in production."""
    from app.migrations.registry import MIGRATIONS
    names = [name for name, _fn in MIGRATIONS]
    assert "008_financial_spine" in names
    assert names[-1] == "008_financial_spine", "must be last in order"
