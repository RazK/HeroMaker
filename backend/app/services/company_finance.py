"""
The company's money at a glance: income, costs, net, and what is still owed.

Read by the admin console's Money section (GET /api/admin/money/summary). Every
figure comes from a table we already write; nothing is estimated here that is
not labelled as such in the response.

    income           payments, status "succeeded", written by the Lemon Squeezy
                     webhook (app/api/payments.py). Split by the order's own
                     test_mode flag: test orders are shown but never counted in
                     net. `fee` is our estimate of Lemon Squeezy's cut from its
                     published rate (metadata.fee_is_estimated), not a settled
                     payout figure.
    refunds          payments with status "refunded" (live only), subtracted.
    provider costs   usage_events, one row per paid provider call including the
                     failures and retries. Priced from app/config/pricing.py
                     at the time of the call - the list price, not an invoice.
    recurring        recurring_expenses: each active bill charged once a month
                     on its start date's day of the month.
    net              live net income - refunds - provider costs - recurring.
    credits held     SUM(users.credits) over live accounts: credits sold or
                     given that we still have to deliver. Valued at what one
                     credit costs us to serve (app/config/packs.py).

All money is integer USD micros.
"""
import calendar
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import packs as packs_config
from app.config import pricing
from app.models import Payment, RecurringExpense, UsageEvent, User

PERIODS = ("month", "30d", "all")

# How far ahead "upcoming" bills look.
UPCOMING_DAYS = 30


def period_bounds(period: str, now: Optional[datetime] = None) -> Tuple[Optional[datetime], datetime]:
    """[start, end] for a period name. start is None for all time. Naive UTC."""
    now = now or datetime.utcnow()
    if period == "month":
        return datetime(now.year, now.month, 1), now
    if period == "30d":
        return now - timedelta(days=30), now
    if period == "all":
        return None, now
    raise ValueError(f"Unknown period {period!r}; expected one of {PERIODS}")


def _add_months(d: date, months: int) -> date:
    """d plus n months, the day clamped to the month's length (Jan 31 -> Feb 28)."""
    total = d.month - 1 + months
    year, month = d.year + total // 12, total % 12 + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def charge_dates(expense: RecurringExpense, start: date, end: date) -> List[date]:
    """Every date this bill falls on within [start, end], inclusive."""
    first = expense.started_on
    if first > end:
        return []
    out: List[date] = []
    # Skip whole months up to the window cheaply, then walk.
    k = 0
    if first < start:
        k = max(0, (start.year - first.year) * 12 + (start.month - first.month) - 1)
    while True:
        d = _add_months(first, k)
        if d > end:
            break
        if d >= start:
            out.append(d)
        k += 1
    return out


def next_charge(expense: RecurringExpense, today: date) -> date:
    """The first date on or after today this bill falls on."""
    if expense.started_on >= today:
        return expense.started_on
    # A monthly bill always falls within the next 31 days.
    return charge_dates(expense, today, today + timedelta(days=31))[0]


def expense_as_dict(e: RecurringExpense, today: Optional[date] = None) -> Dict[str, Any]:
    today = today or datetime.utcnow().date()
    return {
        "id": e.id,
        "name": e.name,
        "amount_usd_micros": int(e.amount_usd_micros),
        "started_on": e.started_on.isoformat(),
        "is_active": bool(e.is_active),
        "next_charge_on": next_charge(e, today).isoformat() if e.is_active else None,
    }


@dataclass
class _Income:
    gross: int = 0
    fee: int = 0
    net: int = 0
    count: int = 0

    def add(self, p: Payment) -> None:
        self.gross += int(p.gross_usd_micros or 0)
        self.fee += int(p.fee_usd_micros or 0)
        self.net += int(p.net_usd_micros or 0)
        self.count += 1

    def as_dict(self) -> Dict[str, int]:
        return {
            "gross_usd_micros": self.gross,
            "fee_usd_micros": self.fee,
            "net_usd_micros": self.net,
            "count": self.count,
        }


def _is_test(p: Payment) -> bool:
    meta = p.metadata_json or {}
    return bool(meta.get("test_mode", False))


def build_summary(db: Session, period: str, now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or datetime.utcnow()
    start, end = period_bounds(period, now)

    # ---- income -----------------------------------------------------------
    pay_q = db.query(Payment).filter(Payment.created_at <= end)
    if start is not None:
        pay_q = pay_q.filter(Payment.created_at >= start)
    live, test, refunded = _Income(), _Income(), _Income()
    for p in pay_q.all():
        if p.status == "succeeded":
            (test if _is_test(p) else live).add(p)
        elif p.status == "refunded" and not _is_test(p):
            refunded.add(p)

    # ---- provider costs ---------------------------------------------------
    ev_q = db.query(
        UsageEvent.provider,
        func.coalesce(func.sum(UsageEvent.cost_usd_micros), 0),
        func.count(UsageEvent.id),
    ).filter(UsageEvent.created_at <= end)
    if start is not None:
        ev_q = ev_q.filter(UsageEvent.created_at >= start)
    by_provider = [
        {"provider": provider, "cost_usd_micros": int(cost or 0), "calls": int(calls or 0)}
        for provider, cost, calls in ev_q.group_by(UsageEvent.provider).all()
    ]
    by_provider.sort(key=lambda r: -r["cost_usd_micros"])
    provider_total = sum(r["cost_usd_micros"] for r in by_provider)

    # ---- recurring --------------------------------------------------------
    expenses = db.query(RecurringExpense).order_by(RecurringExpense.created_at).all()
    active = [e for e in expenses if e.is_active]
    today = now.date()
    if start is None:
        window_start = min((e.started_on for e in active), default=today)
    else:
        window_start = start.date()
    recurring_in_period = 0
    for e in active:
        recurring_in_period += len(charge_dates(e, window_start, today)) * int(e.amount_usd_micros)
    monthly_total = sum(int(e.amount_usd_micros) for e in active)
    horizon = today + timedelta(days=UPCOMING_DAYS)
    upcoming = sorted(
        (
            {"id": e.id, "name": e.name, "amount_usd_micros": int(e.amount_usd_micros), "on": d.isoformat()}
            for e in active
            for d in charge_dates(e, today + timedelta(days=1), horizon)
        ),
        key=lambda r: r["on"],
    )

    # ---- credits still owed -----------------------------------------------
    held = db.query(func.coalesce(func.sum(User.credits), 0)).filter(
        User.deleted_at.is_(None), User.credits > 0
    ).scalar()
    held = int(held or 0)
    try:
        per_credit = packs_config.credit_cost_usd_micros()
    except Exception:  # a misconfigured price table must not take the page down
        per_credit = None

    costs_total = provider_total + recurring_in_period
    net = live.net - refunded.net - costs_total

    return {
        "period": period,
        "range": {"start": start.isoformat() if start else None, "end": end.isoformat()},
        "income": {
            "live": live.as_dict(),
            "test": test.as_dict(),
            "refunds": refunded.as_dict(),
            "fee_is_estimated": True,
        },
        "costs": {
            "providers": by_provider,
            "providers_total_usd_micros": provider_total,
            "recurring_usd_micros": recurring_in_period,
            "total_usd_micros": costs_total,
            "prices_last_checked": pricing.price_table_snapshot().get("last_checked"),
        },
        "net_usd_micros": net,
        "recurring": {
            "monthly_total_usd_micros": monthly_total,
            "items": [expense_as_dict(e, today) for e in expenses],
            "upcoming": upcoming,
            "upcoming_total_usd_micros": sum(u["amount_usd_micros"] for u in upcoming),
        },
        "credits_held": {
            "credits": held,
            "cost_per_credit_usd_micros": per_credit,
            "cost_to_serve_usd_micros": held * per_credit if per_credit is not None else None,
        },
    }
