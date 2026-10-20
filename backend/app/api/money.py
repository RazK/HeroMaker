"""
Admin console, Money section: is the company net positive?

Mounted under /api/admin/money by app/api/admin.py. Admin-only, every route.

    GET    /summary?period=month|30d|all   income, costs, net, credits held
    GET    /providers[?refresh=1]          live Meshy / OpenAI / Railway figures
    GET    /lemonsqueezy[?refresh=1]       Lemon Squeezy's orders vs our payments
    GET    /recurring                      the monthly bills
    POST   /recurring                      add one
    PATCH  /recurring/{id}                 change one
    DELETE /recurring/{id}                 remove one

What each number is computed from: app/services/company_finance.py and
app/services/provider_balances.py and app/services/lemonsqueezy_check.py.
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.finance import require_admin
from app.config import pricing
from app.database import get_db
from app.models import RecurringExpense, User
from app.services import company_finance, lemonsqueezy_check, provider_balances

router = APIRouter()

# A bill bigger than this is a typo (an extra zero), not a bill.
MAX_MONTHLY_USD = 100_000


@router.get("/summary")
def money_summary(
    period: str = Query("month", pattern="^(month|30d|all)$"),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    return company_finance.build_summary(db, period)


@router.get("/providers")
def provider_status(
    refresh: bool = Query(False, description="Ask every provider now, ignoring the cache"),
    admin: User = Depends(require_admin),
):
    return {"providers": provider_balances.get_all(refresh=refresh)}


@router.get("/lemonsqueezy")
def lemonsqueezy_cross_check(
    refresh: bool = Query(False, description="Ask Lemon Squeezy now, ignoring the cache"),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Lemon Squeezy's last 30 days of orders beside our payment rows: a missed webhook shows here."""
    return lemonsqueezy_check.get_check(db, refresh=refresh)


class RecurringIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    amount_usd: float = Field(..., gt=0, le=MAX_MONTHLY_USD)
    started_on: Optional[date] = None


class RecurringPatch(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    amount_usd: Optional[float] = Field(None, gt=0, le=MAX_MONTHLY_USD)
    started_on: Optional[date] = None
    is_active: Optional[bool] = None


def _micros(amount_usd: float) -> int:
    return int(round(amount_usd * pricing.USD_MICROS))


@router.get("/recurring")
def list_recurring(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    rows = db.query(RecurringExpense).order_by(RecurringExpense.created_at).all()
    return [company_finance.expense_as_dict(r) for r in rows]


@router.post("/recurring", status_code=status.HTTP_201_CREATED)
def create_recurring(body: RecurringIn, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    row = RecurringExpense(
        name=body.name.strip(),
        amount_usd_micros=_micros(body.amount_usd),
        started_on=body.started_on or date.today(),
        is_active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return company_finance.expense_as_dict(row)


def _get_or_404(db: Session, expense_id: str) -> RecurringExpense:
    row = db.query(RecurringExpense).filter(RecurringExpense.id == expense_id).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense not found")
    return row


@router.patch("/recurring/{expense_id}")
def update_recurring(
    expense_id: str, body: RecurringPatch,
    db: Session = Depends(get_db), admin: User = Depends(require_admin),
):
    row = _get_or_404(db, expense_id)
    if body.name is not None:
        row.name = body.name.strip()
    if body.amount_usd is not None:
        row.amount_usd_micros = _micros(body.amount_usd)
    if body.started_on is not None:
        row.started_on = body.started_on
    if body.is_active is not None:
        row.is_active = body.is_active
    db.commit()
    db.refresh(row)
    return company_finance.expense_as_dict(row)


@router.delete("/recurring/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recurring(expense_id: str, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    row = _get_or_404(db, expense_id)
    db.delete(row)
    db.commit()
