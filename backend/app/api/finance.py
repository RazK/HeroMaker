"""
Admin finance API: the margin report, plus the ledger's audit views.

Mounted under /api/admin/finance by app/api/admin.py. Every route here is
admin-only.

AUTHENTICATION NOTE
-------------------
The JSON routes use the normal `require_admin` dependency (HTTP Bearer). The
HTML route cannot: a browser following a link does not send an Authorization
header. It therefore also accepts the same JWT as a `?token=` query parameter.

That is a real, if small, trade-off - tokens in query strings end up in server
logs, browser history and Referer headers - so it is opt-in per request, the
token is never echoed back into the page, and the page is served with
`Cache-Control: no-store` and `Referrer-Policy: no-referrer`. If the admin panel
grows a session cookie, delete `_admin_from_query_token` and use it instead.
"""
import html as html_lib
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import HTMLResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import pricing
from app.database import get_db
from app.models import User
from app.services import ledger, reporting
from app.services.auth import verify_access_token

router = APIRouter()

_bearer = HTTPBearer(auto_error=False)


def require_admin(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    """Admin-only dependency for the JSON routes."""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = _user_from_token(credentials.credentials, db)
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


def _user_from_token(token: str, db: Session) -> User:
    user_id = verify_access_token(token)
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def require_admin_html(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    token: Optional[str] = Query(
        None,
        description="JWT, for opening this page directly in a browser. See module docstring.",
    ),
    db: Session = Depends(get_db),
) -> User:
    """Admin-only dependency that also accepts `?token=` - browsers only."""
    raw = credentials.credentials if credentials else token
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required (Authorization: Bearer <jwt>, or ?token=<jwt>)",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = _user_from_token(raw, db)
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


def _parse_range(start: Optional[str], end: Optional[str], days: int) -> tuple:
    """Accept ISO dates or datetimes; default to the last `days` days."""
    def parse(value: Optional[str], end_of_day: bool) -> Optional[datetime]:
        if not value:
            return None
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid date {value!r}; use YYYY-MM-DD or an ISO 8601 datetime",
            )
        # A bare date as the END of a range means "the whole of that day",
        # otherwise `?end=2026-09-16` silently drops everything that happened
        # on the 16th - an off-by-one-day that quietly understates cost.
        if end_of_day and len(value) == 10:
            parsed = parsed + timedelta(days=1) - timedelta(microseconds=1)
        return parsed

    start_dt = parse(start, end_of_day=False)
    end_dt = parse(end, end_of_day=True)
    if start_dt is None and end_dt is None:
        end_dt = datetime.utcnow()
        start_dt = end_dt - timedelta(days=days)
    return start_dt, end_dt


# ---------------------------------------------------------------------------
# JSON
# ---------------------------------------------------------------------------

@router.get("/margin")
def margin_report(
    start: Optional[str] = Query(None, description="ISO date/datetime, inclusive"),
    end: Optional[str] = Query(None, description="ISO date/datetime, inclusive"),
    days: int = Query(30, ge=1, le=3650, description="Range length when start/end omitted"),
    user_id: Optional[str] = Query(None, description="Restrict to one user"),
    max_rows: int = Query(500, ge=1, le=5000),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Revenue, cost and gross margin over a date range - overall, per user, per creation."""
    start_dt, end_dt = _parse_range(start, end, days)
    report = reporting.build_margin_report(
        db, start=start_dt, end=end_dt, user_id=user_id, max_rows=max_rows
    )
    return report.as_dict()


@router.get("/prices")
def price_table(admin: User = Depends(require_admin)):
    """The price table the report is using, and when its numbers were checked."""
    return pricing.price_table_snapshot()


@router.get("/ledger/{user_id}")
def user_ledger(
    user_id: str,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    One user's credit ledger: the answer to "why do I have N credits".
    """
    check = ledger.verify_user_balance(user_id, db)
    txs = ledger.list_transactions(user_id, db, limit=limit, offset=offset)
    return {
        "user_id": user_id,
        "balance": check.as_dict(),
        "transactions": [
            {
                "id": t.id,
                "delta": t.delta,
                "reason": t.reason,
                "external_ref": t.external_ref,
                "creation_id": t.creation_id,
                "balance_after": t.balance_after,
                "metadata": t.metadata_json or {},
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in txs
        ],
    }


@router.get("/ledger-consistency")
def ledger_consistency(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    The invariant check: for every user, users.credits == SUM(ledger.delta).

    A non-empty `drifted` list means something wrote a credit balance without
    going through app/services/ledger.py. Cheap enough to poll.
    """
    checks = ledger.verify_all_balances(db)
    drifted = [c for c in checks if not c.consistent]
    return {
        "checked": len(checks),
        "consistent": len(checks) - len(drifted),
        "drifted": [c.as_dict() for c in drifted],
        "ok": not drifted,
    }


# ---------------------------------------------------------------------------
# HTML
# ---------------------------------------------------------------------------

_STYLE = """
:root {
  --bg:#ffffff; --fg:#14161a; --muted:#5d6570; --line:#e3e6ea;
  --pos:#0a7d43; --neg:#b3261e; --chip:#f3f5f7; --accent:#1f4fd8;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg:#101114; --fg:#e8eaed; --muted:#98a0ab; --line:#272a30;
    --pos:#4ade80; --neg:#ff8a80; --chip:#1a1c21; --accent:#8ab0ff;
  }
}
* { box-sizing:border-box; }
body { margin:0; padding:24px 16px 64px; background:var(--bg); color:var(--fg);
  font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
.wrap { max-width:1140px; margin:0 auto; }
h1 { font-size:22px; margin:0 0 4px; letter-spacing:-.01em; }
h2 { font-size:13px; text-transform:uppercase; letter-spacing:.08em;
  color:var(--muted); margin:36px 0 12px; font-weight:600; }
.sub { color:var(--muted); margin:0 0 24px; font-size:13px; }
form { display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end; margin:0 0 8px; }
label { display:flex; flex-direction:column; gap:4px; font-size:12px; color:var(--muted); }
input { background:var(--chip); color:var(--fg); border:1px solid var(--line);
  border-radius:6px; padding:7px 9px; font:inherit; font-size:13px; }
button { background:var(--accent); color:#fff; border:0; border-radius:6px;
  padding:8px 16px; font:inherit; font-weight:600; cursor:pointer; }
.cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:12px; }
.card { border:1px solid var(--line); border-radius:10px; padding:14px 16px; background:var(--chip); }
.card .k { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
.card .v { font-size:23px; font-weight:650; margin-top:6px;
  font-variant-numeric:tabular-nums; letter-spacing:-.02em; }
.card .n { font-size:12px; color:var(--muted); margin-top:4px; }
.pos { color:var(--pos); } .neg { color:var(--neg); }
table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
th,td { text-align:right; padding:7px 10px; border-bottom:1px solid var(--line); white-space:nowrap; }
th:first-child,td:first-child,th.l,td.l { text-align:left; }
th { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); font-weight:600; }
tbody tr:hover { background:var(--chip); }
.scroll { overflow-x:auto; border:1px solid var(--line); border-radius:10px; }
.note { border-left:3px solid var(--neg); background:var(--chip); padding:10px 14px;
  border-radius:0 6px 6px 0; margin:8px 0; color:var(--muted); font-size:13px; }
code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
.mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
"""


def _esc(value) -> str:
    return html_lib.escape(str(value if value is not None else "-"))


def _money(micros: Optional[int], places: int = 2) -> str:
    if micros is None:
        return "-"
    return pricing.micros_to_usd_str(micros, places=places)


def _signed(micros: int) -> str:
    cls = "pos" if micros >= 0 else "neg"
    return f'<span class="{cls}">{_esc(_money(micros))}</span>'


@router.get("/margin.html", response_class=HTMLResponse)
def margin_report_html(
    response: Response,
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    days: int = Query(30, ge=1, le=3650),
    user_id: Optional[str] = Query(None),
    max_rows: int = Query(200, ge=1, le=5000),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin_html),
):
    """Server-rendered margin report. No JS, no build step, no dependencies."""
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"

    start_dt, end_dt = _parse_range(start, end, days)
    r = reporting.build_margin_report(
        db, start=start_dt, end=end_dt, user_id=user_id, max_rows=max_rows
    )

    cps = r.cost_per_successful_hero_usd_micros
    fully = r.fully_loaded_cost_per_successful_hero_usd_micros

    cards = [
        ("Revenue (net)", _money(r.revenue_net_usd_micros),
         f"{r.payment_count} payment(s), after fees"),
        ("Provider cost", _money(r.cost_usd_micros),
         f"{r.call_count} call(s), {r.failed_call_count} failed"),
        ("Gross margin", _signed(r.gross_margin_usd_micros),
         "n/a" if r.gross_margin_pct is None else f"{r.gross_margin_pct}% of net revenue"),
        ("Cost per successful hero", _money(cps, 4) if cps is not None else "-",
         f"{r.heroes_completed} delivered, incl. their own retries"),
        ("Fully loaded per hero", _money(fully, 4) if fully is not None else "-",
         "all spend in range / heroes delivered"),
        ("Cost of free tier", _money(r.free_tier_cost_usd_micros),
         f"{r.free_tier_users} never-paid user(s), {r.free_tier_heroes_completed} hero(es)"),
    ]
    cards_html = "".join(
        f'<div class="card"><div class="k">{_esc(k)}</div>'
        f'<div class="v">{v}</div><div class="n">{_esc(n)}</div></div>'
        for k, v, n in cards
    )

    provider_rows = "".join(
        f"<tr><td class='l'>{_esc(p)}</td><td>{_esc(_money(c, 4))}</td></tr>"
        for p, c in sorted(r.cost_by_provider.items(), key=lambda kv: -kv[1])
    ) or "<tr><td class='l' colspan='2'>no provider calls in range</td></tr>"

    step_rows = "".join(
        f"<tr><td class='l'>{_esc(s)}</td><td>{_esc(_money(c, 4))}</td></tr>"
        for s, c in sorted(r.cost_by_step.items(), key=lambda kv: -kv[1])
    ) or "<tr><td class='l' colspan='2'>no provider calls in range</td></tr>"

    user_rows = "".join(
        "<tr>"
        f"<td class='l'>{_esc(u.username or u.user_id)}</td>"
        f"<td class='l'>{'yes' if u.is_paying else 'no'}</td>"
        f"<td>{_esc(_money(u.revenue_net_usd_micros))}</td>"
        f"<td>{_esc(_money(u.cost_usd_micros, 4))}</td>"
        f"<td>{_signed(u.margin_usd_micros)}</td>"
        f"<td>{u.heroes_completed}</td>"
        f"<td>{u.heroes_failed}</td>"
        f"<td>{_esc(_money(u.cost_per_completed_hero_usd_micros, 4))}</td>"
        f"<td>{u.credits_spent}</td>"
        f"<td>{u.credits_balance}</td>"
        "</tr>"
        for u in r.users
    ) or "<tr><td class='l' colspan='10'>no activity in range</td></tr>"

    creation_rows = "".join(
        "<tr>"
        f"<td class='l mono'>{_esc(c.creation_id)}</td>"
        f"<td class='l'>{_esc(c.username or c.user_id)}</td>"
        f"<td class='l'>{_esc(c.status)}</td>"
        f"<td>{_esc(_money(c.cost_usd_micros, 4))}</td>"
        f"<td>{c.calls}</td>"
        f"<td>{c.failed_calls}</td>"
        f"<td>{c.retried_calls}</td>"
        f"<td>{c.credits_spent}</td>"
        "</tr>"
        for c in r.creations
    ) or "<tr><td class='l' colspan='8'>no creations with cost in range</td></tr>"

    notes = "".join(f'<div class="note">{_esc(n)}</div>' for n in r.warnings)

    pt = r.price_table
    price_note = (
        f"Prices last checked {_esc(pt['last_checked'])}: "
        f"OpenAI image {_esc(_money(pt['openai_image_usd_micros'], 4))}, "
        f"Meshy image-to-3D {_esc(pt['meshy_image_to_3d_credits'])} credits = "
        f"{_esc(_money(pt['meshy_image_to_3d_usd_micros'], 4))}, "
        f"Meshy rig {_esc(_money(pt['meshy_rig_usd_micros'], 4))}, "
        f"VRM convert {_esc(_money(pt['vrm_conversion_usd_micros'], 4))}. "
        f"Failed calls billed: {'yes' if pt['bill_failed_calls'] else 'no'}."
    )

    return f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Margin report</title>
<style>{_STYLE}</style>
</head><body><div class="wrap">
<h1>Margin report</h1>
<p class="sub">{r.start:%Y-%m-%d %H:%M} &rarr; {r.end:%Y-%m-%d %H:%M} UTC
&middot; built {r.generated_at:%Y-%m-%d %H:%M:%S} UTC
{f'&middot; user {_esc(user_id)}' if user_id else ''}</p>

<form method="get">
  <label>From<input type="date" name="start" value="{_esc(r.start.date())}"></label>
  <label>To<input type="date" name="end" value="{_esc(r.end.date())}"></label>
  <label>User id<input type="text" name="user_id" value="{_esc(user_id or '')}" placeholder="all users"></label>
  <button type="submit">Apply</button>
</form>
<p class="sub">Keep <code>?token=</code> in the address bar when reloading by hand.</p>

<div class="cards">{cards_html}</div>

{notes}

<h2>Cost by provider</h2>
<div class="scroll"><table>
<thead><tr><th class="l">Provider</th><th>Cost</th></tr></thead>
<tbody>{provider_rows}</tbody></table></div>

<h2>Cost by pipeline step</h2>
<div class="scroll"><table>
<thead><tr><th class="l">Step</th><th>Cost</th></tr></thead>
<tbody>{step_rows}</tbody></table></div>

<h2>Per user</h2>
<div class="scroll"><table>
<thead><tr>
<th class="l">User</th><th class="l">Paid?</th><th>Revenue (net)</th><th>Cost</th>
<th>Margin</th><th>Heroes</th><th>Failed</th><th>$/hero</th>
<th>Credits spent</th><th>Balance</th>
</tr></thead>
<tbody>{user_rows}</tbody></table></div>

<h2>Per creation</h2>
<div class="scroll"><table>
<thead><tr>
<th class="l">Creation</th><th class="l">User</th><th class="l">Status</th>
<th>Cost</th><th>Calls</th><th>Failed</th><th>Retries</th><th>Credits</th>
</tr></thead>
<tbody>{creation_rows}</tbody></table></div>

<h2>Prices used</h2>
<p class="sub">{price_note}</p>
</div></body></html>"""
