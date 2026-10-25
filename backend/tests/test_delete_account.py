"""Deleting a whole account: DELETE /api/v1/me.

The privacy policy promises the account "is removed immediately [...] except
purchase records, which we keep as required by law". These drive the real
endpoint, with a purchase made through the real signed webhook, against both
storage backends: the real S3FileStorage over an in-memory bucket, and the
real LocalFileStorage over a temp directory.
"""
import hashlib
import hmac
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import (
    Creation,
    CreationStep,
    CreditTransaction,
    PasswordResetToken,
    Payment,
    UsageEvent,
    User,
)
from app.services import account_deletion, ledger, password_reset
from app.services.auth import create_access_token
from app.services.task_manager import get_task_manager
from app.utils import storage as storage_mod
from app.utils.storage import S3FileStorage

WEBHOOK_SECRET = "test-webhook-secret"


# --------------------------------------------------------------------------
# An in-memory bucket behind the real S3FileStorage
# --------------------------------------------------------------------------

class _Paginator:
    def __init__(self, bucket, page_size):
        self.bucket, self.page_size = bucket, page_size

    def paginate(self, Bucket, Prefix):
        keys = sorted(k for k in self.bucket.objects if k.startswith(Prefix))
        if not keys:
            yield {"KeyCount": 0}
        for i in range(0, len(keys), self.page_size):
            yield {"Contents": [{"Key": k} for k in keys[i:i + self.page_size]]}


class FakeBucket:
    """Just enough of boto3's S3 client for upload, list and delete."""

    def __init__(self, page_size=3):
        self.objects: dict[str, bytes] = {}
        self.page_size = page_size  # small, so pagination is exercised

    def put_object(self, Bucket, Key, Body, **kw):
        self.objects[Key] = Body

    def delete_object(self, Bucket, Key):
        self.objects.pop(Key, None)

    def list_objects_v2(self, Bucket, Prefix):
        keys = [k for k in self.objects if k.startswith(Prefix)]
        return {"Contents": [{"Key": k} for k in keys]} if keys else {}

    def get_paginator(self, name):
        assert name == "list_objects_v2"
        return _Paginator(self, self.page_size)

    def delete_objects(self, Bucket, Delete):
        assert len(Delete["Objects"]) <= 1000
        for obj in Delete["Objects"]:
            self.objects.pop(obj["Key"], None)
        return {}

    def keys_for(self, user_id):
        return sorted(k for k in self.objects if k.startswith(f"{user_id}/"))


def _s3_storage():
    store = S3FileStorage.__new__(S3FileStorage)
    store.bucket_name = "bucket"
    store.s3_client = FakeBucket()
    return store


class _RecordingTasks:
    def __init__(self):
        self.cancelled = []

    def cancel_all_tasks_for_creation(self, creation_id):
        self.cancelled.append(creation_id)
        return 0


@pytest.fixture
def tasks():
    fake = _RecordingTasks()
    previous = app.dependency_overrides.get(get_task_manager)
    app.dependency_overrides[get_task_manager] = lambda: fake
    yield fake
    if previous is None:
        app.dependency_overrides.pop(get_task_manager, None)
    else:
        app.dependency_overrides[get_task_manager] = previous


@pytest.fixture
def s3(monkeypatch):
    store = _s3_storage()
    monkeypatch.setattr(account_deletion, "get_storage", lambda: store)
    return store


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("LEMONSQUEEZY_API_KEY", "test-api-key")
    monkeypatch.setenv("LEMONSQUEEZY_STORE_ID", "12345")
    monkeypatch.setenv("LEMONSQUEEZY_WEBHOOK_SECRET", WEBHOOK_SECRET)
    monkeypatch.setenv("LEMONSQUEEZY_TEST_MODE", "true")
    for pack in ("starter", "maker", "studio"):
        monkeypatch.setenv(f"LEMONSQUEEZY_VARIANT_{pack.upper()}", f"variant-{pack}")


@pytest.fixture
def client():
    return TestClient(app)


def _buy(client, user_id, order_id):
    """A real purchase: a signed order_created webhook for the maker pack."""
    body = {
        "meta": {"event_name": "order_created", "custom_data": {"user_id": user_id, "pack": "maker"}},
        "data": {"type": "orders", "id": str(order_id), "attributes": {
            "order_number": 4242, "status": "paid", "total": 1500, "total_usd": 1500,
            "currency": "USD", "user_email": "buyer@example.test", "refunded": False,
            "test_mode": True,
        }},
    }
    raw = json.dumps(body).encode()
    sig = hmac.new(WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    r = client.post("/api/payments/webhook", content=raw,
                    headers={"X-Signature": sig, "Content-Type": "application/json"})
    assert r.status_code == 200 and r.json()["status"] == "ok", r.text


HERO_FILES = ("original.jpg", "rendered.png", "thumb_rendered.png", "model.vrm", "opt_model.vrm")


def _account(db, client, make_user, make_creation, completed_steps, store, username, order_id):
    """A paying user with two heroes (one already deleted), files, a usage row,
    a spend on a hero and an outstanding password reset."""
    user = make_user(username=username)
    user.name, user.google_id = f"{username} Real Name", f"google-{username}"
    db.commit()
    _buy(client, user.id, order_id)
    live = make_creation(user.id, completed_steps)
    gone = make_creation(user.id, {"openai_render": "completed"})
    db.get(Creation, gone.id).deleted_at = live.created_at
    db.commit()
    for hero in (live, gone):
        for name in HERO_FILES:
            store.upload_file(user.id, hero.id, name, b"bytes")
    ledger.post(db=db, user_id=user.id, delta=-10, reason="spend", creation_id=live.id)
    db.add(UsageEvent(user_id=user.id, creation_id=live.id, provider="openai",
                      operation="images.edit", cost_usd_micros=40_000, status="succeeded"))
    db.commit()
    password_reset.create_token(db, user)
    db.refresh(user)
    return user, [live.id, gone.id]


def _delete(client, user, confirm=None):
    return client.request(
        "DELETE", "/api/v1/me",
        headers={"Authorization": f"Bearer {create_access_token(user.id)}"},
        json={"confirm": user.username if confirm is None else confirm},
    )


# --------------------------------------------------------------------------
# The promise
# --------------------------------------------------------------------------

def test_delete_account_removes_everything_but_anonymised_purchases(
    db, client, configured, s3, tasks, make_user, make_creation, completed_steps,
):
    me, my_heroes = _account(db, client, make_user, make_creation, completed_steps, s3, "itai", 9001)
    other, other_heroes = _account(db, client, make_user, make_creation, completed_steps, s3, "noa", 9002)
    token = create_access_token(me.id)
    me_id, other_before = me.id, s3.s3_client.keys_for(other.id)
    assert len(s3.s3_client.keys_for(me_id)) == 2 * len(HERO_FILES)
    assert db.query(Payment).filter(Payment.user_id == me_id).count() == 1

    response = _delete(client, me)
    assert response.status_code == 204, response.text
    assert response.content == b""
    db.expire_all()

    # Files: every object under the user's prefix, thumb_ and opt_ included.
    assert s3.s3_client.keys_for(me_id) == []
    # Creations and steps, including the hero that was only marked deleted.
    assert db.query(Creation).filter(Creation.id.in_(my_heroes)).count() == 0
    assert db.query(CreationStep).filter(CreationStep.creation_id.in_(my_heroes)).count() == 0
    assert db.query(PasswordResetToken).filter(PasswordResetToken.user_id == me_id).count() == 0
    # Running steps were stopped first.
    assert sorted(tasks.cancelled) == sorted(my_heroes)

    # The row that remains identifies nobody, and the email/Google id are free.
    row = db.get(User, me_id)
    assert row.deleted_at is not None
    assert (row.email, row.google_id, row.name, row.date_of_birth, row.password_hash) == (None,) * 5
    assert row.username.startswith("deleted-") and "itai" not in row.username
    assert row.is_admin is False

    # Purchase kept for tax: date, pack, money, provider order id. No email.
    payment = db.query(Payment).filter(Payment.user_id == me_id).one()
    assert payment.provider_ref == "lemonsqueezy:order:9001"
    assert payment.gross_usd_micros == 15_000_000 and payment.status == "succeeded"
    assert payment.metadata_json["pack"] == "maker"
    assert payment.created_at is not None
    assert "buyer@example.test" not in json.dumps(payment.metadata_json)
    purchase = db.query(CreditTransaction).filter(
        CreditTransaction.external_ref == "lemonsqueezy:order:9001").one()
    assert purchase.user_id == me_id and purchase.delta > 0
    assert "buyer@example.test" not in json.dumps(purchase.metadata_json)

    # The ledger no longer points at deleted heroes; the balance is forfeited
    # through the ledger, so it still adds up.
    assert db.query(CreditTransaction).filter(CreditTransaction.creation_id.in_(my_heroes)).count() == 0
    forfeit = db.query(CreditTransaction).filter(
        CreditTransaction.user_id == me_id, CreditTransaction.reason == "account_deleted").one()
    assert forfeit.delta == -(purchase.delta - 10) and forfeit.balance_after == 0
    assert ledger.verify_user_balance(me_id, db).consistent
    assert row.credits == 0

    # Provider cost stays, unlinked.
    usage = db.query(UsageEvent).filter(UsageEvent.cost_usd_micros == 40_000).all()
    assert len(usage) == 2
    assert sum(1 for u in usage if u.user_id is None and u.creation_id is None) == 1

    # The old token is dead everywhere.
    auth = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/v1/me", headers=auth).status_code == 401
    assert client.get("/api/v1/receipts", headers=auth).status_code == 401
    assert _delete(client, me).status_code == 401

    # Someone else's account is untouched.
    assert s3.s3_client.keys_for(other.id) == other_before
    assert db.query(Creation).filter(Creation.id.in_(other_heroes)).count() == 2
    other_row = db.get(User, other.id)
    assert other_row.deleted_at is None and other_row.email == "user2@example.test"
    assert db.query(PasswordResetToken).filter(PasswordResetToken.user_id == other.id).count() == 1
    assert db.query(CreditTransaction).filter(
        CreditTransaction.creation_id == other_heroes[0]).count() == 1
    other_auth = {"Authorization": f"Bearer {create_access_token(other.id)}"}
    assert client.get("/api/v1/me", headers=other_auth).json()["username"] == "noa"
    assert len(client.get("/api/v1/receipts", headers=other_auth).json()) == 1


def test_wrong_confirmation_deletes_nothing(
    db, client, configured, s3, tasks, make_user, make_creation, completed_steps,
):
    me, my_heroes = _account(db, client, make_user, make_creation, completed_steps, s3, "itai", 9101)
    keys = s3.s3_client.keys_for(me.id)

    for wrong in ("ITAI", "someone", ""):
        assert _delete(client, me, confirm=wrong).status_code == 400
    missing = client.request("DELETE", "/api/v1/me",
                             headers={"Authorization": f"Bearer {create_access_token(me.id)}"})
    assert missing.status_code == 422

    db.expire_all()
    assert s3.s3_client.keys_for(me.id) == keys
    assert db.query(Creation).filter(Creation.id.in_(my_heroes)).count() == 2
    assert db.get(User, me.id).deleted_at is None
    assert tasks.cancelled == []


def test_signing_in_again_after_deletion_is_a_fresh_account(
    db, client, configured, s3, tasks, make_user, make_creation, completed_steps,
):
    me, _ = _account(db, client, make_user, make_creation, completed_steps, s3, "itai", 9201)
    old_id = me.id
    assert _delete(client, me).status_code == 204

    # The same email can sign up again, and starts empty.
    signup = client.post("/api/v1/signup", json={
        "username": "itai", "email": "user1@example.test", "password": "secret1",
        "name": "Itai", "date_of_birth": "2015-01-01",
    })
    assert signup.status_code == 201, signup.text
    fresh = signup.json()["user"]
    assert fresh["id"] != old_id and fresh["credits"] == 0
    # The deleted account cannot be logged into by its old name.
    assert client.post("/api/v1/login", json={"username": "itai", "password": "x"}).status_code == 401


def test_storage_failure_changes_nothing(
    db, client, configured, s3, tasks, make_user, make_creation, completed_steps, monkeypatch,
):
    me, my_heroes = _account(db, client, make_user, make_creation, completed_steps, s3, "itai", 9301)

    def refuse(Bucket, Delete):
        return {"Errors": [{"Key": Delete["Objects"][0]["Key"], "Code": "AccessDenied", "Message": "no"}]}
    monkeypatch.setattr(s3.s3_client, "delete_objects", refuse)

    assert _delete(client, me).status_code == 503
    db.expire_all()
    assert db.get(User, me.id).deleted_at is None
    assert db.query(Creation).filter(Creation.id.in_(my_heroes)).count() == 2
    assert client.get("/api/v1/me",
                      headers={"Authorization": f"Bearer {create_access_token(me.id)}"}).status_code == 200


def test_local_storage_removes_the_users_directory_only(
    db, client, configured, tasks, make_user, make_creation, completed_steps, monkeypatch, tmp_path,
):
    monkeypatch.setattr(storage_mod, "FILES_ROOT", str(tmp_path))
    store = storage_mod.LocalFileStorage()
    monkeypatch.setattr(account_deletion, "get_storage", lambda: store)
    me, _ = _account(db, client, make_user, make_creation, completed_steps, store, "itai", 9401)
    other, _ = _account(db, client, make_user, make_creation, completed_steps, store, "noa", 9402)

    assert _delete(client, me).status_code == 204

    assert not (tmp_path / me.id).exists()
    assert len([p for p in (tmp_path / other.id).rglob("*") if p.is_file()]) == 2 * len(HERO_FILES)


@pytest.mark.parametrize("bad", ["", " ", "..", ".", "a/b", "a\\b"])
def test_a_bad_user_id_never_widens_to_the_whole_store(bad, tmp_path, monkeypatch):
    monkeypatch.setattr(storage_mod, "FILES_ROOT", str(tmp_path))
    with pytest.raises(ValueError):
        storage_mod.LocalFileStorage().delete_user_files(bad)
    with pytest.raises(ValueError):
        _s3_storage().delete_user_files(bad)
