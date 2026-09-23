"""
Price table for every paid external call the pipeline makes.

ONE MODULE, ONE SOURCE OF TRUTH. If a provider changes its prices, this file is
the only place that has to change.

RULES
-----
* Money is ALWAYS an integer number of USD micros (1 USD = 1_000_000 micros).
  Never float, never Decimal, never "dollars as a float". Integers add up
  exactly and survive a round-trip through JSON, SQLite and Postgres unchanged.
* Every number below carries a provenance comment: where it came from and when
  it was last checked. A price with no provenance is a guess, and a guess in a
  margin report is worse than no margin report.

PROVENANCE
----------
All figures below were supplied by the product owner on 2026-09-16 and have NOT
been re-verified against the providers' public price pages by this module's
author. Re-check them before quoting the margin report to anyone outside the
team, and update LAST_CHECKED when you do.
"""
import os

# --------------------------------------------------------------------------
# Units
# --------------------------------------------------------------------------

USD_MICROS = 1_000_000  # 1 USD expressed in micros

# Date the numbers in this file were last confirmed with a provider price page
# or an invoice. Surfaced in the margin report so a stale table is visible.
LAST_CHECKED = "2026-09-16"

# --------------------------------------------------------------------------
# Provider identifiers (also the `provider` column values on usage_events)
# --------------------------------------------------------------------------

PROVIDER_OPENAI = "openai"
PROVIDER_MESHY = "meshy"
PROVIDER_INTERNAL = "internal"

PROVIDERS = (PROVIDER_OPENAI, PROVIDER_MESHY, PROVIDER_INTERNAL)

# --------------------------------------------------------------------------
# OpenAI
# --------------------------------------------------------------------------

# gpt-image-1, size 1024x1024, quality "high", one image.
# $0.167 per image. Source: product owner, checked 2026-09-16.
# This is what app/services/openai.py::render_image asks for; if the size or
# quality in that call changes, this number is wrong.
OPENAI_IMAGE_USD_MICROS = 167_000

# --------------------------------------------------------------------------
# Meshy
# --------------------------------------------------------------------------

# Meshy bills in its own "Meshy credits". The dollar value of one Meshy credit
# depends on the plan tier, so it is configuration, not a constant: on the Pro
# plan it is $0.02/credit. Source: product owner, checked 2026-09-16.
#
# This single number is roughly 70% of the cost of producing one hero. Set
# MESHY_USD_MICROS_PER_CREDIT in the environment when the plan tier changes.
MESHY_USD_MICROS_PER_CREDIT = int(os.getenv("MESHY_USD_MICROS_PER_CREDIT", "20000"))  # $0.02

# Image-to-3D *including* texturing, which is how the pipeline calls it
# (should_texture=True). 20 Meshy credits. Source: product owner, 2026-09-16.
MESHY_IMAGE_TO_3D_CREDITS = 20

# Auto-rigging is free on Meshy at the time of checking: 0 credits.
# Source: product owner, 2026-09-16. Recorded anyway, at zero cost, so that the
# call volume is measurable and the day it stops being free is one number here.
MESHY_RIG_CREDITS = 0


def meshy_credits_to_usd_micros(credits: int) -> int:
    """Convert Meshy credits to USD micros. Integer maths only."""
    return int(credits) * MESHY_USD_MICROS_PER_CREDIT


# --------------------------------------------------------------------------
# Internal compute
# --------------------------------------------------------------------------

# VRM conversion runs on our own container. There is a real cost (Railway
# compute) but it is not per-call attributable, so it is booked at zero here and
# the events are recorded for volume only. Do not confuse "0" with "free".
VRM_CONVERSION_USD_MICROS = 0

# --------------------------------------------------------------------------
# Billing policy
# --------------------------------------------------------------------------

# Do providers charge for calls that fail?
#
# Assumption: no. OpenAI does not bill a rejected/errored image generation, and
# Meshy refunds the credits for a task that ends FAILED. This assumption is NOT
# verified against an invoice — it is the conservative reading.
#
# Consequence: a failed call is written to usage_events with
# cost_usd_micros = 0, and the price it *would* have cost is kept in the event's
# metadata under "list_price_usd_micros". So failure volume is always visible
# even when failure cost is zero, and flipping this flag to True re-prices the
# whole report without touching any other code.
BILL_FAILED_CALLS = False

# --------------------------------------------------------------------------
# Operation catalogue: (provider, operation) -> unit price
# --------------------------------------------------------------------------

OP_OPENAI_IMAGE_EDIT = "images.edit"
OP_MESHY_IMAGE_TO_3D = "image-to-3d"
OP_MESHY_RIGGING = "rigging"
OP_MESHY_REMESH = "remesh"
OP_MESHY_RETEXTURE = "retexture"
OP_MESHY_ANIMATION = "animation"
OP_VRM_CONVERT = "convert_vrm"

# Meshy credits per operation. Operations not in this table are billed at 0 and
# logged, rather than silently dropped.
# Remesh/retexture/animation: the pipeline does not currently call these as
# separate billable tasks (remeshing and texturing ride along with image-to-3d).
# They are listed at 0 so that if anyone starts calling them the events appear
# with an obviously-wrong zero price rather than not appearing at all.
MESHY_OPERATION_CREDITS = {
    OP_MESHY_IMAGE_TO_3D: MESHY_IMAGE_TO_3D_CREDITS,
    OP_MESHY_RIGGING: MESHY_RIG_CREDITS,
    OP_MESHY_REMESH: 0,
    OP_MESHY_RETEXTURE: 0,
    OP_MESHY_ANIMATION: 0,
}


def unit_cost_usd_micros(provider: str, operation: str) -> int:
    """
    Price of ONE unit of (provider, operation), in USD micros.

    Unknown combinations return 0 rather than raising: a missing price must
    never break the pipeline that is earning the money. The event is still
    written, so an unpriced operation shows up in the report as calls with no
    cost, which is a visible bug rather than a silent one.
    """
    if provider == PROVIDER_OPENAI:
        if operation == OP_OPENAI_IMAGE_EDIT:
            return OPENAI_IMAGE_USD_MICROS
        return 0
    if provider == PROVIDER_MESHY:
        return meshy_credits_to_usd_micros(MESHY_OPERATION_CREDITS.get(operation, 0))
    if provider == PROVIDER_INTERNAL:
        return VRM_CONVERSION_USD_MICROS if operation == OP_VRM_CONVERT else 0
    return 0


def price_table_snapshot() -> dict:
    """
    The whole price table as plain data, for the margin report header.

    A report that does not say what prices it used cannot be checked later.
    """
    return {
        "last_checked": LAST_CHECKED,
        "bill_failed_calls": BILL_FAILED_CALLS,
        "openai_image_usd_micros": OPENAI_IMAGE_USD_MICROS,
        "meshy_usd_micros_per_credit": MESHY_USD_MICROS_PER_CREDIT,
        "meshy_image_to_3d_credits": MESHY_IMAGE_TO_3D_CREDITS,
        "meshy_image_to_3d_usd_micros": meshy_credits_to_usd_micros(MESHY_IMAGE_TO_3D_CREDITS),
        "meshy_rig_credits": MESHY_RIG_CREDITS,
        "meshy_rig_usd_micros": meshy_credits_to_usd_micros(MESHY_RIG_CREDITS),
        "vrm_conversion_usd_micros": VRM_CONVERSION_USD_MICROS,
    }


# --------------------------------------------------------------------------
# Formatting helpers (display only - never feed these back into arithmetic)
# --------------------------------------------------------------------------

def micros_to_usd_str(micros: int, places: int = 4) -> str:
    """Render USD micros as a '$1.2345' string. Display only."""
    sign = "-" if micros < 0 else ""
    micros = abs(int(micros))
    whole, frac = divmod(micros, USD_MICROS)
    frac_str = f"{frac:06d}"[:places]
    return f"{sign}${whole}.{frac_str}" if places else f"{sign}${whole}"


def price_call(provider: str, operation: str, quantity: int = 1) -> tuple:
    """
    Price one provider call.

    Args:
        provider: one of PROVIDERS.
        operation: e.g. OP_MESHY_IMAGE_TO_3D.
        quantity: how many times the operation is performed in this call
            (n images, n models). Almost always 1.

    Returns:
        (units, cost_usd_micros) where `units` is the provider's OWN billable
        unit - images for OpenAI, Meshy credits for Meshy - so that a usage_event
        row can be reconciled line-by-line against the provider's invoice.
        `cost_usd_micros` is an exact integer.
    """
    quantity = int(quantity)
    if provider == PROVIDER_MESHY:
        units = quantity * MESHY_OPERATION_CREDITS.get(operation, 0)
        return units, meshy_credits_to_usd_micros(units)
    if provider == PROVIDER_OPENAI:
        return quantity, quantity * unit_cost_usd_micros(provider, operation)
    return quantity, quantity * unit_cost_usd_micros(provider, operation)
