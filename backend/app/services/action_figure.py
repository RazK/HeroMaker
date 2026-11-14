"""The hero as an action figure: the owner pays credits, Hi3D cuts it into
printable parts with ball joints (app/services/print_split.py, provider hi3d).

The money rules are the pipeline's (CLAUDE.md, "Payments"): credits are taken
BEFORE the provider is called, so every bad ending gives them back.

- Anything that can be known without spending is checked first: the hero is
  finished and has a model, Hi3D is configured. Those answer without charging.
- The provider refusing to start (our Hi3D balance empty, an error) refunds at
  once, and the owner is told it is "not available right now".
- A split that ends FAILED is refunded the first time anyone reads it (the
  owner's GET, or the admin's), once: the refund is keyed on the spend row
  (credits.refund_last_step_charge), so a reread is a no-op.
- A split running or done is returned as it is; a second POST never charges.

The state is the hero's one print_split.json, marked with what was charged.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.config.packs import ACTION_FIGURE_CREDITS
from app.models import Creation
from app.services import credits, ledger, print_split
from app.services.print_split import SplitError
from app.utils.storage import get_storage

logger = logging.getLogger(__name__)

STEP = "action_figure"
UNAVAILABLE = "Action figures are not available right now."
FAILED = "That didn't work this time. Your credits are back."


def _mine(state: Optional[Dict[str, Any]]) -> bool:
    """A Hi3D split, which is what the owner sees; an admin's Meshy split is not theirs."""
    return bool(state) and state.get("provider") == "hi3d"


def start(db: Session, creation: Creation, user_id: str, hi3d_client=None) -> Dict[str, Any]:
    from app.services import hi3d

    state = print_split.read_state(creation)
    if _mine(state) and state["status"] in print_split.RUNNING + ("SUCCEEDED",):
        return state
    if state and state.get("status") in print_split.RUNNING:
        raise SplitError(409, "busy", "This hero is being cut right now. Try again in a minute.")
    if creation.status != "completed" or not get_storage().file_exists(
            creation.user_id, creation.id, print_split.SOURCE_MODEL):
        raise SplitError(409, "not_ready", "This hero isn't finished yet.")
    try:
        client = hi3d_client or hi3d.Hi3dClient()
    except hi3d.Hi3dNotConfigured:
        raise SplitError(503, "unavailable", UNAVAILABLE)

    try:
        spend = ledger.spend_credits(user_id, ACTION_FIGURE_CREDITS, db, creation_id=creation.id, step_name=STEP,
                                     metadata={"what": "action figure", "provider": "hi3d"})
    except credits.InsufficientCreditsError:
        raise SplitError(402, "insufficient_credits",
                         f"An action figure is {ACTION_FIGURE_CREDITS} credits.")

    try:
        state = print_split.start(db, creation, by_user_id=user_id, provider="hi3d", part="a", joint="ball",
                                  hi3d_client=client)
    except SplitError as e:
        credits.refund_last_step_charge(db, creation.id, STEP, note=f"action figure did not start: {e.code}")
        logger.warning("[%s] Action figure did not start (%s: %s); refunded", creation.id, e.code, e.message)
        raise SplitError(503, "unavailable", f"{UNAVAILABLE} Your credits are back.")

    state.update(kind="action_figure", charged_tx=spend.id, charged_at=spend.created_at.isoformat(),
                 credits=ACTION_FIGURE_CREDITS, refunded=False)
    print_split._write_state(creation, state)
    return state


def settle(db: Session, creation: Creation, state: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Give the credits back for a paid split that ended badly. Safe to call on every read."""
    if not state or not state.get("charged_tx") or state.get("refunded"):
        return state
    if state.get("status") not in ("FAILED", "CANCELED"):
        return state
    since = None
    try:
        since = datetime.fromisoformat(state["charged_at"])
    except (KeyError, TypeError, ValueError):
        pass
    credits.refund_last_step_charge(db, creation.id, STEP, note="action figure failed", charged_since=since)
    state["refunded"] = True
    print_split._write_state(creation, state)
    logger.info("[%s] Action figure %s failed; refunded", creation.id, state.get("task_id"))
    return state


def refresh(db: Session, creation: Creation) -> Optional[Dict[str, Any]]:
    return settle(db, creation, print_split.refresh(creation))


def view(creation: Creation, base: str, state: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """What the owner's app reads: the price, and the figure once it is made."""
    out = print_split.view(creation, base, state if _mine(state) else None)
    out["object"] = "action_figure"
    out["price_credits"] = ACTION_FIGURE_CREDITS
    if out["status"] in ("failed", "canceled"):
        out["error"] = FAILED if (state or {}).get("refunded") or not (state or {}).get("charged_tx") else out["error"]
    return out
