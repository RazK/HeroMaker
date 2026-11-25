"""
A stand-in for Grow's Light API, for staging, until Grow issues our sandbox
userId and pageCode. Grow's sandbox (sandbox.meshulam.co.il) answers
"userId is not valid" to anyone without them.

It lets the REAL `grow` provider (app/services/grow.py) run end to end over
real HTTP, unchanged: point GROW_API_BASE at

    <site>/api/payments/grow-standin

and grow.py calls createPaymentProcess and approveTransaction here exactly as
it will call Grow. The hosted page here (TEST - no real money, Pay / Fail)
plays Grow's card page: Pay makes THIS server POST a Grow-shaped server update,
as form data, over HTTP, to the notifyUrl grow.py gave it, carrying the
processId and processToken it handed out. The notify endpoint verifies it like
any other (token, process pair, stored order, sum), and only then credits.

When Grow's identifiers arrive, GROW_API_BASE changes to Grow's sandbox and
this module is no longer called. Nothing else changes.

SAFETY: off unless GROW_STANDIN_ENABLED=1, and never in production
(RAILWAY_ENVIRONMENT_NAME=production), whatever the variable says. Off, every
route answers 404. It moves no money; it only says it did, to our own server,
whose verification it cannot skip.

Stateless: a process's facts travel in the page URL, signed with a key
derived from GROW_NOTIFY_SECRET, so a restart loses nothing and a buyer cannot
edit the sum or the notify address.
"""
import base64
import hashlib
import hmac
import html
import json
import logging
import os
import secrets
from datetime import datetime, timezone
from typing import Any, Dict
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import requests
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from app.config.settings import get_frontend_url
from app.services import grow

logger = logging.getLogger(__name__)

router = APIRouter()

PREFIX = "/api/payments/grow-standin"
PAGE_TITLE = "TEST checkout - no real money"


def enabled() -> bool:
    if os.getenv("RAILWAY_ENVIRONMENT_NAME", "").strip().lower() == "production":
        return False
    return os.getenv("GROW_STANDIN_ENABLED", "").strip().lower() in ("1", "true", "yes")


def _require():
    if not enabled() or not grow.notify_secret():
        raise HTTPException(status_code=404, detail="Not Found")


def _key() -> bytes:
    return hmac.new(grow.notify_secret().encode(), b"grow-standin", hashlib.sha256).digest()


def _sign(blob: str) -> str:
    return hmac.new(_key(), blob.encode(), hashlib.sha256).hexdigest()


def _pack(facts: Dict[str, Any]) -> str:
    return base64.urlsafe_b64encode(json.dumps(facts, separators=(",", ":")).encode()).decode().rstrip("=")


def _unpack(blob: str, sig: str) -> Dict[str, Any]:
    if not sig or not hmac.compare_digest(_sign(blob), sig):
        raise HTTPException(status_code=404, detail="Not Found")
    padded = blob + "=" * (-len(blob) % 4)
    return json.loads(base64.urlsafe_b64decode(padded))


def _fail(message: str, code: int = 701) -> JSONResponse:
    # Grow's error shape.
    return JSONResponse({"status": 0, "err": {"id": code, "message": message}, "data": ""})


def _with_param(url: str, key: str, value: str) -> str:
    parts = urlsplit(url)
    query = parse_qsl(parts.query, keep_blank_values=True) + [(key, value)]
    return urlunsplit(parts._replace(query=urlencode(query)))


@router.post("/api/light/server/1.0/createPaymentProcess")
async def create_payment_process(request: Request):
    _require()
    form = await request.form()
    f = {k: v for k, v in form.items() if isinstance(v, str)}
    if f.get("userId") != grow.user_id():
        return _fail("userId is not valid")
    if f.get("pageCode") != grow.page_code():
        return _fail("pageCode is not valid", 702)
    for need in ("sum", "notifyUrl", "successUrl"):
        if not f.get(need):
            return _fail(f"{need} is required", 703)
    process_id = str(secrets.randbelow(9_000_000) + 1_000_000)
    facts = {
        "pid": process_id,
        "ptok": secrets.token_hex(16),
        "sum": f["sum"],
        "desc": f.get("description", ""),
        "notify": f["notifyUrl"],
        "success": f["successUrl"],
        "cancel": f.get("cancelUrl") or f["successUrl"],
        "c1": f.get("cField1", ""),
        "email": f.get("pageField[email]", ""),
        "name": f.get("pageField[fullName]", ""),
    }
    blob = _pack(facts)
    url = f"{get_frontend_url()}{PREFIX}/page/{blob}?s={_sign(blob)}"
    return {"status": 1, "err": "", "data": {"processId": process_id, "processToken": facts["ptok"], "url": url}}


@router.post("/api/light/server/1.0/approveTransaction")
async def approve_transaction(request: Request):
    _require()
    form = await request.form()
    if form.get("pageCode") != grow.page_code():
        return _fail("pageCode is not valid", 702)
    logger.info("Grow stand-in: approveTransaction for transaction %s", form.get("transactionId"))
    return {"status": 1, "err": "", "data": {}}


_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>{title}</title>
<style>
  body {{ margin: 0; padding: 16px; font: 16px/1.5 system-ui, sans-serif; background: #e8f5e9; color: #222; }}
  main {{ max-width: 420px; margin: 32px auto; background: #fff; border: 4px dashed #d32f2f; border-radius: 12px; padding: 24px; }}
  .banner {{ background: #d32f2f; color: #fff; font-weight: 700; text-align: center; padding: 8px; border-radius: 6px; letter-spacing: .04em; }}
  .brand {{ margin-top: 12px; font-weight: 700; color: #1b5e20; }}
  h1 {{ font-size: 20px; margin: 12px 0 4px; }}
  .amount {{ font-size: 40px; font-weight: 700; margin: 8px 0 4px; }}
  .muted {{ color: #666; font-size: 14px; }}
  form {{ display: inline; }}
  .actions {{ display: flex; gap: 12px; margin-top: 24px; }}
  button {{ flex: 1; font: inherit; font-weight: 700; padding: 14px; border-radius: 8px; border: 0; cursor: pointer; }}
  .pay {{ background: #2e7d32; color: #fff; }}
  .fail {{ background: #eee; color: #222; }}
</style>
</head>
<body>
<main>
  <div class="banner">TEST &mdash; no real money</div>
  <div class="brand">Grow stand-in &middot; real Grow code path</div>
  <h1>{desc}</h1>
  <div class="amount">₪{sum}</div>
  <div class="muted">Card 4580 0000 0000 0000 (Grow's test card)</div>
  <div class="muted">Process {pid}</div>
  <div class="actions">
    <form method="post" action="{base}/pay?s={sig}"><button class="pay" type="submit">Pay</button></form>
    <form method="post" action="{base}/fail?s={sig}"><button class="fail" type="submit">Fail</button></form>
  </div>
</main>
</body>
</html>
"""


@router.get("/page/{blob}", response_class=HTMLResponse)
def page(blob: str, s: str = ""):
    _require()
    facts = _unpack(blob, s)
    sum_text = facts["sum"][:-3] if facts["sum"].endswith(".00") else facts["sum"]
    body = _PAGE.format(
        title=PAGE_TITLE, desc=html.escape(facts["desc"]), sum=html.escape(sum_text),
        pid=html.escape(facts["pid"]), base=f"{PREFIX}/page/{html.escape(blob)}", sig=html.escape(s),
    )
    return HTMLResponse(body, headers={"Cache-Control": "no-store"})


def server_update(facts: Dict[str, Any], transaction_id: str) -> Dict[str, str]:
    """The form Grow posts to notifyUrl (field names from Grow's sample)."""
    now = datetime.now(timezone.utc)
    data = {
        "asmachta": transaction_id[-6:], "cardSuffix": "0000", "cardType": "Local",
        "cardTypeCode": "1", "cardBrand": "Visa", "cardBrandCode": "3", "cardExp": "1230",
        "firstPaymentSum": "0", "periodicalPaymentSum": "0", "status": "שולם", "statusCode": "2",
        "transactionTypeId": "1", "paymentType": "2", "sum": facts["sum"], "paymentsNum": "1",
        "allPaymentsNum": "1", "paymentDate": now.strftime("%d/%m/%y"), "description": facts["desc"],
        "fullName": facts.get("name") or "Test Buyer", "payerPhone": "0501234567",
        "payerEmail": facts.get("email") or "", "transactionId": transaction_id,
        "transactionToken": secrets.token_hex(16), "processId": facts["pid"],
        "processToken": facts["ptok"],
    }
    form = {"err": "", "status": "1"}
    form.update({f"data[{k}]": v for k, v in data.items()})
    form["data[customFields][cField1]"] = facts.get("c1", "")
    return form


@router.post("/page/{blob}/pay")
def pay(blob: str, s: str = ""):
    """Grow's side of a paid card: POST the server update, over HTTP, to the
    notifyUrl we were given. Our backend decides; this page only reports."""
    _require()
    facts = _unpack(blob, s)
    transaction_id = str(secrets.randbelow(900_000_000) + 100_000_000)
    try:
        # Multipart, as Grow sends it ("the same way as CreatePaymentProcess"),
        # so the robot drives the decode real Grow will hit.
        form = server_update(facts, transaction_id)
        resp = requests.post(facts["notify"], files={k: (None, v) for k, v in form.items()}, timeout=30)
        logger.info("Grow stand-in: server update for process %s -> HTTP %s", facts["pid"], resp.status_code)
    except requests.RequestException as exc:
        logger.error("Grow stand-in: server update for process %s failed: %s", facts["pid"], type(exc).__name__)
    return RedirectResponse(_with_param(facts["success"], "response", "success"), status_code=303)


@router.post("/page/{blob}/fail")
def fail(blob: str, s: str = ""):
    """Declined: back to the cancel page. Grow sends no server update."""
    _require()
    facts = _unpack(blob, s)
    return RedirectResponse(facts["cancel"], status_code=303)
