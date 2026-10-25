"""The MCP server (/api/mcp): an agent makes a hero with tools.

Same real pipeline as tests/test_public_api.py, providers stood in for.
"""
import base64

from test_public_api import HERO_COST, _bearer, _key, _png, client  # noqa: F401  (fixture)


def rpc(client, method, params=None, key=None, id_=1):
    headers = {"Accept": "application/json, text/event-stream"}
    if key:
        headers.update(_bearer(key))
    msg = {"jsonrpc": "2.0", "method": method, "params": params or {}}
    if id_ is not None:
        msg["id"] = id_
    return client.post("/api/mcp", json=msg, headers=headers)


def call(client, key, name, args=None):
    r = rpc(client, "tools/call", {"name": name, "arguments": args or {}}, key=key)
    assert r.status_code == 200, r.text
    return r.json()["result"]


def test_handshake_and_tool_list_need_no_key(client):
    r = rpc(client, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                   "clientInfo": {"name": "t", "version": "1"}})
    res = r.json()["result"]
    assert res["protocolVersion"] == "2025-06-18"
    assert res["serverInfo"]["name"] == "heromaker" and "VRM" in res["instructions"]
    assert rpc(client, "notifications/initialized", id_=None).status_code == 202
    names = [t["name"] for t in rpc(client, "tools/list").json()["result"]["tools"]]
    assert names == ["create_hero", "get_hero", "wait_for_hero", "list_heroes", "get_estimates", "get_account"]


def test_tools_need_a_key(client):
    r = rpc(client, "tools/call", {"name": "get_estimates", "arguments": {}})
    assert r.status_code == 401 and r.json()["error"]["code"] == -32001


def test_an_agent_makes_a_hero_and_waits_for_it(client, make_user, db):
    from app.services import ledger

    user = make_user(credits=30)
    key = _key(client, user)["key"]
    assert call(client, key, "get_account")["structuredContent"]["heroes_affordable"] == 3

    made = call(client, key, "create_hero", {"image_base64": base64.b64encode(_png()).decode(), "name": "Agent Ace"})
    assert made["isError"] is False
    hero_id = made["structuredContent"]["id"]
    assert "wait_for_hero" in made["content"][0]["text"]

    done = call(client, key, "wait_for_hero", {"hero_id": hero_id, "timeout_seconds": 20})["structuredContent"]
    assert done["status"] == "completed"
    assert done["files"]["avatar_optimized"].endswith("/opt_avatar.vrm")
    db.expire_all()
    assert ledger.get_balance(user.id, db) == 30 - HERO_COST

    listed = call(client, key, "list_heroes")["structuredContent"]["heroes"]
    assert [h["id"] for h in listed] == [hero_id]


def test_tool_errors_are_results_not_crashes(client, make_user):
    key = _key(client, make_user(credits=0))["key"]
    broke = call(client, key, "create_hero", {"image_base64": base64.b64encode(_png()).decode()})
    assert broke["isError"] is True and "credits" in broke["content"][0]["text"]
    missing = call(client, key, "get_hero", {"hero_id": "nope"})
    assert missing["isError"] is True
    unknown = call(client, key, "make_coffee")
    assert unknown["isError"] is True


def test_unknown_method(client):
    r = rpc(client, "resources/list")
    assert r.json()["error"]["code"] == -32601
