"""The HeroMaker API: a drawing in, a rigged VRM avatar out.

One API for every client: the app (its login), other apps and agents (an API
key). What each may do is its scope (app/services/principal.py). Every hero
is charged to the account, and refunded the same way when a stage fails.
Human docs: /developers. Agent docs: /llms.txt.

    POST   /api/v1/heroes              start a hero from a drawing
    GET    /api/v1/heroes/{id}         status, stages, progress, time left, files
    GET    /api/v1/heroes              the account's heroes, newest first
    DELETE /api/v1/heroes/{id}         stop it (charges for stages already run stay)
    GET    /api/v1/estimates           how long a hero takes now, measured
    GET    /api/v1/account             credits left, cost of a hero

    POST/GET/DELETE /api/v1/keys       the account's keys (the app only: scope app)
"""
from __future__ import annotations

import base64
import binascii
import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiHero, ApiKey, Creation, User
from app.services import api_heroes, api_keys
from app.services.principal import APP, HEROES, Principal, require
from app.services.credits import get_balance
from app.services.task_manager import get_task_manager

logger = logging.getLogger(__name__)
router = APIRouter()

NAME_MAX = 60


def _error(status: int, message: str):
    return HTTPException(status_code=status, detail=message)


def openapi_spec(app, base: str) -> dict:
    """The public API alone, for /api/v1/openapi.json: no app or admin routes."""
    import copy

    public = ("/api/v1/heroes", "/api/v1/estimates", "/api/v1/account")
    full = copy.deepcopy(app.openapi())
    spec = {
        "openapi": full.get("openapi", "3.1.0"),
        "info": {"title": "HeroMaker API", "version": "1",
                 "description": "A drawing in, a rigged VRM humanoid avatar out, with every stage on the way. "
                                "Human docs: /developers. Agent docs: /llms.txt. MCP: /api/mcp."},
        "servers": [{"url": base}],
        "paths": {p: ops for p, ops in full.get("paths", {}).items() if p.startswith(public)},
        "components": full.get("components", {}),
    }
    schemas = spec["components"].setdefault("schemas", {})
    schemas.setdefault("CreateHero", CreateHero.model_json_schema())
    spec["components"]["securitySchemes"] = {"apiKey": {"type": "http", "scheme": "bearer", "description": "hm_sk_... or hm_pk_..."}}
    spec["security"] = [{"apiKey": []}]
    return spec


@router.get("/openapi.json", include_in_schema=False)
def openapi_json(request: Request):
    return openapi_spec(request.app, api_heroes.base_url(request))


@router.get("")
@router.get("/")
def index(request: Request):
    base = api_heroes.base_url(request)
    return {
        "object": "api",
        "version": "v1",
        "docs": f"{base}/developers",
        "openapi": f"{base}/api/v1/openapi.json",
        "llms": f"{base}/llms.txt",
        "mcp": f"{base}/api/mcp",
        "auth": "Authorization: Bearer <your API key> (make one on your HeroMaker account page)",
    }


@router.get("/estimates")
def estimates():
    """How long a hero takes right now, per stage and in total. No key needed."""
    return api_heroes.estimates_view()


@router.get("/account")
def account(who: Principal = Depends(require(HEROES)), db: Session = Depends(get_db)):
    key = who.api_key
    balance = get_balance(who.user_id, db)
    cost = api_heroes.hero_cost()
    out = {
        "object": "account",
        "credits": balance,
        "hero_cost_credits": cost,
        "heroes_affordable": balance // cost if cost else None,
        "key": api_keys.public_view(key) if key else None,
        "buy_credits": "https://heromaker.up.railway.app/?buy=1",
    }
    if key is not None and key.daily_limit is not None:
        out["heroes_started_last_24h"] = api_keys.started_today(db, key)
    return out


class CreateHero(BaseModel):
    image_url: Optional[str] = Field(None, description="https URL of the drawing (jpg, png, webp; max 15 MB)")
    image_base64: Optional[str] = Field(None, description="The drawing's bytes, base64 (a data: URL is fine too)")
    name: Optional[str] = Field(None, max_length=NAME_MAX, description="The hero's name. Omitted: HeroMaker names it.")
    style: Optional[str] = Field(None, description="Painting style key (GET /api/styles). Omitted: the default.")
    webhook_url: Optional[str] = Field(None, description="https URL to POST each finished stage to")
    client_ref: Optional[str] = Field(None, max_length=200, description="Your own id for this hero, echoed back")
    public: bool = Field(False, description="Show it in HeroMaker's public gallery")


async def _read_request(request: Request) -> tuple:
    """(drawing bytes, CreateHero) from multipart or JSON."""
    ctype = request.headers.get("content-type", "")
    if ctype.startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("drawing") or form.get("image") or form.get("file")
        fields = {k: v for k, v in form.items() if isinstance(v, str)}
        if "public" in fields:
            fields["public"] = fields["public"].lower() in ("1", "true", "yes", "on")
        body = CreateHero(**fields)
        if upload is not None and hasattr(upload, "read"):
            if body.image_url or body.image_base64:
                raise _error(400, "Send one drawing: a file, image_url or image_base64.")
            return await upload.read(), body
    else:
        try:
            body = CreateHero(**(await request.json()))
        except Exception as e:
            raise _error(400, f"Send JSON (image_url or image_base64) or multipart with a 'drawing' file. {e}")
    return await drawing_from(body)


async def drawing_from(body: CreateHero) -> tuple:
    """(drawing bytes, body) from image_base64 or image_url."""
    if body.image_base64 and body.image_url:
        raise _error(400, "Send one drawing: image_url or image_base64, not both.")
    if body.image_base64:
        raw = body.image_base64.split(",", 1)[1] if body.image_base64.startswith("data:") else body.image_base64
        try:
            data = base64.b64decode(raw, validate=True)
        except (binascii.Error, ValueError):
            raise _error(400, "image_base64 is not valid base64.")
        if len(data) > api_heroes.MAX_DRAWING_BYTES:
            raise _error(413, "The image is over 15 MB.")
        return data, body
    if body.image_url:
        import asyncio

        try:
            return await asyncio.to_thread(api_heroes.fetch_drawing, body.image_url), body
        except api_heroes.UnsafeURL as e:
            raise _error(400, f"image_url: {e}")
        except Exception as e:
            raise _error(400, f"Couldn't download image_url: {e}")
    raise _error(400, "No drawing: send a 'drawing' file (multipart), image_url or image_base64.")


_CREATE_BODY = {
    "requestBody": {
        "required": True,
        "content": {
            "application/json": {"schema": {"$ref": "#/components/schemas/CreateHero"}},
            "multipart/form-data": {"schema": {
                "type": "object",
                "properties": {"drawing": {"type": "string", "format": "binary"},
                               "name": {"type": "string"}, "style": {"type": "string"},
                               "webhook_url": {"type": "string"}, "client_ref": {"type": "string"},
                               "public": {"type": "boolean"}},
                "required": ["drawing"]}},
        },
    },
}


@router.post("/heroes", status_code=202, openapi_extra=_CREATE_BODY)
async def create_hero(
    request: Request,
    who: Principal = Depends(require(HEROES)),
    db: Session = Depends(get_db),
    task_manager=Depends(get_task_manager),
):
    """Start making a hero. Answers at once (202) with its id, cost and time estimate.

    Then poll GET /heroes/{id} (every 3-5 s is plenty), or pass webhook_url.
    402 if the account can't pay for a whole hero; 429 past a key's daily limit.
    """
    data, body = await _read_request(request)
    return start_api_hero(db, who, data, body, api_heroes.base_url(request), task_manager)


def start_api_hero(db: Session, who: Principal, data: bytes, body: CreateHero, base: str, task_manager) -> dict:
    """Checks, then the hero: shared by POST /heroes and the MCP create_hero tool.

    Must run on the event loop (start_pipeline creates an asyncio task)."""
    from app.api.creations import _checked_style, create_with_drawing, start_pipeline

    key = who.api_key
    if body.webhook_url:
        if key is None:
            raise _error(400, "webhook_url needs an API key: the calls are signed with its webhook secret.")
        try:
            api_heroes.check_public_url(body.webhook_url)
        except api_heroes.UnsafeURL as e:
            raise _error(400, f"webhook_url: {e}")
    style = _checked_style(body.style)
    if key is not None:
        api_keys.check_daily_limit(db, key)
    cost = api_heroes.hero_cost()
    balance = get_balance(who.user_id, db)
    if balance < cost:
        raise HTTPException(status_code=402, detail={
            "message": f"A hero costs {cost} credits; this account has {balance}. Buy credits on HeroMaker.",
            "credits": balance, "hero_cost_credits": cost,
        })
    owner = who.user
    creation = create_with_drawing(
        db, who.user_id, data,
        character_name=(body.name or "").strip()[:NAME_MAX] or None,
        name=owner.name, style=style, is_public=body.public,
    )
    # Made with a key: remember which (its daily limit, its webhook secret).
    api_hero = None
    if key is not None:
        api_hero = ApiHero(creation_id=creation.id, api_key_id=key.id, webhook_url=body.webhook_url,
                           client_ref=body.client_ref, api_base=base)
        db.add(api_hero)
        db.commit()
    start_pipeline(creation, db, task_manager, style=style)
    if body.webhook_url:
        api_heroes.watch(creation.id)
    db.refresh(creation)
    logger.info(f"[{creation.id}] API hero started by {'key ' + key.prefix + '…' if key else 'the app'}")
    return api_heroes.view(creation, base, api_hero=api_hero)


def _own_hero(db: Session, who: Principal, hero_id: str) -> tuple:
    """The hero, if the caller's account owns it (404 otherwise: ids don't leak)."""
    creation = db.query(Creation).filter(Creation.id == hero_id).first()
    if creation is None or creation.user_id != who.user_id:
        raise _error(404, "No such hero on this account.")
    api_hero = db.query(ApiHero).filter(ApiHero.creation_id == hero_id).first()
    return creation, api_hero


@router.get("/heroes/{hero_id}")
def get_hero(hero_id: str, request: Request, who: Principal = Depends(require(HEROES)), db: Session = Depends(get_db)):
    """The hero now: status, current stage, progress %, time left, and every file made so far."""
    creation, api_hero = _own_hero(db, who, hero_id)
    return api_heroes.view(creation, api_heroes.base_url(request), api_hero=api_hero)


@router.get("/heroes")
def list_heroes(
    request: Request,
    limit: int = Query(20, ge=1, le=100),
    client_ref: Optional[str] = Query(None),
    who: Principal = Depends(require(HEROES)),
    db: Session = Depends(get_db),
):
    """The account's heroes, newest first: made in the app or with any key."""
    return {"object": "list", "data": account_heroes(db, who, api_heroes.base_url(request), limit, client_ref)}


def account_heroes(db: Session, who: Principal, base: str, limit: int, client_ref: Optional[str] = None) -> list:
    """The account's heroes as the API shows them (never-started uploads left out)."""
    q = db.query(Creation).filter(Creation.user_id == who.user_id, Creation.deleted_at.is_(None))
    if client_ref:
        q = q.join(ApiHero, ApiHero.creation_id == Creation.id).filter(ApiHero.client_ref == client_ref)
    rows = [c for c in q.order_by(Creation.created_at.desc()).limit(limit * 2).all() if not c.never_started][:limit]
    refs = {r.creation_id: r for r in db.query(ApiHero).filter(ApiHero.creation_id.in_([c.id for c in rows])).all()} if rows else {}
    return [api_heroes.view(c, base, api_hero=refs.get(c.id)) for c in rows]


@router.delete("/heroes/{hero_id}")
def delete_hero(hero_id: str, request: Request, who: Principal = Depends(require(HEROES)),
                db: Session = Depends(get_db), task_manager=Depends(get_task_manager)):
    """Stop a hero being made and remove it. Stages already run stay charged."""
    creation, api_hero = _own_hero(db, who, hero_id)
    task_manager.cancel_all_tasks_for_creation(hero_id)
    if creation.deleted_at is None:
        creation.deleted_at = datetime.utcnow()
        db.commit()
    return {"object": "hero", "id": hero_id, "deleted": True}


# --- Keys: managed by the signed-in user from the app, not with a key.

class NewKey(BaseModel):
    name: str = Field(..., max_length=80)
    kind: str = Field("secret", description="'secret' (servers, agents) or 'publishable' (web pages)")
    allowed_origins: List[str] = Field(default_factory=list)
    daily_limit: Optional[int] = Field(None, ge=1, le=10000)


@router.post("/keys", status_code=201)
def create_key(body: NewKey, who: Principal = Depends(require(APP)), db: Session = Depends(get_db)):
    user = who.user
    """A new key. The key and its webhook secret are in this answer only: save them now."""
    row, key = api_keys.create_key(db, user, name=body.name, kind=body.kind,
                                   allowed_origins=body.allowed_origins, daily_limit=body.daily_limit)
    return {**api_keys.public_view(row), "key": key, "webhook_secret": row.webhook_secret}


@router.get("/keys")
def list_keys(who: Principal = Depends(require(APP)), db: Session = Depends(get_db)):
    user = who.user
    rows = (db.query(ApiKey).filter(ApiKey.user_id == user.id, ApiKey.revoked_at.is_(None))
            .order_by(ApiKey.created_at.desc()).all())
    return {"object": "list", "data": [api_keys.public_view(r) for r in rows]}


@router.delete("/keys/{key_id}")
def revoke_key(key_id: str, who: Principal = Depends(require(APP)), db: Session = Depends(get_db)):
    user = who.user
    row = db.query(ApiKey).filter(ApiKey.id == key_id, ApiKey.user_id == user.id).first()
    if row is None:
        raise _error(404, "No such key.")
    if row.revoked_at is None:
        row.revoked_at = datetime.utcnow()
        db.commit()
    return {"object": "key", "id": key_id, "revoked": True}
