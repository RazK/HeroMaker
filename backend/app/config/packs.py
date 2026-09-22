"""
What we sell: credit packs, their prices, and the proof that each one earns money.

This module sits on top of `app.config.pricing` (what a hero COSTS us) and turns
it into what a hero SELLS for. Nothing here is a guess: `credit_cost_usd_micros`
is computed from the same price table the margin report uses, so if a provider
raises its prices the margin figures below move on their own and the guard in
`check_packs()` starts failing.

RULES
-----
* Money is integer USD micros, same as `pricing`. Lemon Squeezy wants cents, so
  the only place micros become cents is `price_cents()`.
* A pack's `variant_id` is the Lemon Squeezy variant it maps to. It is read from
  the environment, never committed - the ids differ between test and live mode.
* Bigger packs get a better per-credit price, but `MIN_GROSS_MARGIN` is the
  floor. A pack that cannot clear it is a bug, not a promotion.
"""
import os
from typing import Dict, List, Optional

from app.config import pricing
from app.config.steps import STEPS

USD_MICROS = pricing.USD_MICROS

# --------------------------------------------------------------------------
# What one credit costs us
# --------------------------------------------------------------------------

# Which provider call each pipeline step makes. Steps that cost us nothing
# (local image processing, our own VRM converter) are still listed, explicitly
# at zero, so that adding a step without pricing it shows up as a KeyError here
# rather than as a silent hole in the margin.
STEP_PROVIDER_COST = {
    "image_processing": (pricing.PROVIDER_INTERNAL, None),
    "openai_render": (pricing.PROVIDER_OPENAI, pricing.OP_OPENAI_IMAGE_EDIT),
    "meshy_3d": (pricing.PROVIDER_MESHY, pricing.OP_MESHY_IMAGE_TO_3D),
    "meshy_rig": (pricing.PROVIDER_MESHY, pricing.OP_MESHY_RIGGING),
    "convert_vrm": (pricing.PROVIDER_INTERNAL, pricing.OP_VRM_CONVERT),
}


def creation_cost_usd_micros() -> int:
    """What one full hero costs us in provider fees, in USD micros."""
    total = 0
    for step in STEPS:
        provider, operation = STEP_PROVIDER_COST[step["name"]]
        if operation is None:
            continue
        total += pricing.unit_cost_usd_micros(provider, operation)
    return total


def creation_credit_price() -> int:
    """What we charge for one full hero, in credits."""
    return sum(step["credit_cost"] for step in STEPS)


def credit_cost_usd_micros() -> int:
    """
    What ONE credit costs us, in USD micros.

    Derived, not declared: total provider cost of a hero divided by the credits
    we charge for a hero. Rounded UP, so the margin we report is never better
    than the margin we actually make.
    """
    credits = creation_credit_price()
    if credits <= 0:
        raise ValueError("A creation must cost a positive number of credits")
    cost = creation_cost_usd_micros()
    return -(-cost // credits)  # ceiling division on integers


# --------------------------------------------------------------------------
# What the payment processor takes
# --------------------------------------------------------------------------

# Lemon Squeezy is a merchant of record: it takes a cut and handles sales tax
# and VAT for us. Published rate, checked 2026-09-22:
#   https://www.lemonsqueezy.com/pricing
# 5% + 50c per transaction. International cards add 1.5% and PayPal adds 1.5%;
# we do NOT model those, so a real payout can come in slightly under the figures
# here. That is the safe direction to be wrong in for a floor check, but do not
# quote these as exact payouts.
MOR_PERCENT_BPS = 500          # 5.00%, in basis points
MOR_FIXED_USD_MICROS = 500_000  # $0.50
MOR_PROVENANCE = "lemonsqueezy.com/pricing, checked 2026-09-22"


def processor_fee_usd_micros(price_usd_micros: int) -> int:
    """The processor's cut of a sale, rounded UP against us."""
    percent = -(-price_usd_micros * MOR_PERCENT_BPS // 10_000)
    return percent + MOR_FIXED_USD_MICROS


# --------------------------------------------------------------------------
# The packs
# --------------------------------------------------------------------------

# No pack may earn less than this share of its NET revenue (after the processor
# takes its cut). 50% leaves room for a provider price rise, refunds, and the
# card fees we deliberately do not model above.
MIN_GROSS_MARGIN_BPS = 5000  # 50.00%

# slug -> definition. `heroes` is display only: it is the pack's credits divided
# by the price of a hero, and it is recomputed here rather than typed in.
_PACKS: List[Dict] = [
    {
        "slug": "starter",
        "name": "Starter",
        "blurb": "Three heroes to try it out.",
        "price_usd_micros": 5 * USD_MICROS,
        "credits": 30,
        "highlight": False,
    },
    {
        "slug": "maker",
        "name": "Maker",
        "blurb": "Ten heroes, and the best value to start with.",
        "price_usd_micros": 15 * USD_MICROS,
        "credits": 100,
        "highlight": True,
    },
    {
        "slug": "studio",
        "name": "Studio",
        "blurb": "Thirty heroes. For a classroom or a party.",
        "price_usd_micros": 40 * USD_MICROS,
        "credits": 300,
        "highlight": False,
    },
]


def _variant_env_key(slug: str) -> str:
    return f"LEMONSQUEEZY_VARIANT_{slug.upper()}"


def variant_id(slug: str) -> Optional[str]:
    """
    The Lemon Squeezy variant id for a pack, from the environment.

    Returns None when it has not been configured, which is what
    `app.api.payments` turns into an honest 503 rather than a broken checkout.
    """
    value = os.getenv(_variant_env_key(slug))
    return value.strip() if value and value.strip() else None


def price_cents(price_usd_micros: int) -> int:
    """USD micros as whole cents, for the Lemon Squeezy API."""
    return price_usd_micros // 10_000


def margin(pack: Dict) -> Dict:
    """
    The arithmetic that proves a pack makes money. Every field is USD micros
    except the two *_bps ratios.
    """
    price = pack["price_usd_micros"]
    fee = processor_fee_usd_micros(price)
    net = price - fee
    cost = pack["credits"] * credit_cost_usd_micros()
    profit = net - cost
    return {
        "price_usd_micros": price,
        "processor_fee_usd_micros": fee,
        "net_usd_micros": net,
        "provider_cost_usd_micros": cost,
        "profit_usd_micros": profit,
        # Share of net revenue we keep. Negative if a pack loses money.
        "gross_margin_bps": (profit * 10_000 // net) if net > 0 else -10_000,
        # What the buyer pays per credit, and what it costs us.
        "price_per_credit_usd_micros": price // pack["credits"],
        "cost_per_credit_usd_micros": credit_cost_usd_micros(),
    }


def get_packs(include_unconfigured: bool = True) -> List[Dict]:
    """
    Every pack, with its margin worked out and its variant id resolved.

    `include_unconfigured=False` drops packs with no Lemon Squeezy variant set,
    which is what the public pricing endpoint wants: never show a customer a
    button that cannot open a checkout.
    """
    out = []
    per_hero = creation_credit_price()
    for pack in _PACKS:
        vid = variant_id(pack["slug"])
        if vid is None and not include_unconfigured:
            continue
        out.append({
            **pack,
            "heroes": pack["credits"] // per_hero,
            "price_cents": price_cents(pack["price_usd_micros"]),
            "price_display": pricing.micros_to_usd_str(pack["price_usd_micros"]),
            "variant_id": vid,
            "configured": vid is not None,
            "margin": margin(pack),
        })
    return out


def get_pack(slug: str) -> Optional[Dict]:
    for pack in get_packs():
        if pack["slug"] == slug:
            return pack
    return None


def check_packs() -> List[str]:
    """
    Every reason the price list is wrong, as a list of sentences. Empty means
    every pack clears the margin floor and the per-credit price falls as packs
    get bigger. Called by the tests and by the admin finance page.
    """
    problems: List[str] = []
    packs = get_packs()

    for pack in packs:
        m = pack["margin"]
        if m["profit_usd_micros"] <= 0:
            problems.append(
                f"{pack['name']} loses money: "
                f"{pricing.micros_to_usd_str(m['net_usd_micros'])} net "
                f"against {pricing.micros_to_usd_str(m['provider_cost_usd_micros'])} of provider cost."
            )
        elif m["gross_margin_bps"] < MIN_GROSS_MARGIN_BPS:
            problems.append(
                f"{pack['name']} margin is {m['gross_margin_bps'] / 100:.1f}%, "
                f"below the {MIN_GROSS_MARGIN_BPS / 100:.0f}% floor."
            )

    ordered = sorted(packs, key=lambda p: p["price_usd_micros"])
    for smaller, bigger in zip(ordered, ordered[1:]):
        if bigger["margin"]["price_per_credit_usd_micros"] > smaller["margin"]["price_per_credit_usd_micros"]:
            problems.append(
                f"{bigger['name']} costs more per credit than {smaller['name']}; "
                "a bigger pack should always be better value."
            )

    return problems
