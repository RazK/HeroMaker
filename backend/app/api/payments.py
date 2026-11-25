"""
Buying credits.

In the order money moves through them:

    GET  /api/v1/packs            what we sell, public, no prices invented here
    POST /api/v1/checkout         signed-in user asks for a checkout URL
    POST /api/payments/webhook    Lemon Squeezy tells us they paid -> credits
    POST /api/payments/grow/callback   Grow-shaped callback (grow_sandbox) -> credits
    GET  /api/v1/receipts         signed-in user's own purchase history

The client calls are served by app/api/v1_account.py, which calls the
functions here, through whichever provider PAYMENTS_PROVIDER selects
(app/services/payments_provider.py). Only the provider callbacks are routed
from this module: the store is configured with those addresses. grow_sandbox's
fake hosted page lives in app/api/payments_sandbox.py.

THE WEBHOOK IS THE ONLY PLACE CREDITS ARE GRANTED FOR MONEY (each provider's
signed callback, that is). The browser is
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

from starlette.concurrency import run_in_threadpool

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import packs as packs_config
from app.database import get_db
from app.models import CheckoutOrder, ClassRoom, Payment, User
from app.services import classes as class_service
from app.services import analytics, grow, ledger, payments_provider

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
    # "USD" (Lemon Squeezy) or "ILS" (Grow). price_cents is in this
    # currency's cents: agorot for ILS. price_display already carries the sign.
    currency: str = "USD"


def list_packs():
    """
    The packs a customer can actually buy right now, from the selected
    payments provider (app/services/payments_provider.py).

    Packs with no Lemon Squeezy variant configured are omitted rather than
    shown greyed out: a price with no working button is worse than no price.
    Margin figures are deliberately NOT in this response - they are our
    business, and they live on the admin finance page.

    Nothing is listed unless the store can both open a checkout and hear that
    it was paid (payments_provider.can_sell): variant ids alone used to be
    enough, so a deployment missing its API key showed Buy buttons that
    answered 503, and one missing its webhook secret would have taken money
    and granted nothing.
    """
    return [
        PackOut(
            slug=p["slug"], name=p["name"], blurb=p["blurb"],
            credits=p["credits"], heroes=p["heroes"],
            price_cents=p["price_cents"], price_display=p["price_display"],
            highlight=p["highlight"], currency=p.get("currency", "USD"),
        )
        for p in payments_provider.list_packs()
    ]


# --------------------------------------------------------------------------
# Starting a purchase
# --------------------------------------------------------------------------

class CheckoutRequest(BaseModel):
    pack: str = Field(..., description="Pack slug, from GET /api/v1/packs")
    redirect_url: Optional[str] = Field(
        None, description="Where Lemon Squeezy sends the buyer after paying"
    )


class CheckoutResponse(BaseModel):
    checkout_url: str
    pack: str
    credits: int
    price_display: str
    test_mode: bool


def create_checkout(request: CheckoutRequest, db: Session, user: User):
    """
    Open a checkout for this user with the selected provider and return its URL.

    Nothing is charged and no credits move here. Lemon Squeezy stamps the user
    id into the checkout so the webhook knows whose balance to credit;
    grow_sandbox stores the whole order on our side (CheckoutOrder) and its
    callback names that order. Either way, that is the whole purpose of this call.
    """
    pack = payments_provider.get_pack(request.pack)
    if pack is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No such pack: {request.pack}",
        )

    try:
        url = payments_provider.create_checkout(
            pack=pack,
            user_id=user.id,
            email=user.email,
            redirect_url=request.redirect_url,
            db=db,
        )
    except payments_provider.NotConfiguredError as exc:
        # Ours to fix, not the customer's. 503 so an uptime check notices.
        logger.error("Checkout unavailable: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Payments are not available right now.",
        ) from exc
    except payments_provider.PaymentsError as exc:
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
        test_mode=payments_provider.test_mode(),
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

    if not payments_provider.verify_signature(raw, x_signature):
        # Do not say which of "no secret configured" / "bad signature" it was.
        logger.warning("Rejected a Lemon Squeezy webhook with a bad signature")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid signature",
        )

    try:
        payload = await request.json()
        event = payments_provider.parse_order_event(payload)
    except (ValueError, payments_provider.PaymentsError) as exc:
        logger.error("Unreadable Lemon Squeezy webhook: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Malformed webhook body",
        ) from exc

    if event["event"] not in payments_provider.HANDLED_EVENTS:
        return {"status": "ignored", "reason": f"unhandled event {event['event']}"}

    if event["test_mode"] and not payments_provider.test_mode():
        # A live deployment is being told about a test-mode order: paid with
        # Lemon Squeezy's test card, so no money moved. The test and live
        # webhooks normally have different signing secrets and this never gets
        # here; it does if the same secret was typed into both.
        logger.error(
            "Lemon Squeezy order %s is a TEST-mode order and this deployment is live "
            "(LEMONSQUEEZY_TEST_MODE=false); nothing was granted",
            event["order_id"],
        )
        return {"status": "ignored", "reason": "test-mode order on a live deployment"}

    if event["kind"] == packs_config.CLASS_SEATS_SLUG:
        return _class_seats_event(db, event)

    if event["event"] == payments_provider.EVENT_ORDER_REFUNDED:
        # Refunds are not clawed back automatically. Taking credits a child has
        # already spent on a hero would fail, and silently leaving them is a
        # decision an admin should make, not a webhook. Log loudly instead.
        logger.warning(
            "Order %s was refunded (user %s, pack %s). Credits were NOT reversed; "
            "review at /api/v1/admin/finance/ledger/%s",
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

    pack = _pack_paid_for(event, pack_slug)
    if pack is None:
        logger.error(
            "Lemon Squeezy order %s (custom pack %r, variant %r, subtotal %s) did not pay "
            "for a pack we sell; user %s was not credited",
            event["order_id"], pack_slug, event["variant_id"], event["subtotal_usd_micros"], user_id,
        )
        return {"status": "ignored", "reason": "order did not pay for a pack"}
    pack_slug = pack["slug"]

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


def _pack_paid_for(event: dict, claimed_slug: str) -> Optional[dict]:
    """
    The pack this order actually paid for, or None.

    custom_data names a pack, but custom_data is not proof: Lemon Squeezy
    copies it from the checkout link, and anyone can write a link to the
    cheapest variant that says `pack=studio` (docs.lemonsqueezy.com/help/
    checkout/passing-custom-data). Before this check, $5 bought 300 credits.

    What the buyer cannot choose is the variant the order's item was sold as,
    so the pack is read from that. A discount code still works: the variant is
    the same whatever was taken off.

    A body with no order item (not seen from Lemon Squeezy, but the item is the
    one thing here we do not control) falls back to the price: the claimed
    pack counts only if the goods were priced at least that much before any
    discount and before tax. One cent of slack for a converted currency.
    """
    variant = event["variant_id"]
    if variant:
        pack = packs_config.pack_for_variant(variant)
        if pack is not None and pack["slug"] != claimed_slug:
            logger.warning(
                "Lemon Squeezy order %s says pack %r but was sold as %r; crediting %r",
                event["order_id"], claimed_slug, pack["slug"], pack["slug"],
            )
        return pack

    pack = packs_config.get_pack(claimed_slug)
    if pack is None:
        return None
    priced = event["subtotal_usd_micros"]
    if priced is None:
        priced = event["total_usd_micros"]
    return pack if priced >= pack["price_usd_micros"] - 10_000 else None


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
    if event["event"] == payments_provider.EVENT_ORDER_REFUNDED:
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
# Money arriving, Grow-shaped (grow_sandbox now, Grow next)
# --------------------------------------------------------------------------

@router.post("/grow/callback")
async def grow_callback(request: Request, db: Session = Depends(get_db)):
    """The payment server's callback. Verify, then credit (handle_grow_callback)."""
    raw = await request.body()
    return handle_grow_callback(db, raw, request.headers)


def handle_grow_callback(db: Session, raw: bytes, headers) -> dict:
    """
    A Grow-shaped callback says "transaction T paid sum S for order O".

    The ONE function that grants credits for it, whether the callback came
    over HTTP or from the sandbox page's Pay button in-process
    (app/api/payments_sandbox.py): the signature is verified here either way.

    The callback is believed about two things only: that a transaction
    happened, and its id. Everything else is OURS. The order is the row we
    stored when the checkout opened (CheckoutOrder): what it buys and what it
    must cost are read from there, and a callback whose sum differs from it
    grants nothing. custom fields carry only our order id, which is just a
    lookup key: naming someone else's order buys them what it says, for what
    it costs.

    Replays: the order is claimed for its transaction atomically (a second,
    different transaction for a paid order grants nothing), and the ledger row
    is keyed on the transaction id, so the same transaction delivered twice
    credits once.

    Like the Lemon Squeezy webhook, 200 for anything we decided not to act on;
    401 for an unauthenticated body, 400 for an unreadable one, 404 when no
    Grow-shaped provider is armed here (production, for one).
    """
    if not payments_provider.callbacks_open():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    if not payments_provider.verify_callback(raw, headers):
        logger.warning("Rejected a payment callback with a bad signature")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature")
    try:
        callback = payments_provider.parse_callback(raw)
    except payments_provider.PaymentsError as exc:
        logger.error("Unreadable payment callback: %s", exc)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Malformed callback body") from exc

    provider = payments_provider.name()
    order = (db.query(CheckoutOrder)
             .filter(CheckoutOrder.id == callback["order_id"], CheckoutOrder.provider == provider)
             .first())
    if order is None:
        logger.error("Payment callback for transaction %s names order %s, which we never opened; "
                     "nothing granted", callback["transaction_id"], callback["order_id"])
        return {"status": "ignored", "reason": "unknown order"}
    return _grant_paid_order(db, order, callback)


def _grant_paid_order(db: Session, order: CheckoutOrder, callback: dict) -> dict:
    """
    Grant what OUR stored `order` buys, for a VERIFIED callback saying
    transaction `callback["transaction_id"]` paid `callback["sum_minor"]`.
    The caller has authenticated the callback; this checks it against the
    order (paid, same sum), claims the order once, and credits once.
    """
    provider = order.provider
    transaction_id = callback["transaction_id"]
    if not callback["paid"]:
        return {"status": "ignored", "reason": f"transaction status {callback['status']}"}
    if callback["sum_minor"] != order.amount_minor:
        logger.error("Payment callback for order %s says %s %s were paid; the order costs %s. "
                     "Nothing granted (transaction %s)", order.id, callback["sum_minor"], order.currency,
                     order.amount_minor, transaction_id)
        return {"status": "ignored", "reason": "sum does not match the order"}

    # Claim the order for this transaction: a pending order, or one this same
    # transaction already paid (a redelivery). One UPDATE, so two different
    # transactions racing for one order cannot both win.
    try:
        claimed = (db.query(CheckoutOrder)
                   .filter(CheckoutOrder.id == order.id,
                           or_(CheckoutOrder.status == "pending",
                               and_(CheckoutOrder.status == "paid",
                                    CheckoutOrder.transaction_id == transaction_id)))
                   .update({CheckoutOrder.status: "paid", CheckoutOrder.transaction_id: transaction_id},
                           synchronize_session=False))
        db.commit()
    except IntegrityError:
        # transaction_id is UNIQUE: this transaction already paid another order.
        db.rollback()
        claimed = 0
    if claimed != 1:
        db.refresh(order)
        logger.error("Payment callback: transaction %s for order %s (status %s, paid by %s); nothing granted",
                     transaction_id, order.id, order.status, order.transaction_id)
        return {"status": "ignored", "reason": f"order is {order.status}"}

    ref = f"{provider}:tx:{transaction_id}"
    meta = {
        "provider": provider,
        "order_id": order.id,
        "transaction_id": transaction_id,
        "currency": order.currency,
        "amount_minor": order.amount_minor,
        "test_mode": payments_provider.test_mode(),
    }
    if order.kind == packs_config.CLASS_SEATS_SLUG:
        return _grow_class_seats(db, order, ref, meta)

    try:
        tx = ledger.record_purchase(
            user_id=order.user_id,
            amount=order.credits,
            db=db,
            # THE replay guard: the same transaction returns this row.
            external_ref=ref,
            metadata={**meta, "pack": order.product},
        )
    except ledger.UnknownUserError:
        logger.error("Order %s names user %s, who does not exist; nothing granted", order.id, order.user_id)
        return {"status": "ignored", "reason": "unknown user"}

    _record_order_payment(db, order, ref, order.user_id)
    logger.info("Credited %s credits to user %s for order %s, transaction %s (balance now %s)",
                order.credits, order.user_id, order.id, transaction_id, tx.balance_after)
    return {"status": "ok", "credits_granted": order.credits, "balance_after": tx.balance_after}


@router.post("/grow/notify/{order_id}/{token}")
async def grow_notify(order_id: str, token: str, request: Request,
                      db: Session = Depends(get_db)):
    """Grow's server update for one order (PAYMENTS_PROVIDER=grow). The token
    is in the path (grow.notify_url). See handle_grow_notify: verify, credit,
    then approveTransaction. A notify without a token matches no route: 404."""
    content_type = request.headers.get("content-type", "")
    if "multipart/form-data" in content_type:
        form = await request.form()
        body = grow.from_form(form.multi_items())
    else:
        try:
            body = grow.parse_notify_body(await request.body(), content_type)
        except grow.GrowError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Malformed notify body") from exc
    # In the threadpool: it calls Grow (approveTransaction) with a blocking
    # client, which must not stall the event loop.
    return await run_in_threadpool(handle_grow_notify, db, order_id, token, body)


def handle_grow_notify(db: Session, order_id: str, token: Optional[str], body: dict) -> dict:
    """
    Grow says an order was paid. Credits move only if grow.verify_notify
    proves the update is Grow's, about THIS order (the order's secret notify
    token, and the processId/processToken Grow gave our server for it). Then
    the stored order decides what is granted, exactly as for the sandbox
    (_grant_paid_order). Then approveTransaction, which Grow requires; if it
    fails Grow resends the update, and the replay grants nothing more.

    404 unless grow sells here; 401 for an unproven update; 200 otherwise.
    """
    if payments_provider.name() != grow.NAME or not grow.can_sell():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    order = (db.query(CheckoutOrder)
             .filter(CheckoutOrder.id == order_id, CheckoutOrder.provider == grow.NAME)
             .first())
    if order is None:
        # The same answer as a bad token: do not tell a prober which ids exist.
        logger.warning("Grow notify for order %s, which we never opened; rejected", order_id)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unverified notify")
    try:
        callback = grow.verify_notify(order, token, body)
    except grow.NotifyRejected as exc:
        logger.warning("Rejected a Grow notify for order %s: %s", order_id, exc)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unverified notify") from exc
    except grow.GrowError as exc:
        logger.error("Unreadable Grow notify for order %s: %s", order_id, exc)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Malformed notify body") from exc

    result = _grant_paid_order(db, order, callback)
    if callback["paid"] and result.get("status") == "ok":
        approved = grow.approve_transaction(callback["data"])
        order = db.query(CheckoutOrder).filter(CheckoutOrder.id == order.id).one()
        order.metadata_json = {**(order.metadata_json or {}), "grow_asmachta": callback["asmachta"],
                               "grow_approved": approved}
        db.commit()
        result = {**result, "approved": approved}
    return result


def _grow_class_seats(db: Session, order: CheckoutOrder, ref: str, meta: dict) -> dict:
    """Seats for ONE class, to its wallet, exactly as _class_seats_event does
    for Lemon Squeezy - but the class, the seats and the price come from our
    stored order, and the price is recomputed from its seat count."""
    seats, class_id = order.seats, order.class_id
    if not class_id or not seats or seats < 1 or seats > packs_config.CLASS_MAX_SEATS:
        logger.error("Class seat order %s is unusable (class=%r seats=%r); nothing granted", order.id, class_id, seats)
        return {"status": "ignored", "reason": "order carries no usable class seats"}
    classroom = db.query(ClassRoom).filter(ClassRoom.id == class_id).first()
    if classroom is None:
        logger.error("Class seat order %s names class %s, which does not exist; nothing granted", order.id, class_id)
        return {"status": "ignored", "reason": "unknown class"}
    expected = packs_config.class_seats_price_agorot(seats)
    if order.amount_minor < expected:
        logger.error("Class seat order %s cost %s for %s seats, which now cost %s; nothing granted",
                     order.id, order.amount_minor, seats, expected)
        return {"status": "ignored", "reason": "amount paid does not cover the seats"}

    tx, granted = class_service.grant_bought_seats(
        db, classroom, seats, order.id, ref=ref,
        metadata={**meta, "kind": packs_config.CLASS_SEATS_SLUG, "teacher_id": classroom.owner_id,
                  "buyer_user_id": order.user_id, "price_minor": expected},
    )
    _record_order_payment(db, order, ref, order.user_id or classroom.owner_id,
                          extra={"class_id": class_id, "seats": seats})
    db.expire_all()
    classroom = db.query(ClassRoom).filter(ClassRoom.id == class_id).one()
    logger.info("Class seat order %s: %s seats for class %s (%s)", order.id, seats, class_id,
                "granted" if granted else "already granted")
    return {
        "status": "ok",
        "class_id": class_id,
        "seats_granted": seats if granted else 0,
        "seats": classroom.seats,
    }


def _record_order_payment(db: Session, order: CheckoutOrder, ref: str, user_id: str,
                          extra: Optional[dict] = None) -> None:
    """
    The payment row beside the credits, for an order paid in a currency the
    margin report cannot read. Idempotent on provider_ref, never raises: the
    same contract as _record_payment.

    The USD columns are 0. The sandbox moves no money, and there is no ILS
    rate in this codebase to turn a real Grow sale into USD micros; the amount
    paid is in the metadata, in the currency's cents. Real Grow sales need
    that decision before the margin report can count them.
    """
    existing = db.query(Payment).filter(Payment.provider_ref == ref).first()
    if existing is not None:
        return
    test = payments_provider.test_mode()
    try:
        db.add(Payment(
            user_id=user_id,
            provider=order.provider,
            provider_ref=ref,
            gross_usd_micros=0,
            fee_usd_micros=0,
            net_usd_micros=0,
            status="succeeded",
            metadata_json={
                "pack": order.product,
                "credits": order.credits,
                "order_id": order.id,
                "transaction_id": order.transaction_id,
                "currency": order.currency,
                "amount_minor": order.amount_minor,
                "test_mode": test,
                "usd_not_recorded": True,
                **(extra or {}),
            },
        ))
        db.commit()
        # The funnel's "bought" step, as _record_payment says it. amount_cents
        # is USD cents there; this sale has none recorded.
        analytics.record_server(
            db, "purchase_done", {"pack": order.product, "amount_cents": 0, "test": test},
            user_id=user_id, ref=ref, once=True,
        )
    except Exception:
        db.rollback()
        logger.exception("Credits were granted for order %s but the payment row failed to write", order.id)


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


def list_receipts(db: Session, user: User):
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
        paid = pricing.micros_to_usd_str(gross, places=2) if gross else None
        if meta.get("currency") == packs_config.ILS and meta.get("amount_minor"):
            # Sold in shekels (Grow, grow_sandbox): shown as charged, "₪39".
            paid = packs_config.agorot_display(meta["amount_minor"])
        classroom = titles.get(tx.user_id)
        out.append(ReceiptOut(
            order_number=meta.get("order_number"),
            pack=meta.get("pack") or meta.get("kind"),
            credits=tx.delta,
            paid_display=paid,
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
        # The funnel's "bought" step, said by the backend because only the
        # signed webhook knows a payment happened. Here, beside the payment
        # row, so a redelivery (which returned above) is one purchase, and a
        # pack and a class's seats both count. Never raises.
        analytics.record_server(
            db, "purchase_done",
            {"pack": pack["slug"], "amount_cents": (gross or 0) // 10_000, "test": bool(event["test_mode"])},
            user_id=user_id, ref=ref, once=True,
        )
    except Exception:
        db.rollback()
        logger.exception(
            "Credits were granted for order %s but the payment row failed to "
            "write; revenue will under-report until this is reconciled",
            event["order_id"],
        )
