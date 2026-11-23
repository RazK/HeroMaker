"""
grow_sandbox's fake hosted checkout page (app/services/grow_sandbox.py).

    GET  /api/payments/sandbox/checkout/<order>        "TEST - no real money", Pay / Fail
    POST /api/payments/sandbox/checkout/<order>/pay    the server sends the signed callback
    POST /api/payments/sandbox/checkout/<order>/fail   the order fails; nothing is granted

Every route answers 404 unless PAYMENTS_PROVIDER=grow_sandbox and the sandbox
is armed (never in production, never without GROW_SANDBOX_SECRET).

Pay does NOT grant anything itself. It builds the callback Grow would send,
signs it with the sandbox secret, and hands the raw bytes and the signature
header to payments.handle_grow_callback - the same function the HTTP callback
endpoint calls - so the signature is verified and the order, its product and
its sum are checked exactly as for a callback from outside. In-process rather
than an HTTP request to ourselves: the backend has no reliable address for
itself behind Railway's proxy, and the code path past the network is the same.

The order id in the URL is the page's only credential: a random UUID that only
the account which opened the checkout was given. Paying someone else's order
buys them exactly what they ordered, for its price - and here, for no money.
"""
import html
import logging
from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session
from starlette.datastructures import Headers

from app.api import payments
from app.config import packs as packs_config
from app.database import get_db
from app.models import CheckoutOrder
from app.services import grow_sandbox, payments_provider

logger = logging.getLogger(__name__)

router = APIRouter()

# Added to the site's return URL when the buyer pressed Fail, so the app can
# say so. It re-reads the balance either way; nothing was granted.
FAILED_PARAM = "checkout"
FAILED_VALUE = "failed"


def _order(db: Session, order_id: str) -> CheckoutOrder:
    """The armed sandbox's order, or 404 - the same 404 whether the sandbox is
    off here or the order does not exist."""
    if payments_provider.name() != grow_sandbox.NAME or not grow_sandbox.armed():
        raise HTTPException(status_code=404, detail="Not Found")
    order = (db.query(CheckoutOrder)
             .filter(CheckoutOrder.id == order_id, CheckoutOrder.provider == grow_sandbox.NAME)
             .first())
    if order is None:
        raise HTTPException(status_code=404, detail="Not Found")
    return order


def _with_param(url: str, key: str, value: str) -> str:
    parts = urlsplit(url)
    query = parse_qsl(parts.query, keep_blank_values=True) + [(key, value)]
    return urlunsplit(parts._replace(query=urlencode(query)))


def _return_url(order: CheckoutOrder) -> str:
    return grow_sandbox.safe_return_url(order.redirect_url)


_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>TEST checkout - no real money</title>
<style>
  body {{ margin: 0; padding: 16px; font: 16px/1.5 system-ui, sans-serif; background: #fff8e1; color: #222; }}
  main {{ max-width: 420px; margin: 32px auto; background: #fff; border: 4px dashed #d32f2f; border-radius: 12px; padding: 24px; }}
  .banner {{ background: #d32f2f; color: #fff; font-weight: 700; text-align: center; padding: 8px; border-radius: 6px; letter-spacing: .04em; }}
  h1 {{ font-size: 20px; margin: 20px 0 4px; }}
  .amount {{ font-size: 40px; font-weight: 700; margin: 8px 0 4px; }}
  .muted {{ color: #666; font-size: 14px; }}
  form {{ display: inline; }}
  .actions {{ display: flex; gap: 12px; margin-top: 24px; }}
  button {{ flex: 1; font: inherit; font-weight: 700; padding: 14px; border-radius: 8px; border: 0; cursor: pointer; }}
  .pay {{ background: #2e7d32; color: #fff; }}
  .fail {{ background: #eee; color: #222; }}
  .status {{ margin-top: 24px; font-weight: 700; }}
</style>
</head>
<body>
<main>
  <div class="banner">TEST &mdash; no real money</div>
  <h1>{product}</h1>
  <div class="amount">{amount}</div>
  <div class="muted">{detail}</div>
  <div class="muted">HeroMaker payments sandbox. Order {order_id}</div>
  {actions}
</main>
</body>
</html>
"""


@router.get("/checkout/{order_id}", response_class=HTMLResponse)
def checkout_page(order_id: str, db: Session = Depends(get_db)):
    order = _order(db, order_id)
    meta = order.metadata_json or {}
    if order.kind == packs_config.CLASS_SEATS_SLUG:
        detail = f"{order.seats} seats for the class “{meta.get('class_title') or ''}”"
    else:
        heroes = meta.get("heroes")
        detail = f"{order.credits} credits" + (f" ({heroes} {'hero' if heroes == 1 else 'heroes'})" if heroes else "")
    if order.status == "pending":
        base = f"{grow_sandbox.CHECKOUT_PATH}/{html.escape(order.id)}"
        actions = (
            '<div class="actions">'
            f'<form method="post" action="{base}/pay"><button class="pay" type="submit">Pay</button></form>'
            f'<form method="post" action="{base}/fail"><button class="fail" type="submit">Fail</button></form>'
            '</div>'
        )
    else:
        actions = f'<div class="status">This order is {html.escape(order.status)}.</div>'
    page = _PAGE.format(
        product=html.escape(meta.get("name") or order.product),
        amount=html.escape(packs_config.agorot_display(order.amount_minor)),
        detail=html.escape(detail),
        order_id=html.escape(order.id),
        actions=actions,
    )
    return HTMLResponse(page, headers={"Cache-Control": "no-store"})


@router.post("/checkout/{order_id}/pay")
def pay(order_id: str, db: Session = Depends(get_db)):
    """The server, not the browser, says this order was paid: it signs a
    Grow-shaped callback and puts it through the real callback handler."""
    order = _order(db, order_id)
    if order.status == "pending":
        raw = grow_sandbox.callback_body(order, grow_sandbox.new_transaction_id())
        headers = Headers({grow_sandbox.SIGNATURE_HEADER: grow_sandbox.sign(raw),
                           "content-type": "application/json"})
        result = payments.handle_grow_callback(db, raw, headers)
        logger.info("Sandbox order %s paid: %s", order.id, result)
    return RedirectResponse(_return_url(order), status_code=303)


@router.post("/checkout/{order_id}/fail")
def fail(order_id: str, db: Session = Depends(get_db)):
    """The card was "declined": the order fails and nothing is granted. Only
    a pending order can fail; a paid one stays paid."""
    order = _order(db, order_id)
    updated = (db.query(CheckoutOrder)
               .filter(CheckoutOrder.id == order.id, CheckoutOrder.status == "pending")
               .update({CheckoutOrder.status: "failed"}, synchronize_session=False))
    db.commit()
    if updated:
        logger.info("Sandbox order %s failed", order.id)
    return RedirectResponse(_with_param(_return_url(order), FAILED_PARAM, FAILED_VALUE), status_code=303)
