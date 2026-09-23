"""
The margin report's arithmetic, on data constructed so the right answer is known
in advance.

The load-bearing assertion in this file is
`test_cost_per_successful_hero_includes_that_heros_own_retries`. That number is
the one that decides whether the business works, and it is the one that is easy
to get quietly wrong by dividing list price by headcount.
"""
from datetime import datetime, timedelta

import pytest

from app.config import pricing
from app.models import Payment, UsageEvent
from app.services import ledger, reporting

OPENAI_COST = 167_000
MESHY_COST = 400_000
HAPPY_PATH = OPENAI_COST + MESHY_COST  # 567_000


def _usage(db, user_id, creation_id, step, provider, operation,
           status="succeeded", when=None, cost=None):
    units, priced = pricing.price_call(provider, operation)
    event = UsageEvent(
        user_id=user_id,
        creation_id=creation_id,
        step_name=step,
        provider=provider,
        operation=operation,
        units=units,
        cost_usd_micros=priced if cost is None else cost,
        status=status,
        created_at=when or datetime.utcnow(),
        metadata_json={},
    )
    db.add(event)
    db.commit()
    return event


def _happy_hero(db, user_id, creation_id, when=None):
    """The four calls one hero needs when nothing goes wrong."""
    _usage(db, user_id, creation_id, "openai_render", "openai", "images.edit", when=when)
    _usage(db, user_id, creation_id, "meshy_3d", "meshy", "image-to-3d", when=when)
    _usage(db, user_id, creation_id, "meshy_rig", "meshy", "rigging", when=when)
    _usage(db, user_id, creation_id, "convert_vrm", "internal", "convert_vrm", when=when)


def _payment(db, user_id, gross, fee, ref, status="succeeded", when=None):
    payment = Payment(
        user_id=user_id, provider="stripe", provider_ref=ref,
        gross_usd_micros=gross, fee_usd_micros=fee, net_usd_micros=gross - fee,
        status=status, created_at=when or datetime.utcnow(), metadata_json={},
    )
    db.add(payment)
    db.commit()
    return payment


# ---------------------------------------------------------------------------
# Totals
# ---------------------------------------------------------------------------

def test_empty_range_reports_zeroes_not_errors(db):
    r = reporting.build_margin_report(db)
    assert r.cost_usd_micros == 0
    assert r.revenue_net_usd_micros == 0
    assert r.gross_margin_usd_micros == 0
    assert r.cost_per_successful_hero_usd_micros is None
    assert r.gross_margin_pct is None
    assert any("payments" in w for w in r.warnings)


def test_one_clean_hero_costs_the_happy_path_price(db, make_user, make_creation, completed_steps):
    user = make_user(credits=10)
    creation = make_creation(user.id, completed_steps)
    _happy_hero(db, user.id, creation.id)

    r = reporting.build_margin_report(db)
    assert r.cost_usd_micros == HAPPY_PATH
    assert r.heroes_completed == 1
    assert r.cost_per_successful_hero_usd_micros == HAPPY_PATH
    assert r.cost_by_provider == {"openai": OPENAI_COST, "meshy": MESHY_COST, "internal": 0}


def test_cost_per_successful_hero_includes_that_heros_own_retries(
    db, make_user, make_creation, completed_steps
):
    """
    THE NUMBER THAT MATTERS.

    Hero A goes through cleanly.
    Hero B needs its render twice (one moderation failure, then a success that
    was superseded, then the final one) and its 3D twice.

    A costs $0.567. B costs $0.567 + one extra render + one extra 3D = $1.134,
    plus a failed render that was not billed but IS counted as a call.

    Average over two delivered heroes = $0.8505. If the report said $0.567 it
    would be quoting a brochure, not a cost.
    """
    user = make_user(credits=100)
    hero_a = make_creation(user.id, completed_steps)
    hero_b = make_creation(user.id, completed_steps)

    _happy_hero(db, user.id, hero_a.id)

    _usage(db, user.id, hero_b.id, "openai_render", "openai", "images.edit",
           status="failed", cost=0)            # moderation block: not billed
    _usage(db, user.id, hero_b.id, "openai_render", "openai", "images.edit")  # billed
    _usage(db, user.id, hero_b.id, "openai_render", "openai", "images.edit")  # retry, billed
    _usage(db, user.id, hero_b.id, "meshy_3d", "meshy", "image-to-3d")
    _usage(db, user.id, hero_b.id, "meshy_3d", "meshy", "image-to-3d")        # retry, billed
    _usage(db, user.id, hero_b.id, "meshy_rig", "meshy", "rigging")
    _usage(db, user.id, hero_b.id, "convert_vrm", "internal", "convert_vrm")

    r = reporting.build_margin_report(db)

    cost_b = 2 * OPENAI_COST + 2 * MESHY_COST   # 1_134_000
    assert r.heroes_completed == 2
    assert r.cost_usd_micros == HAPPY_PATH + cost_b
    assert r.cost_per_successful_hero_usd_micros == (HAPPY_PATH + cost_b) // 2 == 850_500
    assert r.cost_per_successful_hero_usd_micros > HAPPY_PATH, (
        "the report is quoting the happy-path price and ignoring retries"
    )

    by_creation = {c.creation_id: c for c in r.creations}
    assert by_creation[hero_a.id].cost_usd_micros == HAPPY_PATH
    assert by_creation[hero_a.id].retried_calls == 0
    assert by_creation[hero_b.id].cost_usd_micros == cost_b
    assert by_creation[hero_b.id].failed_calls == 1
    # openai_render ran 3x (2 retries), meshy_3d ran 2x (1 retry) = 3.
    assert by_creation[hero_b.id].retried_calls == 3
    assert r.failed_call_count == 1


def test_money_burnt_on_heroes_that_never_finished_is_reported_separately(
    db, make_user, make_creation, completed_steps
):
    """
    A hero that dies at the rigging step still cost a full Meshy 3D. That money
    is not part of "cost per successful hero" - it is part of the fully loaded
    cost, and both numbers are needed.
    """
    user = make_user(credits=100)
    good = make_creation(user.id, completed_steps)
    dead = make_creation(user.id, {
        "image_processing": "completed", "openai_render": "completed",
        "meshy_3d": "completed", "meshy_rig": "failed",
    })

    _happy_hero(db, user.id, good.id)
    _usage(db, user.id, dead.id, "openai_render", "openai", "images.edit")
    _usage(db, user.id, dead.id, "meshy_3d", "meshy", "image-to-3d")
    _usage(db, user.id, dead.id, "meshy_rig", "meshy", "rigging", status="failed", cost=0)

    r = reporting.build_margin_report(db)

    assert r.heroes_completed == 1
    assert r.heroes_failed == 1
    assert r.cost_of_completed_heroes_usd_micros == HAPPY_PATH
    assert r.cost_of_incomplete_heroes_usd_micros == HAPPY_PATH
    assert r.cost_per_successful_hero_usd_micros == HAPPY_PATH
    # Everything spent, over the one hero actually delivered.
    assert r.fully_loaded_cost_per_successful_hero_usd_micros == 2 * HAPPY_PATH
    assert r.fully_loaded_cost_per_successful_hero_usd_micros > \
        r.cost_per_successful_hero_usd_micros


# ---------------------------------------------------------------------------
# Revenue and margin
# ---------------------------------------------------------------------------

def test_margin_is_net_revenue_minus_cost(db, make_user, make_creation, completed_steps):
    user = make_user(credits=10)
    creation = make_creation(user.id, completed_steps)
    _happy_hero(db, user.id, creation.id)
    _payment(db, user.id, gross=5_000_000, fee=175_000, ref="ch_1")  # $5.00 less $0.175

    r = reporting.build_margin_report(db)
    assert r.revenue_gross_usd_micros == 5_000_000
    assert r.revenue_fee_usd_micros == 175_000
    assert r.revenue_net_usd_micros == 4_825_000
    assert r.gross_margin_usd_micros == 4_825_000 - HAPPY_PATH == 4_258_000
    assert r.gross_margin_pct == pytest.approx(88.25, abs=0.01)


def test_margin_is_computed_against_net_not_gross(db, make_user):
    """Margin against gross flatters by roughly the payment fee. Use net."""
    user = make_user()
    _payment(db, user.id, gross=1_000_000, fee=100_000, ref="ch_fee")
    r = reporting.build_margin_report(db)
    assert r.revenue_net_usd_micros == 900_000
    assert r.gross_margin_usd_micros == 900_000


def test_pending_payments_are_not_revenue(db, make_user):
    user = make_user()
    _payment(db, user.id, gross=9_000_000, fee=0, ref="ch_pending", status="pending")
    r = reporting.build_margin_report(db)
    assert r.revenue_net_usd_micros == 0
    assert r.payment_count == 0


def test_refunds_reduce_revenue(db, make_user):
    user = make_user()
    _payment(db, user.id, gross=5_000_000, fee=0, ref="ch_ok")
    _payment(db, user.id, gross=2_000_000, fee=0, ref="ch_back", status="refunded")
    r = reporting.build_margin_report(db)
    assert r.refunds_net_usd_micros == 2_000_000
    assert r.revenue_net_usd_micros == 3_000_000


# ---------------------------------------------------------------------------
# Free tier
# ---------------------------------------------------------------------------

def test_cost_of_free_tier_is_what_unpaid_signups_spent(
    db, make_user, make_creation, completed_steps
):
    payer = make_user(credits=100, username="payer")
    freeloader_a = make_user(credits=100, username="free_a")
    freeloader_b = make_user(credits=100, username="free_b")

    _payment(db, payer.id, gross=10_000_000, fee=0, ref="ch_payer")

    for user in (payer, freeloader_a, freeloader_b):
        creation = make_creation(user.id, completed_steps)
        _happy_hero(db, user.id, creation.id)

    r = reporting.build_margin_report(db)
    assert r.paying_users == 1
    assert r.free_tier_users == 2
    assert r.free_tier_cost_usd_micros == 2 * HAPPY_PATH
    assert r.free_tier_heroes_completed == 2
    assert r.cost_usd_micros == 3 * HAPPY_PATH


def test_a_customer_who_paid_last_month_is_not_free_tier(
    db, make_user, make_creation, completed_steps
):
    """
    "Has ever paid", not "paid in this range". Someone who bought credits in
    March and burnt them in April is a customer, not a freeloader.
    """
    user = make_user(credits=100)
    long_ago = datetime.utcnow() - timedelta(days=120)
    _payment(db, user.id, gross=10_000_000, fee=0, ref="ch_old", when=long_ago)

    creation = make_creation(user.id, completed_steps)
    _happy_hero(db, user.id, creation.id)

    r = reporting.build_margin_report(db)  # default range: last 30 days
    assert r.payment_count == 0            # the payment is outside the range
    assert r.free_tier_cost_usd_micros == 0
    assert r.free_tier_users == 0


# ---------------------------------------------------------------------------
# Per-user and per-creation detail
# ---------------------------------------------------------------------------

def test_per_user_rows_answer_what_did_this_customer_cost_and_pay(
    db, make_user, make_creation, completed_steps
):
    """The question the whole exercise exists to make queryable."""
    user = make_user(credits=100, username="alice")
    other = make_user(credits=100, username="bob")

    _payment(db, user.id, gross=20_000_000, fee=600_000, ref="ch_alice")
    for _ in range(3):
        creation = make_creation(user.id, completed_steps)
        _happy_hero(db, user.id, creation.id)
        ledger.spend_credits(user.id, 10, db, creation_id=creation.id)

    bob_creation = make_creation(other.id, completed_steps)
    _happy_hero(db, other.id, bob_creation.id)

    r = reporting.build_margin_report(db)
    rows = {row.username: row for row in r.users}

    alice = rows["alice"]
    assert alice.is_paying is True
    assert alice.revenue_net_usd_micros == 19_400_000
    assert alice.cost_usd_micros == 3 * HAPPY_PATH
    assert alice.margin_usd_micros == 19_400_000 - 3 * HAPPY_PATH
    assert alice.heroes_completed == 3
    assert alice.cost_per_completed_hero_usd_micros == HAPPY_PATH
    assert alice.credits_spent == 30

    bob = rows["bob"]
    assert bob.is_paying is False
    assert bob.margin_usd_micros == -HAPPY_PATH


def test_report_can_be_scoped_to_one_user(db, make_user, make_creation, completed_steps):
    a = make_user(credits=100, username="a")
    b = make_user(credits=100, username="b")
    for user in (a, b):
        creation = make_creation(user.id, completed_steps)
        _happy_hero(db, user.id, creation.id)

    r = reporting.build_margin_report(db, user_id=a.id)
    assert r.cost_usd_micros == HAPPY_PATH
    assert [row.username for row in r.users] == ["a"]


def test_cost_with_no_creation_is_reported_separately_not_averaged_in(
    db, make_user, make_creation, completed_steps
):
    user = make_user(credits=10)
    creation = make_creation(user.id, completed_steps)
    _happy_hero(db, user.id, creation.id)
    _usage(db, user.id, None, None, "openai", "images.edit")  # a script's call

    r = reporting.build_margin_report(db)
    assert r.unattributed_cost_usd_micros == OPENAI_COST
    assert r.cost_per_successful_hero_usd_micros == HAPPY_PATH  # not inflated
    assert r.cost_usd_micros == HAPPY_PATH + OPENAI_COST
    assert any("no creation_id" in w for w in r.warnings)


def test_unresolved_submitted_calls_are_flagged(db, make_user, make_creation):
    """
    A crash during polling leaves a Meshy task "submitted" forever: we paid and
    never learned whether we got anything. Counted, and called out.
    """
    user = make_user()
    creation = make_creation(user.id)
    _usage(db, user.id, creation.id, "meshy_3d", "meshy", "image-to-3d", status="submitted")

    r = reporting.build_margin_report(db)
    assert r.unresolved_call_count == 1
    assert r.cost_usd_micros == MESHY_COST
    assert any("submitted" in w for w in r.warnings)


# ---------------------------------------------------------------------------
# Date range
# ---------------------------------------------------------------------------

def test_range_bounds_are_respected(db, make_user, make_creation, completed_steps):
    user = make_user(credits=100)
    old = make_creation(user.id, completed_steps)
    recent = make_creation(user.id, completed_steps)

    _happy_hero(db, user.id, old.id, when=datetime.utcnow() - timedelta(days=90))
    _happy_hero(db, user.id, recent.id)

    assert reporting.build_margin_report(db).cost_usd_micros == HAPPY_PATH
    wide = reporting.build_margin_report(
        db, start=datetime.utcnow() - timedelta(days=365)
    )
    assert wide.cost_usd_micros == 2 * HAPPY_PATH


def test_reversed_range_is_corrected_rather_than_returning_nothing(db, make_user, make_creation, completed_steps):
    user = make_user(credits=10)
    creation = make_creation(user.id, completed_steps)
    _happy_hero(db, user.id, creation.id)

    now = datetime.utcnow()
    r = reporting.build_margin_report(db, start=now + timedelta(days=1), end=now - timedelta(days=1))
    assert r.start < r.end
    assert r.cost_usd_micros == HAPPY_PATH


# ---------------------------------------------------------------------------
# Serialisation
# ---------------------------------------------------------------------------

def test_report_serialises_to_json_safe_data(db, make_user, make_creation, completed_steps):
    import json
    user = make_user(credits=10)
    creation = make_creation(user.id, completed_steps)
    _happy_hero(db, user.id, creation.id)
    _payment(db, user.id, gross=5_000_000, fee=0, ref="ch_json")

    payload = reporting.build_margin_report(db).as_dict()
    json.dumps(payload)  # must not raise
    assert payload["cost"]["total_usd"] == "$0.5670"
    assert payload["heroes"]["cost_per_successful_usd"] == "$0.5670"
    assert payload["price_table"]["last_checked"] == pricing.LAST_CHECKED


def test_text_rendering_contains_the_headline_numbers(db, make_user, make_creation, completed_steps):
    user = make_user(credits=10, username="rendertest")
    creation = make_creation(user.id, completed_steps)
    _happy_hero(db, user.id, creation.id)

    text = reporting.render_text(reporting.build_margin_report(db))
    assert "COST PER SUCCESSFUL HERO" in text
    assert "COST OF THE FREE TIER" in text
    assert "GROSS MARGIN" in text
    assert "rendertest" in text
