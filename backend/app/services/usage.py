"""
Per-call cost capture.

THE POINT
---------
"What did this customer cost me" is unanswerable unless every paid call is
written down at the moment it is made. Not the happy path. EVERY call:

* the OpenAI render that came back moderation_blocked and cost nothing but
  delayed the hero by four minutes;
* the second OpenAI render, after the user retried, that DID cost $0.167 - and
  so did the first successful one whose output got thrown away;
* the Meshy image-to-3D that succeeded, for a creation whose rigging step then
  failed and was never completed.

Retries are most of the cost overrun and are exactly what nobody measures. Here
they each get a row.

TWO DESIGN DECISIONS WORTH KNOWING
----------------------------------
1. Usage events are written on their OWN database session, committed
   immediately, independent of the caller's transaction.

   The money is spent the instant the provider accepts the request. If the
   pipeline's transaction later rolls back, the cost does not roll back with it,
   so the record must not either. This is the one place in the codebase where
   *not* joining the caller's transaction is the correct choice.

2. Recording cost NEVER raises.

   A bookkeeping failure must not break the pipeline that is earning the money.
   Every write is wrapped; failures are logged at ERROR with the full payload so
   the row can be reconstructed by hand from the logs.
"""
import logging
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.config import pricing
from app.database import SessionLocal
from app.models import UsageEvent

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class UsageContext:
    """
    Who/what a provider call is being made for.

    Threaded through the service layer so that a cost row can be attributed to a
    user and a creation. All fields optional: a call made from a script has no
    creation, and that is fine - the cost is still recorded, just unattributed.
    """
    user_id: Optional[str] = None
    creation_id: Optional[str] = None
    step_name: Optional[str] = None

    @classmethod
    def for_step(cls, creation_id: str, user_id: str, step_name: str) -> "UsageContext":
        return cls(user_id=user_id, creation_id=creation_id, step_name=step_name)


@dataclass
class UsageHandle:
    """
    Mutable handle returned by `track()`, so the body of a tracked call can
    attach information only known once the provider has answered - most
    importantly the provider's own task/request id.
    """
    event_id: Optional[str] = None
    provider_ref: Optional[str] = None
    units: Optional[int] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


def _session() -> Session:
    """A short-lived session of our own. See module docstring, decision 1."""
    return SessionLocal()


def record_usage(
    ctx: Optional[UsageContext],
    provider: str,
    operation: str,
    quantity: int = 1,
    status: str = "submitted",
    provider_ref: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    cost_usd_micros: Optional[int] = None,
    units: Optional[int] = None,
) -> Optional[str]:
    """
    Write one usage_event. Returns its id, or None if the write failed.

    `cost_usd_micros` and `units` default to the price table
    (app/config/pricing.py). Pass them explicitly only when the provider tells
    you the actual charge, which is always better than a list price.
    """
    ctx = ctx or UsageContext()
    meta = dict(metadata or {})

    priced_units, priced_cost = pricing.price_call(provider, operation, quantity)
    if units is None:
        units = priced_units
    if cost_usd_micros is None:
        cost_usd_micros = priced_cost

    # A call that failed is (by the documented assumption in pricing.py) not
    # billed - but the price it would have cost is kept, so failure volume is
    # never invisible and re-pricing is a config flip, not a code change.
    if status == "failed" and not pricing.BILL_FAILED_CALLS:
        meta.setdefault("list_price_usd_micros", cost_usd_micros)
        meta.setdefault("not_billed_reason", "call failed; provider assumed not to bill")
        cost_usd_micros = 0

    db = _session()
    try:
        event = UsageEvent(
            user_id=ctx.user_id,
            creation_id=ctx.creation_id,
            step_name=ctx.step_name,
            provider=provider,
            operation=operation,
            units=int(units),
            cost_usd_micros=int(cost_usd_micros),
            provider_ref=provider_ref,
            status=status,
            metadata_json=meta,
            created_at=datetime.utcnow(),
        )
        db.add(event)
        db.commit()
        event_id = event.id
        logger.info(
            "usage: provider=%s op=%s units=%s cost_micros=%s status=%s "
            "creation=%s step=%s ref=%s",
            provider, operation, units, cost_usd_micros, status,
            ctx.creation_id, ctx.step_name, provider_ref,
        )
        return event_id
    except Exception:
        db.rollback()
        # Loud, with everything needed to reconstruct the row by hand.
        logger.error(
            "FAILED TO RECORD USAGE EVENT - cost is real but unrecorded. "
            "provider=%s op=%s units=%s cost_micros=%s status=%s user=%s "
            "creation=%s step=%s ref=%s meta=%s",
            provider, operation, units, cost_usd_micros, status, ctx.user_id,
            ctx.creation_id, ctx.step_name, provider_ref, meta,
            exc_info=True,
        )
        return None
    finally:
        db.close()


def finalize_usage(
    event_id: Optional[str],
    status: str,
    provider_ref: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    cost_usd_micros: Optional[int] = None,
) -> None:
    """
    Update an event whose outcome was not known when it was recorded.

    Meshy is asynchronous: we submit a task (status="submitted", cost booked at
    list price) and only learn minutes later whether it SUCCEEDED or FAILED.
    That later answer changes the cost, so it has to come back here.
    """
    if not event_id:
        return

    db = _session()
    try:
        event = db.get(UsageEvent, event_id)
        if event is None:
            logger.warning("finalize_usage: event %s not found", event_id)
            return

        meta = dict(event.metadata_json or {})
        meta.update(metadata or {})

        if cost_usd_micros is not None:
            event.cost_usd_micros = int(cost_usd_micros)
        elif status == "failed" and not pricing.BILL_FAILED_CALLS:
            # Refund the booked list price, but keep it visible.
            meta.setdefault("list_price_usd_micros", int(event.cost_usd_micros))
            meta.setdefault("not_billed_reason", "task ended FAILED; provider assumed to refund")
            event.cost_usd_micros = 0

        event.status = status
        if provider_ref:
            event.provider_ref = provider_ref
        event.metadata_json = meta
        event.updated_at = datetime.utcnow()
        db.commit()
        logger.info("usage: event %s finalized status=%s cost_micros=%s",
                    event_id, status, event.cost_usd_micros)
    except Exception:
        db.rollback()
        logger.error("FAILED TO FINALIZE USAGE EVENT %s (status=%s)",
                     event_id, status, exc_info=True)
    finally:
        db.close()


@contextmanager
def track(
    ctx: Optional[UsageContext],
    provider: str,
    operation: str,
    quantity: int = 1,
    metadata: Optional[Dict[str, Any]] = None,
    finalize_on_success: bool = True,
):
    """
    Wrap a paid provider call so that it is recorded whatever happens.

        with usage.track(ctx, pricing.PROVIDER_OPENAI, pricing.OP_OPENAI_IMAGE_EDIT) as call:
            response = client.images.edit(...)
            call.provider_ref = response.id

    Success -> the event is marked "succeeded" (unless finalize_on_success is
    False, which is what asynchronous providers want: the task has been accepted,
    but whether it SUCCEEDED is not known yet).

    Failure -> the event is marked "failed", the exception type and message are
    recorded in metadata, and the exception is re-raised unchanged. The caller's
    error handling is completely unaffected.
    """
    handle = UsageHandle(metadata=dict(metadata or {}))
    handle.event_id = record_usage(
        ctx=ctx,
        provider=provider,
        operation=operation,
        quantity=quantity,
        status="submitted",
        metadata=handle.metadata,
    )
    try:
        yield handle
    except BaseException as exc:
        finalize_usage(
            handle.event_id,
            status="failed",
            provider_ref=handle.provider_ref,
            metadata={
                **handle.metadata,
                "error_type": type(exc).__name__,
                # Truncated: provider errors can be enormous, and the full text
                # is already in the step's error_message and the logs.
                "error": str(exc)[:500],
            },
        )
        raise
    else:
        finalize_usage(
            handle.event_id,
            status="succeeded" if finalize_on_success else "submitted",
            provider_ref=handle.provider_ref,
            metadata=handle.metadata,
        )


def finalize_usage_by_provider_ref(
    provider: str,
    provider_ref: Optional[str],
    status: str,
    metadata: Optional[Dict[str, Any]] = None,
    cost_usd_micros: Optional[int] = None,
) -> None:
    """
    Finalize an event identified by the provider's own task id.

    Meshy's asynchronous flow submits a task in one function and learns the
    outcome in a completely different one, minutes later. Rather than thread an
    opaque event id through the pipeline, the outcome is matched back on the
    Meshy task id - which the pipeline already has, already logs, and already
    stores in the step metadata.

    If the same task id somehow has several events, the most recent is the one
    finalized: a re-submitted task id means a retry, and the retry is the open
    one.
    """
    if not provider_ref:
        return
    db = _session()
    try:
        event = (
            db.query(UsageEvent)
            .filter(
                UsageEvent.provider == provider,
                UsageEvent.provider_ref == provider_ref,
            )
            .order_by(UsageEvent.created_at.desc())
            .first()
        )
        if event is None:
            logger.warning(
                "finalize_usage_by_provider_ref: no %s event for ref %s",
                provider, provider_ref,
            )
            return
        event_id = event.id
    except Exception:
        logger.error(
            "finalize_usage_by_provider_ref lookup failed for %s/%s",
            provider, provider_ref, exc_info=True,
        )
        return
    finally:
        db.close()

    finalize_usage(
        event_id,
        status=status,
        metadata=metadata,
        cost_usd_micros=cost_usd_micros,
    )
