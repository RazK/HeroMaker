"""Analytics events from the browser (docs/analytics/REQUIREMENTS.md).

POST /api/v1/events takes a small batch from the app's own client
(frontend/src/analytics.ts). It never slows or breaks the app: the client
sends in the background and ignores the answer.

Who is signed in comes from the session token, never from the body. The body
is read as JSON whatever its content type, because a page that is closing may
send it with navigator.sendBeacon, which cannot say "application/json" without
a preflight.

The allow-list lives in app/services/analytics.py. This module stores nothing
about the request itself: no IP address, no user agent.
"""
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.services import analytics
from app.services.principal import Principal, optional

router = APIRouter()


@router.post("/events", include_in_schema=False)
async def record_events(
    request: Request,
    who: Optional[Principal] = Depends(optional()),
    db: Session = Depends(get_db),
):
    raw = await request.body()
    if len(raw) > analytics.MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Too many events at once")
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="Body must be JSON")
    # An API key is a program, not a visitor's account.
    user = who.user if who is not None and who.api_key is None else None
    try:
        return analytics.record_browser(db, payload, user)
    except analytics.Rejected as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get("/events/mine", include_in_schema=False)
def my_events(visitor: str = Query(...), db: Session = Depends(get_db)):
    """What is stored for this browser's own visitor id (event names only).
    The id is a random secret only that browser holds."""
    try:
        return {"events": analytics.visitor_events(db, visitor)}
    except analytics.Rejected as exc:
        raise HTTPException(status_code=422, detail=str(exc))
