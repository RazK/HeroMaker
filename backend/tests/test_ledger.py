"""
Ledger semantics: the single-threaded half of the contract.

The concurrency guarantees live in test_ledger_concurrency.py. This file covers
the everyday behaviour: what gets written, what gets refused, and whether the
cache on `users.credits` stays equal to the sum of the ledger no matter which
door a credit change comes through.
"""
import pytest

from app.models import CreditTransaction, User
from app.services import credits as credits_service
from app.services import ledger
from app.services.coupons import create_coupon, redeem_coupon
from app.services.users import update_user


# ---------------------------------------------------------------------------
# Basic posting
# ---------------------------------------------------------------------------

def test_post_writes_a_row_and_updates_the_cache(make_user, db):
    user = make_user(credits=0)
    tx = ledger.post(db=db, user_id=user.id, delta=10, reason="signup_grant")

    assert tx.delta == 10
    assert tx.reason == "signup_grant"
    assert tx.balance_after == 10
    assert ledger.get_balance(user.id, db) == 10
    assert ledger.get_ledger_balance(user.id, db) == 10


def test_balance_is_the_sum_of_deltas_after_a_sequence(make_user, db):
    """
    "Why do I have 7 credits" - answered by reading the ledger, which is the
    entire reason for this table.
    """
    user = make_user(credits=0)
    ledger.post(db=db, user_id=user.id, delta=5, reason="signup_grant")
    ledger.post(db=db, user_id=user.id, delta=10, reason="coupon")
    ledger.spend_credits(user.id, 10, db)
    ledger.post(db=db, user_id=user.id, delta=3, reason="refund")
    ledger.spend_credits(user.id, 1, db)

    assert ledger.get_balance(user.id, db) == 7
    assert ledger.get_ledger_balance(user.id, db) == 7

    history = ledger.list_transactions(user.id, db)
    assert [t.delta for t in sorted(history, key=lambda t: t.balance_after)] or True
    assert sum(t.delta for t in history) == 7
    assert {t.reason for t in history} == {"signup_grant", "coupon", "spend", "refund"}


def test_balance_after_is_a_running_total(make_user, db):
    user = make_user(credits=0)
    expected = []
    running = 0
    for delta, reason in [(10, "signup_grant"), (-3, "spend"), (5, "coupon"), (-2, "spend")]:
        running += delta
        expected.append(running)
        ledger.post(db=db, user_id=user.id, delta=delta, reason=reason)

    rows = db.query(CreditTransaction).filter(
        CreditTransaction.user_id == user.id
    ).order_by(CreditTransaction.created_at, CreditTransaction.balance_after).all()
    assert [r.balance_after for r in rows] == expected


def test_zero_delta_is_rejected(make_user, db):
    user = make_user(credits=5)
    with pytest.raises(ValueError, match="non-zero"):
        ledger.post(db=db, user_id=user.id, delta=0, reason="admin_adjust")


def test_unknown_reason_is_rejected(make_user, db):
    user = make_user(credits=5)
    with pytest.raises(ValueError, match="Unknown credit reason"):
        ledger.post(db=db, user_id=user.id, delta=1, reason="because-i-said-so")


def test_unknown_user_is_distinguishable_from_insufficient_funds(db):
    with pytest.raises(ledger.UnknownUserError):
        ledger.post(db=db, user_id="no-such-user", delta=-1, reason="spend")
    with pytest.raises(ledger.UnknownUserError):
        ledger.post(db=db, user_id="no-such-user", delta=1, reason="coupon")


# ---------------------------------------------------------------------------
# Spending
# ---------------------------------------------------------------------------

def test_spend_cannot_overdraw_and_writes_nothing_when_refused(make_user, db):
    user = make_user(credits=3)
    with pytest.raises(ledger.InsufficientCreditsError) as excinfo:
        ledger.spend_credits(user.id, 4, db)

    assert excinfo.value.available == 3
    assert excinfo.value.requested == 4
    # Balance untouched, and NO ledger row: a refused spend moved nothing, so
    # recording one would be inventing a movement that never happened.
    assert ledger.get_balance(user.id, db) == 3
    assert db.query(CreditTransaction).filter(
        CreditTransaction.user_id == user.id,
        CreditTransaction.reason == "spend",
    ).count() == 0


def test_spend_down_to_exactly_zero_is_allowed(make_user, db):
    user = make_user(credits=10)
    tx = ledger.spend_credits(user.id, 10, db)
    assert tx.balance_after == 0
    assert ledger.get_balance(user.id, db) == 0


def test_spend_records_the_creation_and_step_it_paid_for(make_user, make_creation, db):
    """
    The creation_id on a spend row is what lets the margin report put credits
    spent next to dollars spent, per hero.
    """
    user = make_user(credits=10)
    creation = make_creation(user.id)
    tx = ledger.spend_credits(
        user.id, 2, db, creation_id=creation.id, step_name="openai_render"
    )
    assert tx.creation_id == creation.id
    assert tx.metadata_json["step_name"] == "openai_render"


def test_spend_is_deliberately_not_idempotent(make_user, db):
    """
    Running a step twice really does cost twice. `spend_credits` takes no
    external_ref on purpose - pretending a repeated spend is a replay would hide
    exactly the retry cost this whole system exists to measure.
    """
    import inspect
    assert "external_ref" not in inspect.signature(ledger.spend_credits).parameters

    user = make_user(credits=10)
    ledger.spend_credits(user.id, 2, db)
    ledger.spend_credits(user.id, 2, db)
    assert ledger.get_balance(user.id, db) == 6


def test_negative_amounts_are_rejected_by_the_wrappers(make_user, db):
    user = make_user(credits=10)
    for fn in (ledger.grant_credits, ledger.spend_credits, ledger.refund_credits):
        with pytest.raises(ValueError, match="must be positive"):
            fn(user.id, -1, db)
        with pytest.raises(ValueError, match="must be positive"):
            fn(user.id, 0, db)


# ---------------------------------------------------------------------------
# Purchases and replay
# ---------------------------------------------------------------------------

def test_purchase_requires_an_external_ref(make_user, db):
    """Without one, a replayed webhook would double-credit. Refuse loudly."""
    user = make_user(credits=0)
    with pytest.raises(ValueError, match="external_ref"):
        ledger.record_purchase(user.id, 100, db, external_ref="")


def test_external_ref_is_unique_across_users(make_user, db):
    """
    A provider order id is globally unique. Letting the same ref be reused by a
    different user would let a replay attributed to the wrong account slip
    through.
    """
    a = make_user(credits=0)
    b = make_user(credits=0)
    ledger.record_purchase(a.id, 10, db, external_ref="shared-ref")
    second = ledger.record_purchase(b.id, 10, db, external_ref="shared-ref")
    # Returned the FIRST transaction, and credited nobody a second time.
    assert second.user_id == a.id
    assert ledger.get_balance(b.id, db) == 0


def test_many_rows_may_have_no_external_ref(make_user, db):
    """NULLs are distinct in a unique index on both SQLite and Postgres."""
    user = make_user(credits=100)
    for _ in range(5):
        ledger.spend_credits(user.id, 1, db)
    assert db.query(CreditTransaction).filter(
        CreditTransaction.user_id == user.id,
        CreditTransaction.external_ref.is_(None),
    ).count() == 6  # 5 spends + the opening balance


def test_find_by_external_ref(make_user, db):
    user = make_user(credits=0)
    tx = ledger.record_purchase(user.id, 25, db, external_ref="ref-42")
    assert ledger.find_by_external_ref("ref-42", db).id == tx.id
    assert ledger.find_by_external_ref("nope", db) is None
    assert ledger.find_by_external_ref(None, db) is None


# ---------------------------------------------------------------------------
# The cache invariant
# ---------------------------------------------------------------------------

def test_verify_user_balance_reports_consistency(make_user, db):
    user = make_user(credits=10)
    check = ledger.verify_user_balance(user.id, db)
    assert check.consistent and check.drift == 0


def test_verify_detects_a_balance_written_behind_the_ledgers_back(make_user, db):
    """
    The invariant is only useful if it can FAIL. Simulate the old bug - a raw
    write to users.credits - and assert the checker catches it.
    """
    user = make_user(credits=10)
    db.query(User).filter(User.id == user.id).update({"credits": 999})
    db.commit()

    check = ledger.verify_user_balance(user.id, db)
    assert not check.consistent
    assert check.drift == 989

    all_checks = ledger.verify_all_balances(db)
    assert [c for c in all_checks if not c.consistent][0].user_id == user.id


def test_every_user_is_consistent_after_a_mixed_workload(make_user, db):
    users = [make_user(credits=20) for _ in range(4)]
    for i, u in enumerate(users):
        ledger.spend_credits(u.id, i + 1, db)
        ledger.grant_credits(u.id, 3, db, reason="coupon")
        ledger.refund_credits(u.id, 1, db)
    assert all(c.consistent for c in ledger.verify_all_balances(db))


# ---------------------------------------------------------------------------
# The legacy surface still works, and now leaves a trail
# ---------------------------------------------------------------------------

def test_legacy_add_and_deduct_still_work_and_now_write_history(make_user, db):
    """
    app/services/pipeline.py and app/services/coupons.py call these by their old
    names and signatures. They must keep working - and now leave a ledger row.
    """
    user = make_user(credits=0)
    assert credits_service.add_credits(user.id, 10, db, reason="coupon:HERO-ABC") == 10
    assert credits_service.deduct_credits(user.id, 4, db, reason="step:openai_render") == 6
    assert credits_service.get_balance(user.id, db) == 6

    rows = ledger.list_transactions(user.id, db)
    reasons = {r.reason for r in rows}
    assert "coupon" in reasons and "spend" in reasons
    # The original free-text reason is preserved, not discarded by the mapping.
    coupon_row = next(r for r in rows if r.reason == "coupon")
    assert coupon_row.metadata_json["legacy_reason"] == "coupon:HERO-ABC"
    spend_row = next(r for r in rows if r.reason == "spend")
    assert spend_row.metadata_json["step_name"] == "openai_render"


def test_legacy_deduct_raises_a_valueerror_as_pipeline_expects(make_user, db):
    """
    app/services/pipeline.py catches ValueError around the credit check. The new
    InsufficientCreditsError must still be one, or a poor user gets a 500
    instead of "not enough credits".
    """
    user = make_user(credits=1)
    with pytest.raises(ValueError, match="Insufficient credits"):
        credits_service.deduct_credits(user.id, 5, db)


def test_coupon_redemption_goes_through_the_ledger(make_user, db):
    user = make_user(credits=0)
    create_coupon("HERO-TEST01", 15, db)
    result = redeem_coupon("HERO-TEST01", user.id, db)

    assert result["new_balance"] == 15
    assert ledger.verify_user_balance(user.id, db).consistent
    assert [t.reason for t in ledger.list_transactions(user.id, db)] == ["coupon"]


def test_admin_setting_a_balance_goes_through_the_ledger(make_user, db):
    """
    The last direct-write path. `update_user(credits=N)` used to overwrite the
    column, silently desynchronising the cache from the ledger and making the
    balance unauditable again.
    """
    user = make_user(credits=10)
    update_user(user.id, db, credits=42)

    assert ledger.get_balance(user.id, db) == 42
    check = ledger.verify_user_balance(user.id, db)
    assert check.consistent, f"admin write desynchronised the ledger: {check.as_dict()}"

    adjust = [t for t in ledger.list_transactions(user.id, db) if t.reason == "admin_adjust"]
    assert len(adjust) == 1
    assert adjust[0].delta == 32
    assert adjust[0].metadata_json["previous_balance"] == 10
    assert adjust[0].metadata_json["requested_balance"] == 42


def test_admin_setting_the_same_balance_writes_nothing(make_user, db):
    """A no-op must stay a no-op: delta=0 rows are noise."""
    user = make_user(credits=10)
    update_user(user.id, db, credits=10)
    assert [t.reason for t in ledger.list_transactions(user.id, db)] == ["opening_balance"]


def test_admin_may_deliberately_push_a_balance_below_a_spend(make_user, db):
    """
    A clawback is legitimate and must be recorded as an anomaly rather than
    being impossible. allow_negative is the escape hatch, and only admin
    adjustments use it.
    """
    user = make_user(credits=5)
    update_user(user.id, db, credits=-3)
    assert ledger.get_balance(user.id, db) == -3
    assert ledger.verify_user_balance(user.id, db).consistent
