#!/usr/bin/env python
"""
Seed a demonstration of the financial spine and print the margin report.

The whole thing - ledger, per-call cost capture, revenue, margin - demonstrated
end to end without a real customer, a real API key or a single dollar spent.

    .venv/bin/python backend/scripts/seed_demo.py

By default it writes to a THROWAWAY SQLite file under the system temp directory,
not to your project database, so it is safe to run repeatedly. Point it
somewhere else with --database-url, or use the project's own database with
--use-project-db.

WHAT IT CREATES
---------------
Two users:
  * a paying customer who bought 40 credits for $9.99 (webhook delivered TWICE,
    to show the replay defence doing its job);
  * a free-tier signup who never paid anything.

Three creations, with the failure shapes that actually happen in production:
  1. clean run                  - the happy path, $0.567
  2. retried run                - OpenAI moderation-blocks the first render,
                                  the retry succeeds, then Meshy 3D fails once
                                  and succeeds on the retry. Costs roughly twice
                                  the happy path.
  3. abandoned run (free tier)  - render and 3D both succeed, rigging fails, the
                                  hero is never delivered. Every dollar of it is
                                  waste, and it is what the "cost of free tier"
                                  line is made of.
"""
import argparse
import os
import sys
import tempfile
import uuid
from datetime import datetime, timedelta
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))


def _configure_database(args) -> str:
    """
    MUST run before any `app.*` import: app/database.py builds its engine at
    import time from app/config/settings.py.
    """
    if args.use_project_db:
        return os.environ.get("DATABASE_URL", "(project default)")
    url = args.database_url
    if not url:
        demo_path = Path(tempfile.gettempdir()) / "heromaker-seed-demo.db"
        if args.fresh and demo_path.exists():
            demo_path.unlink()
        url = f"sqlite:///{demo_path}"
    os.environ["DATABASE_URL"] = url
    return url


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--database-url", help="Where to seed. Default: a temp SQLite file.")
    parser.add_argument("--use-project-db", action="store_true",
                        help="Seed into the project's configured database instead.")
    parser.add_argument("--fresh", action="store_true", default=True,
                        help="Delete the demo database first (default).")
    parser.add_argument("--keep", dest="fresh", action="store_false",
                        help="Append to an existing demo database.")
    args = parser.parse_args()

    url = _configure_database(args)

    from app.config import pricing
    from app.database import Base, SessionLocal, engine
    from app.migrations.registry import run_migrations
    from app.models import Creation, CreationStep, Payment, UsageEvent, User
    from app.services import ledger, reporting
    from app.services.usage import UsageContext

    Base.metadata.create_all(bind=engine)
    run_migrations()

    db = SessionLocal()
    try:
        _seed(db, pricing, ledger, Creation, CreationStep, Payment, UsageEvent, User)
        report = reporting.build_margin_report(
            db, start=datetime.utcnow() - timedelta(days=1)
        )
        print()
        print(reporting.render_text(report))
        print()
        _explain(report, pricing, ledger, db, User)
    finally:
        db.close()

    print(f"\nSeeded into: {url}")
    print("Inspect it with:")
    print(f'  .venv/bin/python backend/scripts/inspect_db.py "{url}"')
    return 0


# ---------------------------------------------------------------------------

def _seed(db, pricing, ledger, Creation, CreationStep, Payment, UsageEvent, User):
    from app.config.steps import get_all_step_names

    stamp = uuid.uuid4().hex[:6]

    customer = User(email=f"paying-{stamp}@demo.test", username=f"paying_{stamp}", credits=0)
    freeloader = User(email=f"free-{stamp}@demo.test", username=f"free_{stamp}", credits=0)
    db.add_all([customer, freeloader])
    db.commit()
    db.refresh(customer)
    db.refresh(freeloader)

    # ---- revenue ---------------------------------------------------------
    # $9.99 charged, Stripe keeps 2.9% + 30c = $0.59, $9.40 lands.
    order_ref = f"ch_demo_{stamp}"
    db.add(Payment(
        user_id=customer.id, provider="stripe", provider_ref=order_ref,
        gross_usd_micros=9_990_000, fee_usd_micros=590_000, net_usd_micros=9_400_000,
        status="succeeded", created_at=datetime.utcnow(),
        metadata_json={"sku": "40-credit-pack"},
    ))
    db.commit()

    # The credit grant, delivered TWICE - which is what payment providers
    # actually do. The second delivery must be a no-op.
    ledger.record_purchase(customer.id, 40, db, external_ref=order_ref,
                           metadata={"sku": "40-credit-pack"})
    ledger.record_purchase(customer.id, 40, db, external_ref=order_ref,
                           metadata={"sku": "40-credit-pack", "delivery": "replay"})

    # The free-tier signup gets a welcome grant. Credits, not money.
    ledger.post(db=db, user_id=freeloader.id, delta=10, reason="signup_grant",
                metadata={"campaign": "launch"})

    all_steps = get_all_step_names()

    def creation(user, step_statuses):
        c = Creation(user_id=user.id, character_name="Demo Hero")
        db.add(c)
        db.commit()
        db.refresh(c)
        for name in all_steps:
            db.add(CreationStep(creation_id=c.id, step_name=name,
                                status=step_statuses.get(name, "pending")))
        db.commit()
        return c

    def call(user, creation_obj, step, provider, operation, status="succeeded",
             minutes_ago=0, provider_ref=None):
        units, cost = pricing.price_call(provider, operation)
        meta = {}
        if status == "failed" and not pricing.BILL_FAILED_CALLS:
            meta = {"list_price_usd_micros": cost,
                    "not_billed_reason": "call failed; provider assumed not to bill"}
            cost = 0
        db.add(UsageEvent(
            user_id=user.id, creation_id=creation_obj.id, step_name=step,
            provider=provider, operation=operation, units=units,
            cost_usd_micros=cost, status=status,
            provider_ref=provider_ref or f"{operation}-{uuid.uuid4().hex[:8]}",
            created_at=datetime.utcnow() - timedelta(minutes=minutes_ago),
            metadata_json=meta,
        ))
        db.commit()

    def spend(user, creation_obj, step, credits):
        ledger.spend_credits(user.id, credits, db,
                             creation_id=creation_obj.id, step_name=step)

    # ---- 1. clean run ----------------------------------------------------
    clean = creation(customer, {s: "completed" for s in all_steps})
    call(customer, clean, "openai_render", "openai", "images.edit", minutes_ago=180)
    spend(customer, clean, "openai_render", 2)
    call(customer, clean, "meshy_3d", "meshy", "image-to-3d", minutes_ago=178)
    spend(customer, clean, "meshy_3d", 5)
    call(customer, clean, "meshy_rig", "meshy", "rigging", minutes_ago=172)
    spend(customer, clean, "meshy_rig", 2)
    call(customer, clean, "convert_vrm", "internal", "convert_vrm", minutes_ago=171)
    spend(customer, clean, "convert_vrm", 1)

    # ---- 2. retried run --------------------------------------------------
    # The expensive failure shape, and the one nobody measures. It is NOT the
    # calls that error - those are refunded. It is the calls that SUCCEED and
    # then get thrown away, because the rig failed downstream and the user
    # re-ran the whole pipeline. Every one of those is a second full charge.
    retried = creation(customer, {s: "completed" for s in all_steps})

    # First attempt: a moderation block (not billed), then a good render...
    call(customer, retried, "openai_render", "openai", "images.edit",
         status="failed", minutes_ago=150)
    call(customer, retried, "openai_render", "openai", "images.edit", minutes_ago=148)
    spend(customer, retried, "openai_render", 2)
    # ...a good 3D model...
    call(customer, retried, "meshy_3d", "meshy", "image-to-3d", minutes_ago=145)
    spend(customer, retried, "meshy_3d", 5)
    # ...and a rig that came back FAILED. Refunded by Meshy, but everything
    # above it is now scrap.
    call(customer, retried, "meshy_rig", "meshy", "rigging",
         status="failed", minutes_ago=138)

    # Second attempt: the user hits retry. Render and 3D are paid for AGAIN.
    call(customer, retried, "openai_render", "openai", "images.edit", minutes_ago=130)
    spend(customer, retried, "openai_render", 2)
    call(customer, retried, "meshy_3d", "meshy", "image-to-3d", minutes_ago=128)
    spend(customer, retried, "meshy_3d", 5)
    call(customer, retried, "meshy_rig", "meshy", "rigging", minutes_ago=120)
    spend(customer, retried, "meshy_rig", 2)
    call(customer, retried, "convert_vrm", "internal", "convert_vrm", minutes_ago=119)
    spend(customer, retried, "convert_vrm", 1)

    # ---- 3. abandoned run, free tier -------------------------------------
    abandoned = creation(freeloader, {
        "image_processing": "completed",
        "openai_render": "completed",
        "meshy_3d": "completed",
        "meshy_rig": "failed",
        "convert_vrm": "pending",
    })
    call(freeloader, abandoned, "openai_render", "openai", "images.edit", minutes_ago=60)
    spend(freeloader, abandoned, "openai_render", 2)
    call(freeloader, abandoned, "meshy_3d", "meshy", "image-to-3d", minutes_ago=58)
    spend(freeloader, abandoned, "meshy_3d", 5)
    call(freeloader, abandoned, "meshy_rig", "meshy", "rigging",
         status="failed", minutes_ago=52)


def _explain(report, pricing, ledger, db, User):
    m = pricing.micros_to_usd_str
    print("WHAT THIS DEMONSTRATES")
    print("-" * 78)
    print("  1. The webhook for the $9.99 purchase was delivered TWICE. The ledger")
    print("     credited 40 credits ONCE:")
    for user in db.query(User).all():
        check = ledger.verify_user_balance(user.id, db)
        rows = ledger.list_transactions(user.id, db)
        grants = [t for t in rows if t.delta > 0]
        print(f"       {user.username:<18} balance {check.cached:>4}   "
              f"ledger {check.ledger:>4}   consistent={check.consistent}   "
              f"{len(grants)} grant(s), {len(rows)} ledger row(s)")
    print()
    happy_path = 567_000
    worst = max(report.creations, key=lambda c: c.cost_usd_micros)
    print("  2. Cost per successful hero is NOT the happy-path price. The happy")
    print(f"     path is {m(happy_path, 3)}; the report says "
          f"{m(report.cost_per_successful_hero_usd_micros, 4)} - "
          f"{report.cost_per_successful_hero_usd_micros / happy_path:.2f}x - because")
    print(f"     creation {worst.creation_id[:8]} needed {worst.calls} calls "
          f"({worst.retried_calls} of them repeats) and cost {m(worst.cost_usd_micros, 4)}.")
    print("     Those repeats are calls that SUCCEEDED and were thrown away when a")
    print("     later step failed. They are the cost overrun nobody measures.")
    print()
    print(f"  3. {m(report.cost_of_incomplete_heroes_usd_micros)} was spent on a hero that was never delivered.")
    print(f"     Fully loaded, each hero delivered actually cost "
          f"{m(report.fully_loaded_cost_per_successful_hero_usd_micros, 4)}.")
    print()
    print(f"  4. The free tier cost {m(report.free_tier_cost_usd_micros)} and delivered "
          f"{report.free_tier_heroes_completed} hero(es).")
    print()
    print("  5. Every figure above is an integer number of USD micros. No floats,")
    print("     no Decimals, nothing that can drift by a cent.")


if __name__ == "__main__":
    sys.exit(main())
