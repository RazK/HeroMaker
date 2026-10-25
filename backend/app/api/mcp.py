"""HeroMaker as an MCP server: agents make heroes with tools.

Streamable HTTP transport, stateless: every request is one JSON-RPC message
POSTed to /api/mcp and answered as JSON (no session, no server-sent stream). The
caller authenticates with a HeroMaker API key, like the REST API (app/api/v1.py),
whose code the tools call: same checks, same billing, same answers.

Add it to an MCP client as:

    {"mcpServers": {"heromaker": {"type": "http", "url": "https://<host>/api/mcp",
                                  "headers": {"Authorization": "Bearer hm_sk_..."}}}}
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy.orm import Session

from app.api import v1
from app.database import get_db
from app.services import api_heroes, api_keys, principal
from app.services.principal import Principal
from app.services.credits import get_balance
from app.services.task_manager import get_task_manager
from app.version import get_version

logger = logging.getLogger(__name__)
router = APIRouter()

PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")
WAIT_MAX_SECONDS = 50  # under common 60 s client and proxy timeouts

INSTRUCTIONS = (
    "HeroMaker turns a drawing (a photo of a child's drawing, a sketch, any character picture) "
    "into a rigged, animatable 3D VRM humanoid avatar. Flow: create_hero with an image_url or "
    "image_base64 -> it returns at once with an id and an ETA (typically ~4 minutes, see "
    "get_estimates) -> call wait_for_hero repeatedly (each call waits up to ~50 s) until status is "
    "'completed' or 'failed'. Intermediate files appear as each stage finishes: painting (PNG), "
    "model (GLB, no skeleton), rigged (GLB), avatar (VRM). Use files.avatar_optimized for games and "
    "the web (about 5x smaller, same look). Each hero costs credits from the key owner's account "
    "(get_account); a failed stage is refunded."
)

_IMAGE_PROPS = {
    "image_url": {"type": "string", "description": "https URL of the drawing (jpg/png/webp, max 15 MB)"},
    "image_base64": {"type": "string", "description": "The drawing's bytes as base64 (or a data: URL). Use instead of image_url."},
}

TOOLS = [
    {
        "name": "create_hero",
        "title": "Make a hero from a drawing",
        "description": "Start turning a drawing into a rigged 3D VRM avatar. Returns at once with the hero's id, "
                       "status, stages, cost and estimated time. Then call wait_for_hero. Costs credits.",
        "inputSchema": {
            "type": "object",
            "properties": {
                **_IMAGE_PROPS,
                "name": {"type": "string", "maxLength": 60, "description": "The hero's name (optional; HeroMaker names it otherwise)"},
                "style": {"type": "string", "description": "Painting style key (optional)"},
                "client_ref": {"type": "string", "maxLength": 200, "description": "Your own id for this hero (optional)"},
                "public": {"type": "boolean", "description": "Show it in HeroMaker's public gallery (default false)"},
            },
        },
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False, "openWorldHint": True},
    },
    {
        "name": "get_hero",
        "title": "Check a hero",
        "description": "A hero's status now: current stage, progress %, seconds left, and the URL of every file made so far.",
        "inputSchema": {"type": "object", "properties": {"hero_id": {"type": "string"}}, "required": ["hero_id"]},
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
    {
        "name": "wait_for_hero",
        "title": "Wait for a hero",
        "description": "Wait until the hero is finished (or failed), or until it reaches `until_stage`, for at most "
                       f"timeout_seconds (max {WAIT_MAX_SECONDS}). Returns the hero either way: call again if it "
                       "is still processing.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "hero_id": {"type": "string"},
                "until_stage": {"type": "string", "enum": ["cleanup", "painting", "model", "rig", "avatar"],
                                "description": "Return as soon as this stage is done (optional)"},
                "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": WAIT_MAX_SECONDS},
            },
            "required": ["hero_id"],
        },
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
    {
        "name": "list_heroes",
        "title": "List heroes",
        "description": "Heroes made through the API on this account, newest first.",
        "inputSchema": {"type": "object", "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 50}}},
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
    {
        "name": "get_estimates",
        "title": "How long a hero takes",
        "description": "Typical (median) and 90th-percentile time of each stage and in total, measured on recent heroes, and the cost.",
        "inputSchema": {"type": "object", "properties": {}},
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
    {
        "name": "get_account",
        "title": "Credits left",
        "description": "Credits on the key owner's account and how many heroes that pays for.",
        "inputSchema": {"type": "object", "properties": {}},
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
]


class ToolError(Exception):
    pass


def _summary(hero: dict) -> str:
    """One line a person (or a model) can read before the JSON."""
    s = hero["status"]
    name = hero.get("name") or "The hero"
    if s == "completed":
        return f"{name} is ready. VRM: {hero['files'].get('avatar_optimized') or hero['files'].get('avatar')}"
    if s == "failed":
        e = hero.get("error") or {}
        return f"{name} failed at {e.get('stage')}: {e.get('message')}"
    if s == "cancelled":
        return f"{name} was cancelled."
    eta = hero.get("eta") or {}
    return f"{name}: {s}, stage '{hero.get('stage')}', {hero.get('progress')}% done, about {eta.get('seconds_left')} s left."


def _result(payload: Any, text: Optional[str] = None) -> dict:
    body = json.loads(json.dumps(payload, default=str))
    content = [{"type": "text", "text": (text + "\n\n" if text else "") + json.dumps(body, indent=1)}]
    return {"content": content, "structuredContent": body, "isError": False}


def _stage_done(hero: dict, stage: str) -> bool:
    return any(s["stage"] == stage and s["status"] == "completed" for s in hero["stages"])


async def _call(name: str, args: dict, who: Principal, db: Session, base: str, task_manager) -> dict:
    if name == "get_estimates":
        return _result(api_heroes.estimates_view())
    if name == "get_account":
        balance = get_balance(who.user_id, db)
        cost = api_heroes.hero_cost()
        return _result({"credits": balance, "hero_cost_credits": cost, "heroes_affordable": balance // cost},
                       f"{balance} credits: enough for {balance // cost} heroes.")
    if name == "create_hero":
        body = v1.CreateHero(**{k: args[k] for k in ("image_url", "image_base64", "name", "style", "client_ref", "public") if k in args})
        data, body = await v1.drawing_from(body)
        hero = v1.start_api_hero(db, who, data, body, base, task_manager)
        return _result(hero, _summary(hero) + " Call wait_for_hero with this id.")
    if name == "list_heroes":
        limit = max(1, min(50, int(args.get("limit") or 10)))
        heroes = v1.account_heroes(db, who, base, limit)
        return _result({"heroes": heroes}, "\n".join(_summary(h) for h in heroes) or "No heroes yet.")
    if name in ("get_hero", "wait_for_hero"):
        hero_id = args.get("hero_id")
        if not hero_id:
            raise ToolError("hero_id is required")
        creation, api_hero = v1._own_hero(db, who, hero_id)
        hero = api_heroes.view(creation, base, api_hero=api_hero)
        if name == "wait_for_hero":
            until = args.get("until_stage")
            deadline = time.monotonic() + max(1, min(WAIT_MAX_SECONDS, int(args.get("timeout_seconds") or WAIT_MAX_SECONDS)))
            while hero["status"] in ("queued", "processing") and not (until and _stage_done(hero, until)) \
                    and time.monotonic() < deadline:
                await asyncio.sleep(2)
                db.expire_all()
                hero = api_heroes.view(creation, base, api_hero=api_hero)
        return _result(hero, _summary(hero))
    raise ToolError(f"Unknown tool: {name}")


def _rpc_error(id_, code: int, message: str, status: int = 200) -> JSONResponse:
    return JSONResponse({"jsonrpc": "2.0", "id": id_, "error": {"code": code, "message": message}}, status_code=status)


@router.get("/api/mcp")
def mcp_get():
    # No server-initiated stream in this stateless server.
    return Response(status_code=405, headers={"Allow": "POST"})


@router.post("/api/mcp")
async def mcp(request: Request, db: Session = Depends(get_db), task_manager=Depends(get_task_manager)):
    try:
        msg = await request.json()
    except Exception:
        return _rpc_error(None, -32700, "Parse error", 400)
    if isinstance(msg, list):
        return _rpc_error(None, -32600, "Batches are not supported", 400)
    method, id_, params = msg.get("method"), msg.get("id"), msg.get("params") or {}
    if id_ is None:  # a notification (e.g. notifications/initialized): nothing to answer
        return Response(status_code=202)

    if method == "initialize":
        asked = params.get("protocolVersion")
        return JSONResponse({"jsonrpc": "2.0", "id": id_, "result": {
            "protocolVersion": asked if asked in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0],
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "heromaker", "title": "HeroMaker", "version": get_version()},
            "instructions": INSTRUCTIONS,
        }})
    if method == "ping":
        return JSONResponse({"jsonrpc": "2.0", "id": id_, "result": {}})
    if method == "tools/list":
        return JSONResponse({"jsonrpc": "2.0", "id": id_, "result": {"tools": TOOLS}})
    if method != "tools/call":
        return _rpc_error(id_, -32601, f"Method not found: {method}")

    # Tools need a key. Without one: HTTP 401, so clients can prompt for it.
    try:
        auth = request.headers.get("authorization")
        who = principal.resolve(db, api_keys._bearer(auth, request.headers.get("x-api-key")), request.headers.get("origin"))
    except HTTPException as e:
        return _rpc_error(id_, -32001, str(e.detail), e.status_code)

    name, args = params.get("name"), params.get("arguments") or {}
    try:
        result = await _call(name, args, who, db, api_heroes.base_url(request), task_manager)
    except HTTPException as e:
        detail = e.detail if isinstance(e.detail, str) else (e.detail or {}).get("message") or json.dumps(e.detail)
        result = {"content": [{"type": "text", "text": detail}], "isError": True}
    except (ToolError, ValueError) as e:
        result = {"content": [{"type": "text", "text": str(e)}], "isError": True}
    return JSONResponse({"jsonrpc": "2.0", "id": id_, "result": result})
