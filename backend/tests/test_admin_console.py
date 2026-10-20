"""
The admin console's endpoints, driven through the real app:

  /api/admin/money/*      income, costs, net, provider balances, monthly bills
  /api/admin/coupons      create with a generated code
  /api/admin/users/{id}   delete, which now goes through account_deletion

Provider HTTP is faked at the `requests` boundary inside
app/services/provider_balances.py; everything else is the production code path.
"""
import json
from datetime import date, datetime, timedelta

import pytest
import requests
from fastapi.testclient import TestClient

from app.main import app
from app.models import Coupon, Payment, RecurringExpense, UsageEvent, User
from app.services import company_finance, provider_balances
from app.services.auth import create_access_token
from app.services.task_manager import get_task_manager

MONEY_ROUTES = [
    ("get", "/api/admin/money/summary"),
    ("get", "/api/admin/money/providers"),
    ("get", "/api/admin/money/lemonsqueezy"),
    ("get", "/api/admin/money/recurring"),
    ("post", "/api/admin/money/recurring"),
    ("patch", "/api/admin/money/recurring/x"),
    ("delete", "/api/admin/money/recurring/x"),
]


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def admin(make_user):
    return make_user(is_admin=True, username="theadmin")


@pytest.fixture
def as_admin(admin):
    return {"Authorization": f"Bearer {create_access_token(admin.id)}"}


@pytest.fixture(autouse=True)
def no_provider_env(monkeypatch):
    for key in ("MESHY_API_KEY", "OPENAI_ADMIN_KEY", "RAILWAY_API_TOKEN", "RAILWAY_PROJECT_ID"):
        monkeypatch.delenv(key, raising=False)
    provider_balances.clear_cache()
    yield
    provider_balances.clear_cache()


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("method,path", MONEY_ROUTES)
def test_money_routes_need_a_token(client, method, path):
    assert getattr(client, method)(path).status_code == 401


@pytest.mark.parametrize("method,path", MONEY_ROUTES)
def test_money_routes_refuse_a_non_admin(client, make_user, method, path):
    token = create_access_token(make_user(username="plain").id)
    r = getattr(client, method)(path, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

def _pay(db, user, ref, gross, fee, status="succeeded", test_mode=False, when=None):
    db.add(Payment(
        user_id=user.id, provider="lemonsqueezy", provider_ref=ref,
        gross_usd_micros=gross, fee_usd_micros=fee, net_usd_micros=gross - fee,
        status=status, metadata_json={"test_mode": test_mode},
        created_at=when or datetime.utcnow(),
    ))
    db.commit()


def _cost(db, provider, micros, when=None):
    db.add(UsageEvent(
        provider=provider, operation="op", units=1, cost_usd_micros=micros,
        status="succeeded", metadata_json={}, created_at=when or datetime.utcnow(),
    ))
    db.commit()


def test_summary_separates_test_orders_and_nets_out_costs(client, db, as_admin, make_user):
    buyer = make_user(credits=40, username="buyer")
    _pay(db, buyer, "live-1", 15_000_000, 1_250_000)
    _pay(db, buyer, "test-1", 5_000_000, 750_000, test_mode=True)
    _pay(db, buyer, "live-refunded", 5_000_000, 750_000, status="refunded")
    _cost(db, "openai", 167_000)
    _cost(db, "openai", 167_000)
    _cost(db, "meshy", 400_000)
    db.add(RecurringExpense(
        name="Railway plan", amount_usd_micros=5_000_000,
        started_on=date.today() - timedelta(days=1), is_active=True,
    ))
    db.commit()

    r = client.get("/api/admin/money/summary?period=all", headers=as_admin)
    assert r.status_code == 200
    s = r.json()

    assert s["income"]["live"] == {
        "gross_usd_micros": 15_000_000, "fee_usd_micros": 1_250_000,
        "net_usd_micros": 13_750_000, "count": 1,
    }
    assert s["income"]["test"]["count"] == 1
    assert s["income"]["test"]["gross_usd_micros"] == 5_000_000
    assert s["income"]["refunds"]["net_usd_micros"] == 4_250_000

    providers = {p["provider"]: p for p in s["costs"]["providers"]}
    assert providers["openai"] == {"provider": "openai", "cost_usd_micros": 334_000, "calls": 2}
    assert providers["meshy"]["cost_usd_micros"] == 400_000
    assert s["costs"]["providers_total_usd_micros"] == 734_000
    assert s["costs"]["recurring_usd_micros"] == 5_000_000  # charged once, yesterday

    # Test-mode money never counts toward net.
    assert s["net_usd_micros"] == 13_750_000 - 4_250_000 - 734_000 - 5_000_000

    assert s["credits_held"]["credits"] == 40
    assert s["credits_held"]["cost_to_serve_usd_micros"] == 40 * s["credits_held"]["cost_per_credit_usd_micros"]
    assert s["recurring"]["monthly_total_usd_micros"] == 5_000_000
    assert len(s["recurring"]["upcoming"]) == 1  # next month's charge, within 30 days


def test_summary_period_excludes_older_money(client, db, as_admin, make_user):
    buyer = make_user(username="buyer")
    long_ago = datetime.utcnow() - timedelta(days=90)
    _pay(db, buyer, "old", 15_000_000, 1_000_000, when=long_ago)
    _cost(db, "meshy", 400_000, when=long_ago)
    _pay(db, buyer, "new", 5_000_000, 500_000)

    s = client.get("/api/admin/money/summary?period=30d", headers=as_admin).json()
    assert s["income"]["live"]["count"] == 1
    assert s["income"]["live"]["gross_usd_micros"] == 5_000_000
    assert s["costs"]["providers"] == []

    s = client.get("/api/admin/money/summary?period=all", headers=as_admin).json()
    assert s["income"]["live"]["count"] == 2


def test_summary_rejects_an_unknown_period(client, as_admin):
    assert client.get("/api/admin/money/summary?period=forever", headers=as_admin).status_code == 422


def test_deleted_accounts_hold_no_credits(client, db, as_admin, make_user):
    gone = make_user(credits=10, username="gone")
    gone.deleted_at = datetime.utcnow()
    db.commit()
    s = client.get("/api/admin/money/summary", headers=as_admin).json()
    assert s["credits_held"]["credits"] == 0


def test_monthly_charges_clamp_to_short_months():
    e = RecurringExpense(name="x", amount_usd_micros=1, started_on=date(2026, 1, 31), is_active=True)
    dates = company_finance.charge_dates(e, date(2026, 1, 1), date(2026, 4, 30))
    assert dates == [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]
    assert company_finance.next_charge(e, date(2026, 2, 1)) == date(2026, 2, 28)


# ---------------------------------------------------------------------------
# Recurring expenses
# ---------------------------------------------------------------------------

def test_recurring_expense_lifecycle(client, as_admin):
    r = client.post("/api/admin/money/recurring", headers=as_admin,
                    json={"name": "Domain", "amount_usd": 1.5, "started_on": "2026-01-10"})
    assert r.status_code == 201
    item = r.json()
    assert item["amount_usd_micros"] == 1_500_000
    assert item["is_active"] is True

    r = client.patch(f"/api/admin/money/recurring/{item['id']}", headers=as_admin,
                     json={"amount_usd": 2, "is_active": False})
    assert r.status_code == 200
    assert r.json()["amount_usd_micros"] == 2_000_000
    assert r.json()["next_charge_on"] is None

    listed = client.get("/api/admin/money/recurring", headers=as_admin).json()
    assert [i["name"] for i in listed] == ["Domain"]

    assert client.delete(f"/api/admin/money/recurring/{item['id']}", headers=as_admin).status_code == 204
    assert client.get("/api/admin/money/recurring", headers=as_admin).json() == []
    assert client.delete(f"/api/admin/money/recurring/{item['id']}", headers=as_admin).status_code == 404


@pytest.mark.parametrize("body", [
    {"name": "", "amount_usd": 5},
    {"name": "Plan", "amount_usd": 0},
    {"name": "Plan", "amount_usd": -5},
    {"name": "Plan", "amount_usd": 10_000_000},
])
def test_recurring_expense_validation(client, as_admin, body):
    assert client.post("/api/admin/money/recurring", headers=as_admin, json=body).status_code == 422


# ---------------------------------------------------------------------------
# Provider balances
# ---------------------------------------------------------------------------

class _Resp:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body

    def json(self):
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code} with secret in url", response=self)


def test_unconfigured_providers_say_what_to_connect(client, as_admin):
    r = client.get("/api/admin/money/providers", headers=as_admin)
    assert r.status_code == 200
    by = {p["provider"]: p for p in r.json()["providers"]}
    assert set(by) == {"meshy", "openai", "railway"}
    assert all(p["status"] == "not_configured" for p in by.values())
    assert "OPENAI_ADMIN_KEY" in by["openai"]["hint"]
    assert "RAILWAY_API_TOKEN" in by["railway"]["hint"]


def test_configured_providers_report_balances(client, as_admin, monkeypatch):
    monkeypatch.setenv("MESHY_API_KEY", "msy-secret-meshy")
    monkeypatch.setenv("OPENAI_ADMIN_KEY", "sk-admin-secret-openai")
    monkeypatch.setenv("RAILWAY_API_TOKEN", "rw-secret-railway")
    monkeypatch.setenv("RAILWAY_PROJECT_ID", "proj-1")
    calls = []

    def fake_get(url, headers=None, params=None, timeout=None):
        calls.append(url)
        assert timeout
        if url == provider_balances.MESHY_BALANCE_URL:
            assert headers["Authorization"] == "Bearer msy-secret-meshy"
            return _Resp(200, {"balance": 1000, "monthly_credits": 600, "permanent_credits": 400,
                               "monthly_resets_at": 1793491200000})
        if url == provider_balances.OPENAI_COSTS_URL:
            assert headers["Authorization"] == "Bearer sk-admin-secret-openai"
            return _Resp(200, {"data": [
                {"results": [{"amount": {"value": 1.25, "currency": "usd"}}]},
                {"results": [{"amount": {"value": 0.5, "currency": "usd"}}]},
            ], "has_more": False})
        raise AssertionError(url)

    def fake_post(url, headers=None, json=None, timeout=None):
        calls.append(url)
        assert url == provider_balances.RAILWAY_GRAPHQL_URL
        assert json["variables"] == {"id": "proj-1"}
        return _Resp(200, {"data": {"project": {"name": "HeroMaker", "workspace": {
            "name": "Raz", "customer": {
                "currentUsage": 3.2, "creditBalance": 0.0, "remainingUsageCreditBalance": 1.8,
                "billingPeriod": {"start": "2026-10-01T00:00:00Z", "end": "2026-11-01T00:00:00Z"},
            }}}}})

    monkeypatch.setattr(provider_balances.requests, "get", fake_get)
    monkeypatch.setattr(provider_balances.requests, "post", fake_post)

    r = client.get("/api/admin/money/providers", headers=as_admin)
    assert r.status_code == 200
    by = {p["provider"]: p for p in r.json()["providers"]}
    assert by["meshy"]["status"] == "ok"
    assert by["meshy"]["credits"] == 1000
    assert by["meshy"]["value_usd_micros"] == 1000 * by["meshy"]["usd_micros_per_credit"]
    assert by["meshy"]["out_of_credit"] is False
    assert by["openai"]["month_to_date_usd_micros"] == 1_750_000
    assert by["railway"]["current_usage_usd_micros"] == 3_200_000
    assert by["railway"]["workspace"] == "Raz"
    assert "secret" not in r.text

    # Cached: a reload does not ask again.
    n = len(calls)
    again = client.get("/api/admin/money/providers", headers=as_admin).json()["providers"]
    assert len(calls) == n
    assert all(p["cached"] for p in again)
    # Unless asked to.
    client.get("/api/admin/money/providers?refresh=true", headers=as_admin)
    assert len(calls) == 2 * n


def test_meshy_below_one_3d_step_is_out_of_credit(client, as_admin, monkeypatch):
    """5 credits left and a 3D step costs 20: the console must say every 3D step fails."""
    monkeypatch.setenv("MESHY_API_KEY", "msy-secret-meshy")
    cost = provider_balances.pricing.MESHY_IMAGE_TO_3D_CREDITS

    def fake_get(url, headers=None, params=None, timeout=None):
        if url == provider_balances.MESHY_BALANCE_URL:
            return _Resp(200, {"balance": cost - 1})
        raise AssertionError(url)

    monkeypatch.setattr(provider_balances.requests, "get", fake_get)
    by = {p["provider"]: p for p in client.get("/api/admin/money/providers?refresh=true", headers=as_admin).json()["providers"]}
    assert by["meshy"]["out_of_credit"] is True
    assert by["meshy"]["step_credits"] == cost
    assert by["meshy"]["out_of_credit_effect"] == "every 3D step fails"

    def enough(url, headers=None, params=None, timeout=None):
        return _Resp(200, {"balance": cost})

    monkeypatch.setattr(provider_balances.requests, "get", enough)
    by = {p["provider"]: p for p in client.get("/api/admin/money/providers?refresh=true", headers=as_admin).json()["providers"]}
    assert by["meshy"]["out_of_credit"] is False


def test_a_failing_provider_is_one_error_card_with_no_secret(client, as_admin, monkeypatch, caplog):
    monkeypatch.setenv("MESHY_API_KEY", "msy-secret-meshy")
    monkeypatch.setenv("OPENAI_ADMIN_KEY", "sk-admin-secret-openai")

    def fake_get(url, headers=None, params=None, timeout=None):
        if url == provider_balances.MESHY_BALANCE_URL:
            return _Resp(401, {"message": "bad key msy-secret-meshy"})
        raise requests.Timeout("timed out talking with sk-admin-secret-openai")

    monkeypatch.setattr(provider_balances.requests, "get", fake_get)
    r = client.get("/api/admin/money/providers", headers=as_admin)
    assert r.status_code == 200
    by = {p["provider"]: p for p in r.json()["providers"]}
    assert by["meshy"]["status"] == "error"
    assert "401" in by["meshy"]["hint"]
    assert by["openai"]["status"] == "error"
    assert "in time" in by["openai"]["hint"]
    assert by["railway"]["status"] == "not_configured"
    assert "secret" not in r.text
    assert "secret" not in caplog.text


def test_railway_graphql_errors_are_reported_not_raised(client, as_admin, monkeypatch):
    monkeypatch.setenv("RAILWAY_API_TOKEN", "rw-secret-railway")
    monkeypatch.setenv("RAILWAY_PROJECT_ID", "proj-1")
    monkeypatch.setattr(provider_balances.requests, "post",
                        lambda *a, **k: _Resp(200, {"errors": [{"message": "Not Authorized"}]}))
    by = {p["provider"]: p for p in client.get("/api/admin/money/providers", headers=as_admin).json()["providers"]}
    assert by["railway"]["status"] == "error"


# ---------------------------------------------------------------------------
# Coupons
# ---------------------------------------------------------------------------

def test_coupon_without_a_code_gets_one(client, as_admin, db):
    r = client.post("/api/admin/coupons", headers=as_admin, json={"credit_amount": 25, "max_uses": 3})
    assert r.status_code == 201
    code = r.json()["code"]
    assert code.startswith("HERO-") and len(code) == 11
    assert db.query(Coupon).filter(Coupon.code == code).one().credit_amount == 25


@pytest.mark.parametrize("body", [{"credit_amount": 0}, {"credit_amount": 5, "max_uses": 0}])
def test_coupon_validation(client, as_admin, body):
    assert client.post("/api/admin/coupons", headers=as_admin, json=body).status_code == 422


# ---------------------------------------------------------------------------
# Deleting a user
# ---------------------------------------------------------------------------

class _NoTasks:
    def cancel_all_tasks_for_creation(self, creation_id):
        return 0


@pytest.fixture
def tasks():
    previous = app.dependency_overrides.get(get_task_manager)
    app.dependency_overrides[get_task_manager] = lambda: _NoTasks()
    yield
    if previous is None:
        app.dependency_overrides.pop(get_task_manager, None)
    else:
        app.dependency_overrides[get_task_manager] = previous


def test_admin_can_delete_a_paying_user(client, db, as_admin, make_user, make_creation, tasks):
    """A user with a payment and ledger rows: the old plain db.delete failed here."""
    victim = make_user(credits=30, username="victim")
    make_creation(victim.id)
    _pay(db, victim, "order-1", 15_000_000, 1_000_000)

    r = client.delete(f"/api/admin/users/{victim.id}", headers=as_admin)
    assert r.status_code == 200, r.text

    db.expire_all()
    row = db.query(User).filter(User.id == victim.id).one()
    assert row.deleted_at is not None
    assert row.email is None
    assert row.credits == 0
    assert db.query(Payment).filter(Payment.user_id == victim.id).count() == 1

    assert client.delete(f"/api/admin/users/{victim.id}", headers=as_admin).status_code == 404
    listed = client.get("/api/admin/users", headers=as_admin).json()
    assert victim.id not in [u["id"] for u in listed]


def test_admin_cannot_delete_themselves(client, admin, as_admin, tasks):
    assert client.delete(f"/api/admin/users/{admin.id}", headers=as_admin).status_code == 400


# ---------------------------------------------------------------------------
# The Users list: live accounts only, test accounts behind a toggle
# ---------------------------------------------------------------------------

@pytest.fixture
def mixed_users(db, make_user):
    """A real person, three kinds of test account, and a deleted account."""
    def user(username, email, deleted=False):
        u = make_user(username=username)
        u.email = email
        if deleted:
            u.deleted_at = datetime.utcnow()
        db.commit()
        return u
    return {
        "real": user("maya", "maya@gmail.com"),
        "lookalike": user("robotXfan", "robotxfan@gmail.com"),   # `_` must not act as a wildcard
        "robot": user("robot_mfz3k9", "robot+mfz3k9@example.com"),
        "robot_name_only": user("robot_abc", "abc@gmail.com"),
        "example_email": user("tester", "Tester@Example.com"),
        "deleted": user("deleted-abc", None, deleted=True),
    }


def _names(r):
    assert r.status_code == 200, r.text
    return {u["username"] for u in r.json()}


def test_users_list_hides_test_accounts_by_default(client, admin, as_admin, mixed_users):
    assert _names(client.get("/api/admin/users", headers=as_admin)) == {"theadmin", "maya", "robotXfan"}


def test_users_list_shows_test_accounts_when_asked_and_marks_them(client, admin, as_admin, mixed_users):
    r = client.get("/api/admin/users?include_test=true", headers=as_admin)
    assert _names(r) == {"theadmin", "maya", "robotXfan", "robot_mfz3k9", "robot_abc", "tester"}
    marked = {u["username"] for u in r.json() if u["is_test_account"]}
    assert marked == {"robot_mfz3k9", "robot_abc", "tester"}


def test_users_list_never_shows_deleted_accounts(client, admin, as_admin, mixed_users):
    for url in ("/api/admin/users", "/api/admin/users?include_test=true"):
        ids = {u["id"] for u in client.get(url, headers=as_admin).json()}
        assert mixed_users["deleted"].id not in ids


def test_users_count_counts_live_accounts_only(client, admin, as_admin, mixed_users):
    r = client.get("/api/admin/users/count", headers=as_admin)
    assert r.status_code == 200, r.text
    assert r.json() == {"users": 3, "test_accounts": 3}


def test_users_count_is_admin_only(client, make_user):
    assert client.get("/api/admin/users/count").status_code == 401
    token = create_access_token(make_user(username="plain").id)
    r = client.get("/api/admin/users/count", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
