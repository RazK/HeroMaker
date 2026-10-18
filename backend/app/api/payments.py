"""
Buying credits.

Three endpoints, in the order money moves through them:

    GET  /api/payments/packs      what we sell, public, no prices invented here
    POST /api/payments/checkout   signed-in user asks for a checkout URL
    POST /api/payments/webhook    Lemon Squeezy tells us they paid -> credits
    GET  /api/payments/receipts   signed-in user's own purchase history

THE WEBHOOK IS THE ONLY PLACE CREDITS ARE GRANTED FOR MONEY. The browser is
never trusted to say "I paid" - it never touches this path. A user returning
from a successful checkout just sees their balance, which the webhook has
already moved (or will, within a second or two).

Replay safety is not implemented here; it is inherited. `ledger.record_purchase`
takes the Lemon Squeezy order id as `external_ref`, which is UNIQUE, so the
second delivery of the same webhook returns the first row and grants nothing.
Lemon Squeezy WILL deliver twice; this is not a hypothetical.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import packs as packs_config
from app.database import get_db
from app.models import ClassRoom, Payment, User
from app.services import classes as class_service
from app.services import ledger, lemonsqueezy
from app.services.auth import get_current_user_required

logger = logging.getLogger(__name__)

router = APIRouter()


# --------------------------------------------------------------------------
# What we sell
# --------------------------------------------------------------------------

class PackOut(BaseModel):
    slug: str
    name: str
    blurb: str
    credits: int
    heroes: int
    price_cents: int
    price_display: str
    highlight: bool


@router.get("/packs", response_model=list[PackOut])
def list_packs():
    """
    The packs a customer can actually buy right now.

    Packs with no Lemon Squeezy variant configured are omitted rather than
    shown greyed out: a price with no working button is worse than no price.
    Margin figures are deliberately NOT in this response - they are our
    business, and they live on the admin finance page.
    """
    return [
        PackOut(
            slug=p["slug"], name=p["name"], blurb=p["blurb"],
            credits=p["credits"], heroes=p["heroes"],
            price_cents=p["price_cents"], price_display=p["price_display"],
            highlight=p["highlight"],
        )
        for p in packs_config.get_packs(include_unconfigured=False)
    ]


# --------------------------------------------------------------------------
# Starting a purchase
# --------------------------------------------------------------------------

class CheckoutRequest(BaseModel):
    pack: str = Field(..., description="Pack slug, from GET /api/payments/packs")
    redirect_url: Optional[str] = Field(
        None, description="Where Lemon Squeezy sends the buyer after paying"
    )


class CheckoutResponse(BaseModel):
    checkout_url: str
    pack: str
    credits: int
    price_display: str
    test_mode: bool


@router.post("/checkout", response_model=CheckoutResponse)
def create_checkout(
    request: CheckoutRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_required),
):
    """
    Open a Lemon Squeezy checkout for this user and return its URL.

    Nothing is charged and no credits move here. The user id is stamped into
    the checkout so the webhook knows whose balance to credit; that is the
    whole purpose of this call.
    """
    pack = packs_config.get_pack(request.pack)
    if pack is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No such pack: {request.pack}",
        )

    try:
        url = lemonsqueezy.create_checkout(
            pack=pack,
            user_id=user.id,
            email=user.email,
            redirect_url=request.redirect_url,
        )
    except lemonsqueezy.NotConfiguredError as exc:
        # Ours to fix, not the customer's. 503 so an uptime check notices.
        logger.error("Checkout unavailable: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Payments are not available right now.",
        ) from exc
    except lemonsqueezy.LemonSqueezyError as exc:
        logger.error("Checkout failed for user %s pack %s: %s", user.id, pack["slug"], exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not start the checkout. Please try again.",
        ) from exc

    return CheckoutResponse(
        checkout_url=url,
        pack=pack["slug"],
        credits=pack["credits"],
        price_display=pack["price_display"],
        test_mode=lemonsqueezy.test_mode(),
    )


# --------------------------------------------------------------------------
# Money arriving
# --------------------------------------------------------------------------

@router.post("/webhook")
async def lemonsqueezy_webhook(
    request: Request,
    x_signature: Optional[str] = Header(None, alias="X-Signature"),
    db: Session = Depends(get_db),
):
    """
    Lemon Squeezy's callback. Verify, then credit.

    Returns 200 for anything we have decided not to act on - an unknown event,
    an order from someone else's checkout, an order that is not paid. A 4xx
    makes Lemon Squeezy retry the same body for hours, so we only use one when
    the body is genuinely unusable or unauthenticated.
    """
    raw = await request.body()

    if not lemonsqueezy.verify_signature(raw, x_signature):
        # Do not say which of "no secret configured" / "bad signature" it was.
        logger.warning("Rejected a Lemon Squeezy webhook with a bad signature")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid signature",
        )

    try:
        payload = await request.json()
        event = lemonsqueezy.parse_order_event(payload)
    except (ValueError, lemonsqueezy.LemonSqueezyError) as exc:
        logger.error("Unreadable Lemon Squeezy webhook: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Malformed webhook body",
        ) from exc

    if event["event"] not in lemonsqueezy.HANDLED_EVENTS:
        return {"status": "ignored", "reason": f"unhandled event {event['event']}"}

    if event["kind"] == packs_config.CLASS_SEATS_SLUG:
        return _class_seats_event(db, event)

    if event["event"] == lemonsqueezy.EVENT_ORDER_REFUNDED:
        # Refunds are not clawed back automatically. Taking credits a child has
        # already spent on a hero would fail, and silently leaving them is a
        # decision an admin should make, not a webhook. Log loudly instead.
        logger.warning(
            "Order %s was refunded (user %s, pack %s). Credits were NOT reversed; "
            "review at /api/admin/finance/ledger/%s",
            event["order_id"], event["user_id"], event["pack_slug"], event["user_id"],
        )
        return {"status": "logged", "reason": "refund needs an admin decision"}

    # order_created from here on.
    if event["status"] not in (None, "paid"):
        return {"status": "ignored", "reason": f"order status {event['status']}"}

    user_id = event["user_id"]
    pack_slug = event["pack_slug"]
    if not user_id or not pack_slug:
        # A checkout opened from the storefront rather than by our API. We have
        # no idea whose it is; a human has to sort it out.
        logger.error(
            "Lemon Squeezy order %s has no custom_data (user_id=%r pack=%r); "
            "nobody was credited",
            event["order_id"], user_id, pack_slug,
        )
        return {"status": "ignored", "reason": "order carries no custom_data"}

    pack = packs_config.get_pack(pack_slug)
    if pack is None:
        logger.error(
            "Lemon Squeezy order %s names pack %r, which no longer exists; "
            "user %s was not credited",
            event["order_id"], pack_slug, user_id,
        )
        return {"status": "ignored", "reason": f"unknown pack {pack_slug}"}

    try:
        tx = ledger.record_purchase(
            user_id=user_id,
            amount=pack["credits"],
            db=db,
            # THE replay guard. A second delivery of this order returns the
            # existing row and grants nothing.
            external_ref=f"lemonsqueezy:order:{event['order_id']}",
            metadata={
                "provider": "lemonsqueezy",
                "order_id": event["order_id"],
                "order_number": event["order_number"],
                "pack": pack_slug,
                "gross_usd_micros": event["total_usd_micros"],
                "currency": event["currency"],
                "test_mode": event["test_mode"],
                # What we expect to keep, recorded at the time of sale so the
                # margin report does not have to re-derive history.
                "processor_fee_usd_micros": packs_config.processor_fee_usd_micros(
                    event["total_usd_micros"]
                ),
            },
        )
    except ledger.UnknownUserError:
        logger.error(
            "Lemon Squeezy order %s names user %s, who does not exist; "
            "money was taken and no credits were granted",
            event["order_id"], user_id,
        )
        return {"status": "ignored", "reason": "unknown user"}

    # The money side. The ledger row above says how many CREDITS moved; this
    # row says how many DOLLARS did, and it is what the margin report reads for
    # revenue - without it a real sale shows up as $0 of income.
    #
    # provider_ref is UNIQUE, the same replay defence the ledger uses, so a
    # redelivery that found an existing ledger row must not try to insert here
    # either. `tx.delta` tells us which case we are in: a replay returns the
    # original row, and `_payment_exists` is the cheap, explicit check.
    _record_payment(db, event, pack, user_id)

    logger.info(
        "Credited %s credits to user %s for order %s (balance now %s)",
        pack["credits"], user_id, event["order_id"], tx.balance_after,
    )
    return {
        "status": "ok",
        "credits_granted": pack["credits"],
        "balance_after": tx.balance_after,
    }


# --------------------------------------------------------------------------
# Money arriving for a class's seats
# --------------------------------------------------------------------------

def _class_seats_event(db: Session, event: dict) -> dict:
    """
    An order for seats of ONE class, at the class price (app/api/classes.py
    opened it). The seats go to that class's wallet, never to the teacher.

    custom_data says which class and how many seats, but custom_data is not
    proof: anyone can open the variant's public buy link and add whatever
    custom data they like. So the price is recomputed here from the seat count,
    and the seats are granted only if the order's pre-tax subtotal, less any
    discount code, paid at least that. A short order grants nothing and is
    logged for a human. Paying for seats on someone else's class is a gift,
    not an attack: the most anyone gets is what they paid for.
    """
    order_id = event["order_id"]
    if event["event"] == lemonsqueezy.EVENT_ORDER_REFUNDED:
        if not event["refunded"] and event["status"] != "refunded":
            # A partial refund. Which seats it pays back is a judgement call,
            # so it is left to an admin, exactly like a refunded pack.
            logger.warning("Class seat order %s was partly refunded; seats NOT taken back (class %s)",
                           order_id, event["class_id"])
            return {"status": "logged", "reason": "partial refund needs an admin decision"}
        result = class_service.refund_bought_seats(db, order_id)
        logger.warning("Class seat order %s refunded: %s", order_id, result)
        return result

    if event["status"] not in (None, "paid"):
        return {"status": "ignored", "reason": f"order status {event['status']}"}

    seats, class_id, user_id = event["seats"], event["class_id"], event["user_id"]
    if not class_id or not seats or seats < 1 or seats > packs_config.CLASS_MAX_SEATS:
        logger.error("Class seat order %s has unusable custom_data (class=%r seats=%r); nothing granted",
                     order_id, class_id, seats)
        return {"status": "ignored", "reason": "order carries no usable class seats"}

    classroom = db.query(ClassRoom).filter(ClassRoom.id == class_id).first()
    if classroom is None:
        logger.error("Class seat order %s names class %s, which does not exist; money taken, nothing granted",
                     order_id, class_id)
        return {"status": "ignored", "reason": "unknown class"}

    expected = packs_config.class_seats_price_usd_micros(seats)
    subtotal = event["subtotal_usd_micros"]
    paid = (subtotal if subtotal is not None else event["total_usd_micros"]) - event["discount_usd_micros"]
    # One cent of slack, for an order paid in another currency and converted.
    if paid < expected - 10_000:
        logger.error(
            "Class seat order %s paid %s for %s seats of class %s, which cost %s; nothing granted",
            order_id, paid, seats, class_id, expected,
        )
        return {"status": "ignored", "reason": "amount paid does not cover the seats"}

    quote = packs_config.class_seats_quote(seats)
    tx, granted = class_service.grant_bought_seats(
        db, classroom, seats, order_id,
        metadata={
            "provider": "lemonsqueezy",
            "kind": packs_config.CLASS_SEATS_SLUG,
            "order_id": order_id,
            "order_number": event["order_number"],
            "teacher_id": classroom.owner_id,
            "buyer_user_id": user_id,
            "gross_usd_micros": event["total_usd_micros"],
            "price_usd_micros": expected,
            "currency": event["currency"],
            "test_mode": event["test_mode"],
            "processor_fee_usd_micros": packs_config.processor_fee_usd_micros(event["total_usd_micros"]),
        },
    )
    _record_payment(db, event, {"slug": quote["slug"], "credits": quote["credits"]},
                    user_id or classroom.owner_id,
                    extra={"class_id": class_id, "seats": seats})
    db.expire_all()
    classroom = db.query(ClassRoom).filter(ClassRoom.id == class_id).one()
    logger.info("Class seat order %s: %s seats for class %s (%s)", order_id, seats, class_id,
                "granted" if granted else "already granted")
    return {
        "status": "ok",
        "class_id": class_id,
        "seats_granted": seats if granted else 0,
        "seats": classroom.seats,
    }


# --------------------------------------------------------------------------
# Looking back
# --------------------------------------------------------------------------

class ReceiptOut(BaseModel):
    order_number: Optional[int] = None
    pack: Optional[str] = None
    credits: int
    paid_display: Optional[str] = None
    test_mode: bool = False
    created_at: str
    # Seats bought for one class: they sit on the class, not on this balance.
    class_id: Optional[str] = None
    class_title: Optional[str] = None
    seats: Optional[int] = None


@router.get("/receipts", response_model=list[ReceiptOut])
def list_receipts(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_required),
):
    """This user's own purchases, newest first. Read straight off the ledger:
    their own balance's, and their classes' wallets' (seats they bought)."""
    from app.config import pricing

    titles = {c.wallet_user_id: c for c in db.query(ClassRoom).filter(ClassRoom.owner_id == user.id).all()}
    rows = []
    for account in [user.id, *titles]:
        rows.extend(tx for tx in ledger.list_transactions(account, db, limit=100) if tx.reason == "purchase")
    rows.sort(key=lambda tx: tx.created_at, reverse=True)

    out = []
    for tx in rows[:100]:
        meta = tx.metadata_json or {}
        gross = meta.get("gross_usd_micros")
        classroom = titles.get(tx.user_id)
        out.append(ReceiptOut(
            order_number=meta.get("order_number"),
            pack=meta.get("pack") or meta.get("kind"),
            credits=tx.delta,
            paid_display=(pricing.micros_to_usd_str(gross, places=2) if gross else None),
            test_mode=bool(meta.get("test_mode", False)),
            created_at=tx.created_at.isoformat(),
            class_id=classroom.id if classroom else None,
            class_title=classroom.title if classroom else None,
            seats=meta.get("seats") if classroom else None,
        ))
    return out


def _record_payment(db: Session, event: dict, pack: dict, user_id: str, extra: Optional[dict] = None) -> None:
    """
    Write the dollars beside the credits.

    Idempotent by the same key as the ledger: `provider_ref` is UNIQUE, so a
    redelivered webhook finds the existing row and returns. Never raises - a
    failure here must not cost the customer their credits, which are already
    granted and are the thing they actually paid for. It logs loudly instead,
    and the reconciliation endpoint will show the gap.
    """
    ref = f"lemonsqueezy:order:{event['order_id']}"
    existing = db.query(Payment).filter(Payment.provider_ref == ref).first()
    if existing is not None:
        return

    gross = event["total_usd_micros"]
    fee = packs_config.processor_fee_usd_micros(gross) if gross else 0
    try:
        db.add(Payment(
            user_id=user_id,
            provider="lemonsqueezy",
            provider_ref=ref,
            gross_usd_micros=gross,
            fee_usd_micros=fee,
            net_usd_micros=gross - fee,
            # "succeeded" is what reporting.REVENUE_STATUSES counts as money in.
            status="succeeded",
            metadata_json={
                "pack": pack["slug"],
                "credits": pack["credits"],
                "order_number": event["order_number"],
                "currency": event["currency"],
                "test_mode": event["test_mode"],
                # The fee is OUR estimate from the published rate, not the
                # figure Lemon Squeezy actually took. Their payout report is
                # the truth; this is close enough to steer by and is marked so
                # nobody mistakes it for a settled number.
                "fee_is_estimated": True,
                **(extra or {}),
            },
        ))
        db.commit()
    except Exception:
        db.rollback()
        logger.exception(
            "Credits were granted for order %s but the payment row failed to "
            "write; revenue will under-report until this is reconciled",
            event["order_id"],
        )
