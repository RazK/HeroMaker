"""
The admin finance endpoints: authentication, the JSON report and the
server-rendered HTML view.

Uses FastAPI's TestClient against a router assembled here, rather than importing
app.main - main.py runs migrations and a lifespan on import, which is not what a
unit test should drag in.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import finance
from app.database import SessionLocal, get_db
from app.models import Payment, UsageEvent
from app.services.auth import create_access_token

HAPPY_PATH = 567_000


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(finance.router, prefix="/api/admin/finance")

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


@pytest.fixture
def admin_token(make_user):
    return create_access_token(make_user(is_admin=True, username="theadmin").id)


@pytest.fixture
def plain_token(make_user):
    return create_access_token(make_user(username="notadmin").id)


def _seed_one_hero(db, user, creation_id):
    for provider, operation, step, cost in [
        ("openai", "images.edit", "openai_render", 167_000),
        ("meshy", "image-to-3d", "meshy_3d", 400_000),
        ("meshy", "rigging", "meshy_rig", 0),
        ("internal", "convert_vrm", "convert_vrm", 0),
    ]:
        db.add(UsageEvent(
            user_id=user.id, creation_id=creation_id, step_name=step,
            provider=provider, operation=operation, units=1,
            cost_usd_micros=cost, status="succeeded",
            created_at=datetime.utcnow(), metadata_json={},
        ))
    db.commit()


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("path", [
    "/api/admin/finance/margin",
    "/api/admin/finance/prices",
    "/api/admin/finance/ledger-consistency",
    "/api/admin/finance/margin.html",
])
def test_every_finance_route_requires_authentication(client, path):
    assert client.get(path).status_code == 401


@pytest.mark.parametrize("path", [
    "/api/admin/finance/margin",
    "/api/admin/finance/margin.html",
])
def test_a_normal_user_is_forbidden(client, plain_token, path):
    resp = client.get(path, headers={"Authorization": f"Bearer {plain_token}"})
    assert resp.status_code == 403


def test_a_garbage_token_is_rejected(client):
    resp = client.get(
        "/api/admin/finance/margin", headers={"Authorization": "Bearer not-a-jwt"}
    )
    assert resp.status_code == 401


def test_html_view_accepts_a_query_token_because_browsers_send_no_header(
    client, admin_token, plain_token
):
    """
    Documented trade-off in app/api/finance.py: the HTML page is opened by
    clicking a link, and a link carries no Authorization header.
    """
    ok = client.get(f"/api/admin/finance/margin.html?token={admin_token}")
    assert ok.status_code == 200
    # The escape hatch must not become a privilege escalation.
    assert client.get(f"/api/admin/finance/margin.html?token={plain_token}").status_code == 403
    # ...and it does not apply to the JSON routes.
    assert client.get(f"/api/admin/finance/margin?token={admin_token}").status_code == 401


def test_html_view_is_not_cached_and_leaks_no_referrer(client, admin_token):
    """A token in a URL must not end up in a cache or a Referer header."""
    resp = client.get(f"/api/admin/finance/margin.html?token={admin_token}")
    assert resp.headers["cache-control"] == "no-store"
    assert resp.headers["referrer-policy"] == "no-referrer"
    assert admin_token not in resp.text, "the page echoed the token back"


# ---------------------------------------------------------------------------
# The JSON report
# ---------------------------------------------------------------------------

def test_margin_json_reports_revenue_cost_and_margin(
    client, admin_token, make_user, make_creation, completed_steps, db
):
    user = make_user(credits=100, username="customer")
    creation = make_creation(user.id, completed_steps)
    _seed_one_hero(db, user, creation.id)
    db.add(Payment(
        user_id=user.id, provider="stripe", provider_ref="ch_api_1",
        gross_usd_micros=5_000_000, fee_usd_micros=175_000,
        net_usd_micros=4_825_000, status="succeeded",
        created_at=datetime.utcnow(), metadata_json={},
    ))
    db.commit()

    body = client.get(
        "/api/admin/finance/margin", headers={"Authorization": f"Bearer {admin_token}"}
    ).json()

    assert body["revenue"]["net_usd_micros"] == 4_825_000
    assert body["cost"]["total_usd_micros"] == HAPPY_PATH
    assert body["margin"]["gross_usd_micros"] == 4_825_000 - HAPPY_PATH
    assert body["heroes"]["completed"] == 1
    assert body["heroes"]["cost_per_successful_usd_micros"] == HAPPY_PATH
    assert body["free_tier"]["cost_usd_micros"] == 0
    assert body["price_table"]["meshy_usd_micros_per_credit"] == 20_000
    assert len(body["creations"]) == 1
    assert len(body["users"]) == 1


def test_margin_json_accepts_an_explicit_date_range(client, admin_token, make_user, make_creation, completed_steps, db):
    user = make_user(credits=10)
    creation = make_creation(user.id, completed_steps)
    _seed_one_hero(db, user, creation.id)

    today = datetime.utcnow().date().isoformat()
    headers = {"Authorization": f"Bearer {admin_token}"}

    # A bare date as `end` must mean the WHOLE of that day, otherwise today's
    # spend silently vanishes from today's report.
    body = client.get(
        f"/api/admin/finance/margin?start={today}&end={today}", headers=headers
    ).json()
    assert body["cost"]["total_usd_micros"] == HAPPY_PATH

    yesterday = (datetime.utcnow().date() - timedelta(days=1)).isoformat()
    body = client.get(
        f"/api/admin/finance/margin?start={yesterday}&end={yesterday}", headers=headers
    ).json()
    assert body["cost"]["total_usd_micros"] == 0


def test_bad_dates_give_400_not_500(client, admin_token):
    resp = client.get(
        "/api/admin/finance/margin?start=last-tuesday",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 400
    assert "YYYY-MM-DD" in resp.json()["detail"]


def test_prices_endpoint_exposes_the_table_and_its_check_date(client, admin_token):
    body = client.get(
        "/api/admin/finance/prices", headers={"Authorization": f"Bearer {admin_token}"}
    ).json()
    assert body["openai_image_usd_micros"] == 167_000
    assert body["meshy_image_to_3d_usd_micros"] == 400_000
    assert body["last_checked"]


# ---------------------------------------------------------------------------
# Ledger audit views
# ---------------------------------------------------------------------------

def test_user_ledger_endpoint_explains_a_balance(client, admin_token, make_user, db):
    from app.services import ledger

    user = make_user(credits=0)
    ledger.record_purchase(user.id, 20, db, external_ref="order-9")
    ledger.spend_credits(user.id, 3, db)

    body = client.get(
        f"/api/admin/finance/ledger/{user.id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    ).json()

    assert body["balance"]["cached"] == 17
    assert body["balance"]["ledger"] == 17
    assert body["balance"]["consistent"] is True
    assert {t["reason"] for t in body["transactions"]} == {"purchase", "spend"}
    purchase = next(t for t in body["transactions"] if t["reason"] == "purchase")
    assert purchase["external_ref"] == "order-9"


def test_ledger_consistency_endpoint_is_green_and_can_go_red(
    client, admin_token, make_user, db
):
    from app.models import User

    user = make_user(credits=10)
    headers = {"Authorization": f"Bearer {admin_token}"}

    body = client.get("/api/admin/finance/ledger-consistency", headers=headers).json()
    assert body["ok"] is True and body["drifted"] == []

    # Simulate the old bug: a raw write straight to the cache column.
    db.query(User).filter(User.id == user.id).update({"credits": 4242})
    db.commit()

    body = client.get("/api/admin/finance/ledger-consistency", headers=headers).json()
    assert body["ok"] is False
    assert body["drifted"][0]["user_id"] == user.id
    assert body["drifted"][0]["drift"] == 4232


# ---------------------------------------------------------------------------
# HTML
# ---------------------------------------------------------------------------

def test_html_view_renders_the_headline_numbers(
    client, admin_token, make_user, make_creation, completed_steps, db
):
    user = make_user(credits=100, username="htmluser")
    creation = make_creation(user.id, completed_steps)
    _seed_one_hero(db, user, creation.id)

    html = client.get(f"/api/admin/finance/margin.html?token={admin_token}").text

    assert "Margin report" in html
    assert "Cost per successful hero" in html
    assert "Cost of free tier" in html
    assert "Fully loaded per hero" in html
    assert "$0.5670" in html          # the hero's cost
    assert "htmluser" in html
    assert creation.id in html
    assert "<table" in html
    # No JS, no build step, no CDN.
    assert "<script" not in html


def test_html_view_survives_an_empty_database(client, admin_token):
    resp = client.get(f"/api/admin/finance/margin.html?token={admin_token}")
    assert resp.status_code == 200
    assert "no provider calls in range" in resp.text


def test_html_escapes_user_supplied_text(client, admin_token, make_user, make_creation, db):
    """A username is user-supplied. It must not be able to inject markup."""
    user = make_user(username="<img src=x onerror=alert(1)>")
    creation = make_creation(user.id)
    _seed_one_hero(db, user, creation.id)

    html = client.get(f"/api/admin/finance/margin.html?token={admin_token}").text
    assert "<img src=x" not in html
    assert "&lt;img src=x" in html
