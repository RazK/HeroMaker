"""
The margin report: what did this customer cost me, and what did they pay.

WHAT IT ANSWERS
---------------
Revenue, cost and gross margin over a date range - overall, per user and per
creation - plus the two numbers that actually decide whether the business works:

  cost_per_successful_hero
      Total provider cost of the creations that finished, divided by how many
      finished. INCLUDES the failed calls and retries those heroes needed, which
      is the whole point: the list price of one happy path is a fiction.

  fully_loaded_cost_per_successful_hero
      The same, but the numerator is EVERY dollar spent in the range - including
      money burnt on creations that never finished at all. If you are pricing a
      hero, this is the floor, not the one above.

And the line nobody wants to look at:

  free_tier_cost
      What users who have never paid anything managed to spend of your money.

HOW COST IS ATTRIBUTED
----------------------
From `usage_events`, one row per provider call, written by
app/services/usage.py at the moment the call is made. Cost belongs to a creation
via `usage_events.creation_id`. Events with no creation (scripts, manual calls)
are reported separately as `unattributed_cost_usd_micros` rather than being
quietly folded into an average.

HOW REVENUE IS ATTRIBUTED
-------------------------
From `payments`. Nothing writes rows there yet - payments land next phase - so
today every revenue figure is zero and every margin is negative by exactly the
cost. That is correct, not broken: the report is wired end to end and starts
telling the truth the moment the payments integration INSERTs its first row.

Margin is computed against NET revenue (after the payment provider's fee),
because margin against gross flatters by roughly 3%.

ALL MONEY IS INTEGER USD MICROS. Ratios are computed with integer division.
"""
import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import pricing
from app.models import Creation, CreditTransaction, Payment, UsageEvent, User

logger = logging.getLogger(__name__)

# Payment statuses that count as money actually received / given back.
REVENUE_STATUSES = ("succeeded",)
REFUND_STATUSES = ("refunded",)


# ---------------------------------------------------------------------------
# Row shapes
# ---------------------------------------------------------------------------

@dataclass
class CreationRow:
    creation_id: str
    user_id: Optional[str]
    username: Optional[str]
    status: str
    created_at: Optional[datetime]
    cost_usd_micros: int
    calls: int
    failed_calls: int
    # Calls beyond the one-per-step the happy path needs. This is the retry
    # count, and it is the difference between the brochure cost of a hero and
    # the real one.
    retried_calls: int
    credits_spent: int
    cost_by_provider: Dict[str, int] = field(default_factory=dict)

    def as_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["created_at"] = self.created_at.isoformat() if self.created_at else None
        d["cost_usd"] = pricing.micros_to_usd_str(self.cost_usd_micros)
        return d


@dataclass
class UserRow:
    user_id: str
    username: Optional[str]
    is_paying: bool
    created_at: Optional[datetime]
    revenue_gross_usd_micros: int
    revenue_fee_usd_micros: int
    revenue_net_usd_micros: int
    cost_usd_micros: int
    margin_usd_micros: int
    creations_touched: int
    heroes_completed: int
    heroes_failed: int
    cost_per_completed_hero_usd_micros: Optional[int]
    credits_balance: int
    credits_spent: int

    def as_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["created_at"] = self.created_at.isoformat() if self.created_at else None
        d["revenue_net_usd"] = pricing.micros_to_usd_str(self.revenue_net_usd_micros)
        d["cost_usd"] = pricing.micros_to_usd_str(self.cost_usd_micros)
        d["margin_usd"] = pricing.micros_to_usd_str(self.margin_usd_micros)
        return d


@dataclass
class MarginReport:
    generated_at: datetime
    start: datetime
    end: datetime

    # Revenue
    revenue_gross_usd_micros: int
    revenue_fee_usd_micros: int
    revenue_net_usd_micros: int
    refunds_net_usd_micros: int
    payment_count: int

    # Cost
    cost_usd_micros: int
    cost_by_provider: Dict[str, int]
    cost_by_step: Dict[str, int]
    call_count: int
    failed_call_count: int
    unresolved_call_count: int
    unattributed_cost_usd_micros: int

    # Margin
    gross_margin_usd_micros: int
    gross_margin_pct: Optional[float]

    # Heroes
    creations_touched: int
    heroes_completed: int
    heroes_failed: int
    heroes_in_progress: int
    cost_of_completed_heroes_usd_micros: int
    cost_of_incomplete_heroes_usd_micros: int
    cost_per_successful_hero_usd_micros: Optional[int]
    fully_loaded_cost_per_successful_hero_usd_micros: Optional[int]

    # Free tier
    free_tier_cost_usd_micros: int
    free_tier_users: int
    free_tier_heroes_completed: int
    paying_users: int

    price_table: Dict[str, Any]
    users: List[UserRow]
    creations: List[CreationRow]
    warnings: List[str]

    def as_dict(self) -> Dict[str, Any]:
        return {
            "generated_at": self.generated_at.isoformat(),
            "range": {"start": self.start.isoformat(), "end": self.end.isoformat()},
            "revenue": {
                "gross_usd_micros": self.revenue_gross_usd_micros,
                "fee_usd_micros": self.revenue_fee_usd_micros,
                "net_usd_micros": self.revenue_net_usd_micros,
                "refunds_net_usd_micros": self.refunds_net_usd_micros,
                "payment_count": self.payment_count,
                "net_usd": pricing.micros_to_usd_str(self.revenue_net_usd_micros),
            },
            "cost": {
                "total_usd_micros": self.cost_usd_micros,
                "total_usd": pricing.micros_to_usd_str(self.cost_usd_micros),
                "by_provider": self.cost_by_provider,
                "by_step": self.cost_by_step,
                "call_count": self.call_count,
                "failed_call_count": self.failed_call_count,
                "unresolved_call_count": self.unresolved_call_count,
                "unattributed_usd_micros": self.unattributed_cost_usd_micros,
            },
            "margin": {
                "gross_usd_micros": self.gross_margin_usd_micros,
                "gross_usd": pricing.micros_to_usd_str(self.gross_margin_usd_micros),
                "gross_pct": self.gross_margin_pct,
            },
            "heroes": {
                "creations_touched": self.creations_touched,
                "completed": self.heroes_completed,
                "failed": self.heroes_failed,
                "in_progress": self.heroes_in_progress,
                "cost_of_completed_usd_micros": self.cost_of_completed_heroes_usd_micros,
                "cost_of_incomplete_usd_micros": self.cost_of_incomplete_heroes_usd_micros,
                "cost_per_successful_usd_micros": self.cost_per_successful_hero_usd_micros,
                "cost_per_successful_usd": (
                    pricing.micros_to_usd_str(self.cost_per_successful_hero_usd_micros)
                    if self.cost_per_successful_hero_usd_micros is not None else None
                ),
                "fully_loaded_cost_per_successful_usd_micros":
                    self.fully_loaded_cost_per_successful_hero_usd_micros,
                "fully_loaded_cost_per_successful_usd": (
                    pricing.micros_to_usd_str(self.fully_loaded_cost_per_successful_hero_usd_micros)
                    if self.fully_loaded_cost_per_successful_hero_usd_micros is not None else None
                ),
            },
            "free_tier": {
                "cost_usd_micros": self.free_tier_cost_usd_micros,
                "cost_usd": pricing.micros_to_usd_str(self.free_tier_cost_usd_micros),
                "users": self.free_tier_users,
                "heroes_completed": self.free_tier_heroes_completed,
                "paying_users": self.paying_users,
            },
            "price_table": self.price_table,
            "users": [u.as_dict() for u in self.users],
            "creations": [c.as_dict() for c in self.creations],
            "warnings": self.warnings,
        }


# ---------------------------------------------------------------------------
# Building the report
# ---------------------------------------------------------------------------

def _normalise_range(start: Optional[datetime], end: Optional[datetime]) -> tuple:
    """
    Default to the last 30 days. Naive UTC throughout, matching
    `datetime.utcnow()` used by every model default in app/models.py - mixing a
    tz-aware bound with naive stored values silently returns nothing on Postgres
    and raises on SQLite, so both bounds are forced naive here.
    """
    now = datetime.utcnow()
    end = end or now
    start = start or (end - timedelta(days=30))
    if start.tzinfo is not None:
        start = start.replace(tzinfo=None)
    if end.tzinfo is not None:
        end = end.replace(tzinfo=None)
    if start > end:
        start, end = end, start
    return start, end


def _creation_statuses(db: Session, creation_ids: List[str]) -> Dict[str, str]:
    """
    Resolve each creation's status.

    `Creation.status` is a Python property derived from its steps, not a column,
    so it cannot be filtered or grouped in SQL. Steps are loaded in one query
    and the property is evaluated in Python - correct, and one query rather than
    N.
    """
    if not creation_ids:
        return {}
    statuses: Dict[str, str] = {}
    CHUNK = 500  # keep well under SQLite's variable limit
    for i in range(0, len(creation_ids), CHUNK):
        chunk = creation_ids[i:i + CHUNK]
        creations = (
            db.query(Creation)
            .filter(Creation.id.in_(chunk))
            .all()
        )
        # Touch .steps so the property can evaluate; lazy="select" means one
        # query per creation here, which is acceptable for an admin report and
        # honest about what it costs.
        for c in creations:
            statuses[c.id] = c.status
    return statuses


def build_margin_report(
    db: Session,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    user_id: Optional[str] = None,
    max_rows: int = 500,
) -> MarginReport:
    """
    Build the margin report for [start, end].

    Args:
        user_id: restrict to one user. Totals are then that user's totals.
        max_rows: cap on the per-user and per-creation detail lists. Totals are
            always computed over EVERYTHING in range, never over the truncated
            list, so a capped report still adds up.
    """
    start, end = _normalise_range(start, end)
    warnings: List[str] = []

    # ---- usage events in range ------------------------------------------
    ev_q = db.query(UsageEvent).filter(
        UsageEvent.created_at >= start, UsageEvent.created_at <= end
    )
    if user_id:
        ev_q = ev_q.filter(UsageEvent.user_id == user_id)
    events = ev_q.all()

    cost_total = 0
    cost_by_provider: Dict[str, int] = {}
    cost_by_step: Dict[str, int] = {}
    failed_calls = 0
    unresolved_calls = 0
    unattributed_cost = 0

    per_creation: Dict[str, Dict[str, Any]] = {}
    per_user_cost: Dict[str, int] = {}

    for ev in events:
        cost = int(ev.cost_usd_micros or 0)
        cost_total += cost
        cost_by_provider[ev.provider] = cost_by_provider.get(ev.provider, 0) + cost
        step_key = ev.step_name or "(none)"
        cost_by_step[step_key] = cost_by_step.get(step_key, 0) + cost

        if ev.status == "failed":
            failed_calls += 1
        elif ev.status == "submitted":
            # Submitted and never resolved: we paid, and we never found out
            # whether we got anything. Worth surfacing, not worth hiding.
            unresolved_calls += 1

        if ev.user_id:
            per_user_cost[ev.user_id] = per_user_cost.get(ev.user_id, 0) + cost

        if not ev.creation_id:
            unattributed_cost += cost
            continue

        bucket = per_creation.setdefault(ev.creation_id, {
            "cost": 0, "calls": 0, "failed": 0,
            "by_provider": {}, "by_step": {}, "user_id": ev.user_id,
        })
        bucket["cost"] += cost
        bucket["calls"] += 1
        if ev.status == "failed":
            bucket["failed"] += 1
        bucket["by_provider"][ev.provider] = bucket["by_provider"].get(ev.provider, 0) + cost
        bucket["by_step"][step_key] = bucket["by_step"].get(step_key, 0) + 1
        if ev.user_id and not bucket["user_id"]:
            bucket["user_id"] = ev.user_id

    # ---- credits spent per creation (for cross-checking against cost) ----
    cs_q = db.query(
        CreditTransaction.creation_id,
        func.coalesce(func.sum(CreditTransaction.delta), 0),
    ).filter(
        CreditTransaction.reason == "spend",
        CreditTransaction.created_at >= start,
        CreditTransaction.created_at <= end,
    ).group_by(CreditTransaction.creation_id)
    if user_id:
        cs_q = cs_q.filter(CreditTransaction.user_id == user_id)
    credits_spent_by_creation = {
        cid: abs(int(total or 0)) for cid, total in cs_q.all() if cid
    }

    cu_q = db.query(
        CreditTransaction.user_id,
        func.coalesce(func.sum(CreditTransaction.delta), 0),
    ).filter(
        CreditTransaction.reason == "spend",
        CreditTransaction.created_at >= start,
        CreditTransaction.created_at <= end,
    ).group_by(CreditTransaction.user_id)
    if user_id:
        cu_q = cu_q.filter(CreditTransaction.user_id == user_id)
    credits_spent_by_user = {uid: abs(int(t or 0)) for uid, t in cu_q.all() if uid}

    # ---- revenue ---------------------------------------------------------
    pay_q = db.query(Payment).filter(
        Payment.created_at >= start, Payment.created_at <= end
    )
    if user_id:
        pay_q = pay_q.filter(Payment.user_id == user_id)
    payments = pay_q.all()

    rev_gross = rev_fee = rev_net = refunds_net = 0
    payment_count = 0
    per_user_revenue: Dict[str, Dict[str, int]] = {}

    for pay in payments:
        bucket = per_user_revenue.setdefault(
            pay.user_id, {"gross": 0, "fee": 0, "net": 0}
        )
        if pay.status in REVENUE_STATUSES:
            payment_count += 1
            rev_gross += int(pay.gross_usd_micros or 0)
            rev_fee += int(pay.fee_usd_micros or 0)
            rev_net += int(pay.net_usd_micros or 0)
            bucket["gross"] += int(pay.gross_usd_micros or 0)
            bucket["fee"] += int(pay.fee_usd_micros or 0)
            bucket["net"] += int(pay.net_usd_micros or 0)
        elif pay.status in REFUND_STATUSES:
            refunds_net += int(pay.net_usd_micros or 0)
            bucket["net"] -= int(pay.net_usd_micros or 0)
            bucket["gross"] -= int(pay.gross_usd_micros or 0)

    rev_net_after_refunds = rev_net - refunds_net
    rev_gross_after_refunds = rev_gross

    if not payments:
        warnings.append(
            "No rows in `payments` for this range. Revenue is zero and every "
            "margin below is negative by exactly the cost. The payments table "
            "exists and this report reads it; it will show real revenue as soon "
            "as the payments integration starts inserting rows."
        )

    # ---- who has ever paid anything -------------------------------------
    # Note: "ever", not "in this range". A customer who paid last month and
    # burnt money this month is not a free-tier user.
    paying_user_ids = {
        uid for (uid,) in db.query(Payment.user_id)
        .filter(Payment.status.in_(REVENUE_STATUSES))
        .distinct().all()
    }

    # ---- creation statuses ----------------------------------------------
    creation_ids = list(per_creation.keys())
    statuses = _creation_statuses(db, creation_ids)

    heroes_completed = heroes_failed = heroes_in_progress = 0
    cost_completed = cost_incomplete = 0
    per_user_heroes: Dict[str, Dict[str, int]] = {}

    for cid, bucket in per_creation.items():
        st = statuses.get(cid, "unknown")
        uid = bucket["user_id"]
        ub = per_user_heroes.setdefault(uid or "(unattributed)", {"completed": 0, "failed": 0, "touched": 0})
        ub["touched"] += 1
        if st == "completed":
            heroes_completed += 1
            cost_completed += bucket["cost"]
            ub["completed"] += 1
        else:
            cost_incomplete += bucket["cost"]
            if st == "failed":
                heroes_failed += 1
                ub["failed"] += 1
            else:
                heroes_in_progress += 1

    cost_per_success = (cost_completed // heroes_completed) if heroes_completed else None
    fully_loaded = (cost_total // heroes_completed) if heroes_completed else None

    # ---- free tier -------------------------------------------------------
    free_tier_cost = sum(
        cost for uid, cost in per_user_cost.items() if uid not in paying_user_ids
    )
    free_tier_users = len([uid for uid in per_user_cost if uid not in paying_user_ids])
    free_tier_heroes = sum(
        h["completed"] for uid, h in per_user_heroes.items()
        if uid not in paying_user_ids
    )

    # ---- per-user rows ---------------------------------------------------
    user_ids = set(per_user_cost) | set(per_user_revenue) | set(credits_spent_by_user)
    user_ids.discard(None)
    users_by_id = {}
    if user_ids:
        ids = list(user_ids)
        for i in range(0, len(ids), 500):
            for u in db.query(User).filter(User.id.in_(ids[i:i + 500])).all():
                users_by_id[u.id] = u

    user_rows: List[UserRow] = []
    for uid in user_ids:
        u = users_by_id.get(uid)
        rev = per_user_revenue.get(uid, {"gross": 0, "fee": 0, "net": 0})
        cost = per_user_cost.get(uid, 0)
        heroes = per_user_heroes.get(uid, {"completed": 0, "failed": 0, "touched": 0})
        completed = heroes["completed"]
        user_rows.append(UserRow(
            user_id=uid,
            username=u.username if u else None,
            is_paying=uid in paying_user_ids,
            created_at=u.created_at if u else None,
            revenue_gross_usd_micros=rev["gross"],
            revenue_fee_usd_micros=rev["fee"],
            revenue_net_usd_micros=rev["net"],
            cost_usd_micros=cost,
            margin_usd_micros=rev["net"] - cost,
            creations_touched=heroes["touched"],
            heroes_completed=completed,
            heroes_failed=heroes["failed"],
            cost_per_completed_hero_usd_micros=(cost // completed) if completed else None,
            credits_balance=int(u.credits or 0) if u else 0,
            credits_spent=credits_spent_by_user.get(uid, 0),
        ))
    user_rows.sort(key=lambda r: r.cost_usd_micros, reverse=True)

    # ---- per-creation rows ----------------------------------------------
    # `retried_calls` = calls beyond one per distinct step. A step that ran
    # three times contributes 2 retries. That is the number that turns "the
    # hero cost $0.57" into "the hero cost $1.14 because openai_render ran
    # twice and meshy_3d ran twice".
    creation_rows: List[CreationRow] = []
    for cid, bucket in per_creation.items():
        by_step = bucket["by_step"]
        retried = sum(max(0, n - 1) for n in by_step.values())
        u = users_by_id.get(bucket["user_id"])
        creation_rows.append(CreationRow(
            creation_id=cid,
            user_id=bucket["user_id"],
            username=u.username if u else None,
            status=statuses.get(cid, "unknown"),
            created_at=None,
            cost_usd_micros=bucket["cost"],
            calls=bucket["calls"],
            failed_calls=bucket["failed"],
            retried_calls=retried,
            credits_spent=credits_spent_by_creation.get(cid, 0),
            cost_by_provider=bucket["by_provider"],
        ))
    creation_rows.sort(key=lambda r: r.cost_usd_micros, reverse=True)

    if len(user_rows) > max_rows:
        warnings.append(
            f"Per-user detail truncated to {max_rows} of {len(user_rows)} rows. "
            "Totals above are computed over all rows."
        )
        user_rows = user_rows[:max_rows]
    if len(creation_rows) > max_rows:
        warnings.append(
            f"Per-creation detail truncated to {max_rows} of {len(creation_rows)} "
            "rows. Totals above are computed over all rows."
        )
        creation_rows = creation_rows[:max_rows]

    if unresolved_calls:
        warnings.append(
            f"{unresolved_calls} provider call(s) are still 'submitted': cost is "
            "booked but the outcome was never recorded (a crash or restart "
            "during polling). Cost is counted; treat the success rate as a "
            "lower bound."
        )
    if unattributed_cost:
        warnings.append(
            f"{pricing.micros_to_usd_str(unattributed_cost)} of cost has no "
            "creation_id and is excluded from per-hero figures."
        )

    margin = rev_net_after_refunds - cost_total
    margin_pct = (
        round(100.0 * margin / rev_net_after_refunds, 2)
        if rev_net_after_refunds else None
    )

    return MarginReport(
        generated_at=datetime.utcnow(),
        start=start,
        end=end,
        revenue_gross_usd_micros=rev_gross_after_refunds,
        revenue_fee_usd_micros=rev_fee,
        revenue_net_usd_micros=rev_net_after_refunds,
        refunds_net_usd_micros=refunds_net,
        payment_count=payment_count,
        cost_usd_micros=cost_total,
        cost_by_provider=cost_by_provider,
        cost_by_step=cost_by_step,
        call_count=len(events),
        failed_call_count=failed_calls,
        unresolved_call_count=unresolved_calls,
        unattributed_cost_usd_micros=unattributed_cost,
        gross_margin_usd_micros=margin,
        gross_margin_pct=margin_pct,
        creations_touched=len(per_creation),
        heroes_completed=heroes_completed,
        heroes_failed=heroes_failed,
        heroes_in_progress=heroes_in_progress,
        cost_of_completed_heroes_usd_micros=cost_completed,
        cost_of_incomplete_heroes_usd_micros=cost_incomplete,
        cost_per_successful_hero_usd_micros=cost_per_success,
        fully_loaded_cost_per_successful_hero_usd_micros=fully_loaded,
        free_tier_cost_usd_micros=free_tier_cost,
        free_tier_users=free_tier_users,
        free_tier_heroes_completed=free_tier_heroes,
        paying_users=len(paying_user_ids),
        price_table=pricing.price_table_snapshot(),
        users=user_rows,
        creations=creation_rows,
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# Plain-text rendering (scripts, logs, the seed demo)
# ---------------------------------------------------------------------------

def render_text(report: MarginReport) -> str:
    """Render the report as monospaced text. Used by scripts/seed_demo.py."""
    m = pricing.micros_to_usd_str
    lines: List[str] = []
    w = lines.append

    w("=" * 78)
    w("HEROMAKER MARGIN REPORT")
    w(f"range   : {report.start:%Y-%m-%d %H:%M} .. {report.end:%Y-%m-%d %H:%M} UTC")
    w(f"built   : {report.generated_at:%Y-%m-%d %H:%M:%S} UTC")
    w(f"prices  : checked {report.price_table['last_checked']} | "
      f"meshy ${report.price_table['meshy_usd_micros_per_credit'] / 1_000_000:.4f}/credit")
    w("=" * 78)
    w("")
    w("P&L")
    w("-" * 78)
    w(f"  revenue (gross)            {m(report.revenue_gross_usd_micros):>14}")
    w(f"  payment provider fees      {m(-report.revenue_fee_usd_micros):>14}")
    w(f"  refunds                    {m(-report.refunds_net_usd_micros):>14}")
    w(f"  revenue (net)              {m(report.revenue_net_usd_micros):>14}   "
      f"{report.payment_count} payment(s)")
    w(f"  provider cost              {m(-report.cost_usd_micros):>14}   "
      f"{report.call_count} call(s), {report.failed_call_count} failed")
    for prov, cost in sorted(report.cost_by_provider.items(), key=lambda kv: -kv[1]):
        w(f"      {prov:<22} {m(-cost):>14}")
    w(f"  {'GROSS MARGIN':<26} {m(report.gross_margin_usd_micros):>14}   "
      f"{('n/a' if report.gross_margin_pct is None else str(report.gross_margin_pct) + '%')}")
    w("")
    w("UNIT ECONOMICS")
    w("-" * 78)
    w(f"  heroes completed                     {report.heroes_completed}")
    w(f"  heroes failed                        {report.heroes_failed}")
    w(f"  heroes in progress                   {report.heroes_in_progress}")
    w(f"  cost of completed heroes             {m(report.cost_of_completed_heroes_usd_micros):>14}")
    w(f"  cost burnt on incomplete heroes      {m(report.cost_of_incomplete_heroes_usd_micros):>14}")
    w(f"  COST PER SUCCESSFUL HERO             "
      f"{(m(report.cost_per_successful_hero_usd_micros) if report.cost_per_successful_hero_usd_micros is not None else 'n/a'):>14}"
      "   (incl. that hero's own failures/retries)")
    w(f"  FULLY LOADED PER SUCCESSFUL HERO     "
      f"{(m(report.fully_loaded_cost_per_successful_hero_usd_micros) if report.fully_loaded_cost_per_successful_hero_usd_micros is not None else 'n/a'):>14}"
      "   (all spend / heroes delivered)")
    w("")
    w("COST OF THE FREE TIER")
    w("-" * 78)
    w(f"  spent by users who have never paid   {m(report.free_tier_cost_usd_micros):>14}")
    w(f"  free-tier users active in range      {report.free_tier_users}")
    w(f"  heroes delivered to them             {report.free_tier_heroes_completed}")
    w(f"  paying users (all time)              {report.paying_users}")
    w("")
    w("COST BY STEP")
    w("-" * 78)
    for step, cost in sorted(report.cost_by_step.items(), key=lambda kv: -kv[1]):
        w(f"  {step:<24} {m(cost):>14}")
    w("")
    w("PER USER")
    w("-" * 78)
    w(f"  {'user':<20} {'paid':>4} {'revenue':>11} {'cost':>11} {'margin':>11} "
      f"{'heroes':>7} {'$/hero':>10}")
    for u in report.users:
        w(f"  {(u.username or u.user_id)[:20]:<20} "
          f"{('yes' if u.is_paying else 'no'):>4} "
          f"{m(u.revenue_net_usd_micros):>11} "
          f"{m(u.cost_usd_micros):>11} "
          f"{m(u.margin_usd_micros):>11} "
          f"{u.heroes_completed:>7} "
          f"{(m(u.cost_per_completed_hero_usd_micros) if u.cost_per_completed_hero_usd_micros is not None else '-'):>10}")
    w("")
    w("PER CREATION")
    w("-" * 78)
    w(f"  {'creation':<14} {'user':<14} {'status':<11} {'cost':>10} "
      f"{'calls':>6} {'fail':>5} {'retry':>6} {'credits':>8}")
    for c in report.creations:
        w(f"  {c.creation_id[:14]:<14} {(c.username or c.user_id or '-')[:14]:<14} "
          f"{c.status:<11} {m(c.cost_usd_micros):>10} {c.calls:>6} "
          f"{c.failed_calls:>5} {c.retried_calls:>6} {c.credits_spent:>8}")
    if report.warnings:
        w("")
        w("NOTES")
        w("-" * 78)
        for warning in report.warnings:
            w(f"  ! {warning}")
    w("=" * 78)
    return "\n".join(lines)
