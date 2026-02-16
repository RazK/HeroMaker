#!/usr/bin/env python3
"""
Check credit balances for all HeroMaker external services.
Usage: python scripts/check_balances.py

Reads keys from environment variables (or .env file if python-dotenv is installed).
Designed to be reused in the admin panel later.
"""

import os
import sys
import json

try:
    import requests
except ImportError:
    print("ERROR: requests not installed. Run: pip install requests")
    sys.exit(1)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # fine, will use env vars directly


# ── Meshy ─────────────────────────────────────────────────────────────────────

def get_meshy_balance(api_key: str) -> dict:
    """
    GET https://api.meshy.ai/openapi/v1/balance
    Returns: {"balance": 1000}
    """
    try:
        resp = requests.get(
            "https://api.meshy.ai/openapi/v1/balance",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=10
        )
        resp.raise_for_status()
        data = resp.json()
        return {"ok": True, "balance": data.get("balance"), "raw": data}
    except requests.HTTPError as e:
        return {"ok": False, "error": f"HTTP {e.response.status_code}: {e.response.text}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── OpenAI ────────────────────────────────────────────────────────────────────

def get_openai_balance(admin_key: str) -> dict:
    """
    Uses OpenAI Admin Key (sk-admin-...) with billing+usage read scopes.
    Requires OPENAI_ADMIN_KEY in .env (separate from OPENAI_API_KEY).
    Create at: https://platform.openai.com/settings/organization/admin-keys
    """
    if not admin_key or admin_key == "sk-admin-REPLACE_ME":
        return {
            "ok": False,
            "error": "OPENAI_ADMIN_KEY not set",
            "dashboard": "https://platform.openai.com/settings/organization/billing/credit-grants"
        }
    import time
    try:
        # Try credit grants endpoint with admin key
        resp = requests.get(
            "https://api.openai.com/v1/dashboard/billing/credit_grants",
            headers={"Authorization": f"Bearer {admin_key}"},
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            return {
                "ok": True,
                "balance": data.get("total_available"),
                "total_granted": data.get("total_granted"),
                "total_used": data.get("total_used"),
                "raw": data
            }

        # Try the newer costs API
        now = int(time.time())
        month_ago = now - 30 * 24 * 3600
        resp2 = requests.get(
            "https://api.openai.com/v1/organization/costs",
            headers={"Authorization": f"Bearer {admin_key}"},
            params={"start_time": month_ago, "end_time": now},
            timeout=10
        )
        if resp2.status_code == 200:
            data2 = resp2.json()
            total_cost = 0
            for bucket in data2.get("data", []):
                for result in bucket.get("results", []):
                    total_cost += float(result.get("amount", {}).get("value", 0))
            return {
                "ok": True,
                "balance": f"${round(total_cost, 4)} spent (last 30d)",
                "raw": data2
            }

        return {
            "ok": False,
            "error": f"HTTP {resp.status_code} — check key has billing+usage read scopes",
            "dashboard": "https://platform.openai.com/settings/organization/billing/credit-grants"
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Railway ───────────────────────────────────────────────────────────────────

def get_railway_balance(token: str) -> dict:
    """
    Railway uses GraphQL. Requires a Personal Access Token (PAT), not a project token.
    POST https://backboard.railway.com/graphql/v2
    Balance lives on workspace.customer, not on the user directly.
    """
    query = """
    query {
      me {
        email
        name
        workspaces {
          name
          plan
          customer {
            creditBalance
            remainingUsageCreditBalance
            currentUsage
          }
        }
      }
    }
    """
    try:
        resp = requests.post(
            "https://backboard.railway.com/graphql/v2",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            },
            json={"query": query},
            timeout=10
        )
        resp.raise_for_status()
        data = resp.json()
        if "errors" in data:
            return {"ok": False, "error": data["errors"][0].get("message", str(data["errors"]))}
        me = data.get("data", {}).get("me", {})
        workspaces = me.get("workspaces", [])
        ws = workspaces[0] if workspaces else {}
        customer = ws.get("customer", {})
        return {
            "ok": True,
            "balance": customer.get("remainingUsageCreditBalance"),
            "credit_balance": customer.get("creditBalance"),
            "current_usage": round(customer.get("currentUsage", 0), 4),
            "plan": ws.get("plan"),
            "workspace": ws.get("name"),
            "email": me.get("email"),
            "name": me.get("name"),
            "raw": ws
        }
    except requests.HTTPError as e:
        return {"ok": False, "error": f"HTTP {e.response.status_code}: {e.response.text}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Main ──────────────────────────────────────────────────────────────────────

def print_result(service: str, result: dict):
    if result["ok"]:
        balance = result.get("balance")
        extra = ""
        if service == "OpenAI" and "total_used" in result:
            extra = f"  (granted: {result['total_granted']}, used: {result['total_used']})"
        if service == "Railway" and result.get("email"):
            extra = f"  (plan: {result.get('plan')}, usage this period: ${result.get('current_usage')}, prepaid credits: {result.get('credit_balance')})"
        print(f"  ✅ {service}: {balance}{extra}")
    else:
        print(f"  ❌ {service}: {result['error']}")
        if "dashboard" in result:
            print(f"     → {result['dashboard']}")


def check_all() -> dict:
    results = {}

    print("\n=== HeroMaker Service Balances ===\n")

    # Meshy
    key = os.getenv("MESHY_API_KEY")
    if key:
        results["meshy"] = get_meshy_balance(key)
    else:
        results["meshy"] = {"ok": False, "error": "MESHY_API_KEY not set"}
    print_result("Meshy", results["meshy"])

    # OpenAI
    admin_key = os.getenv("OPENAI_ADMIN_KEY")
    results["openai"] = get_openai_balance(admin_key)
    print_result("OpenAI", results["openai"])

    # Railway
    token = os.getenv("RAILWAY_API_TOKEN")
    if token:
        results["railway"] = get_railway_balance(token)
    else:
        results["railway"] = {
            "ok": False,
            "error": "RAILWAY_API_TOKEN not set — add your Personal Access Token to .env",
            "dashboard": "https://railway.app/account/tokens"
        }
    print_result("Railway", results["railway"])

    print()
    return results


if __name__ == "__main__":
    check_all()
