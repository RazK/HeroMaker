"""
The price table is the report's foundation. If a number here is wrong, every
figure downstream is wrong and looks perfectly plausible while being wrong.

These tests pin today's numbers so that changing one is a deliberate act with a
red test attached, not a silent edit.
"""
import importlib

import pytest

from app.config import pricing


def test_money_is_always_integer_micros():
    """No floats anywhere in the price table. Floats do not add up."""
    snapshot = pricing.price_table_snapshot()
    money_keys = [k for k in snapshot if k.endswith("_micros")]
    assert money_keys, "snapshot has no money fields"
    for key in money_keys:
        assert isinstance(snapshot[key], int), f"{key} is {type(snapshot[key])}, not int"
        assert not isinstance(snapshot[key], bool)


def test_openai_image_price_is_one_six_seven():
    """gpt-image-1, 1024x1024, quality=high: $0.167/image."""
    assert pricing.OPENAI_IMAGE_USD_MICROS == 167_000
    units, cost = pricing.price_call(pricing.PROVIDER_OPENAI, pricing.OP_OPENAI_IMAGE_EDIT)
    assert (units, cost) == (1, 167_000)
    assert pricing.micros_to_usd_str(cost, places=3) == "$0.167"


def test_meshy_image_to_3d_is_twenty_credits_and_forty_cents():
    """20 Meshy credits at the Pro rate of $0.02/credit == $0.40."""
    assert pricing.MESHY_IMAGE_TO_3D_CREDITS == 20
    assert pricing.MESHY_USD_MICROS_PER_CREDIT == 20_000
    units, cost = pricing.price_call(pricing.PROVIDER_MESHY, pricing.OP_MESHY_IMAGE_TO_3D)
    # `units` is in the provider's OWN unit - Meshy credits - so a report line
    # can be reconciled against a Meshy invoice line.
    assert units == 20
    assert cost == 400_000
    assert pricing.micros_to_usd_str(cost, places=2) == "$0.40"


def test_meshy_rig_is_free():
    assert pricing.MESHY_RIG_CREDITS == 0
    assert pricing.price_call(pricing.PROVIDER_MESHY, pricing.OP_MESHY_RIGGING) == (0, 0)


def test_vrm_conversion_is_zero_because_it_is_our_own_compute():
    assert pricing.price_call(pricing.PROVIDER_INTERNAL, pricing.OP_VRM_CONVERT) == (1, 0)


def test_happy_path_hero_costs_567000_micros():
    """
    One hero, nothing retried: one OpenAI render + one Meshy 3D + one rig +
    one VRM conversion. $0.167 + $0.40 + $0 + $0 = $0.567.

    This is the BEST case, and the margin report exists precisely because the
    real number is higher. Pinned here so the floor is known.
    """
    total = (
        pricing.price_call(pricing.PROVIDER_OPENAI, pricing.OP_OPENAI_IMAGE_EDIT)[1]
        + pricing.price_call(pricing.PROVIDER_MESHY, pricing.OP_MESHY_IMAGE_TO_3D)[1]
        + pricing.price_call(pricing.PROVIDER_MESHY, pricing.OP_MESHY_RIGGING)[1]
        + pricing.price_call(pricing.PROVIDER_INTERNAL, pricing.OP_VRM_CONVERT)[1]
    )
    assert total == 567_000
    assert pricing.micros_to_usd_str(total, places=3) == "$0.567"


def test_meshy_is_seventy_percent_of_a_hero():
    """
    The claim that motivates making the Meshy rate configurable. Asserted so it
    stays true (or fails loudly when a price move makes it false).
    """
    meshy = pricing.price_call(pricing.PROVIDER_MESHY, pricing.OP_MESHY_IMAGE_TO_3D)[1]
    openai_cost = pricing.price_call(pricing.PROVIDER_OPENAI, pricing.OP_OPENAI_IMAGE_EDIT)[1]
    share = meshy / (meshy + openai_cost)
    assert 0.65 <= share <= 0.75, f"Meshy is {share:.0%} of a hero, expected ~70%"


def test_meshy_rate_is_configurable_from_the_environment(monkeypatch):
    """
    The per-credit rate changes with the plan tier, so it must be settable
    without a code change. Re-imports the module with a different environment
    and checks the derived price moves with it.
    """
    monkeypatch.setenv("MESHY_USD_MICROS_PER_CREDIT", "35000")  # $0.035/credit
    reloaded = importlib.reload(pricing)
    try:
        assert reloaded.MESHY_USD_MICROS_PER_CREDIT == 35_000
        assert reloaded.price_call(
            reloaded.PROVIDER_MESHY, reloaded.OP_MESHY_IMAGE_TO_3D
        ) == (20, 700_000)
    finally:
        monkeypatch.delenv("MESHY_USD_MICROS_PER_CREDIT", raising=False)
        monkeypatch.setenv("MESHY_USD_MICROS_PER_CREDIT", "20000")
        importlib.reload(pricing)
    assert pricing.MESHY_USD_MICROS_PER_CREDIT == 20_000


def test_unknown_operation_prices_at_zero_rather_than_exploding():
    """
    A missing price must never break the pipeline that is earning the money.
    It shows up in the report as calls with no cost, which is a visible bug.
    """
    assert pricing.price_call(pricing.PROVIDER_MESHY, "some-new-endpoint") == (0, 0)
    assert pricing.price_call("nonexistent-provider", "whatever") == (1, 0)


@pytest.mark.parametrize("micros,places,expected", [
    (0, 2, "$0.00"),
    (167_000, 3, "$0.167"),
    (400_000, 2, "$0.40"),
    (1_234_567, 4, "$1.2345"),
    (-567_000, 3, "-$0.567"),
])
def test_micros_render_as_dollars(micros, places, expected):
    assert pricing.micros_to_usd_str(micros, places=places) == expected


def test_price_table_records_when_it_was_checked():
    """A price with no provenance is a guess; the report must surface the date."""
    assert pricing.price_table_snapshot()["last_checked"] == pricing.LAST_CHECKED
    assert len(pricing.LAST_CHECKED) == 10  # YYYY-MM-DD
