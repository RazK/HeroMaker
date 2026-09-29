"""Deleting a hero someone paid for.

Found on staging, 2026-09-29: every DELETE of a hero that had spent credits
answered 500. credit_transactions.creation_id references the creation, and
Postgres refused to delete the row - after the endpoint had already removed
the hero's files, leaving a picture-less hero in the gallery for good.

These drive the real endpoint against a hero that has a ledger charge on it.
SQLite does not enforce the foreign key by default, so the tests assert the
behaviour that makes the constraint irrelevant: the row is kept and marked,
and the ledger still points at it.
"""
from fastapi.testclient import TestClient

from app.main import app
from app.models import Creation, CreditTransaction
from app.services import ledger
from app.services.auth import create_access_token
from app.services.task_manager import get_task_manager


class _NoTasks:
    """The app's task manager is created in its lifespan; nothing runs here."""
    def cancel_all_tasks_for_creation(self, creation_id):
        return 0


app.dependency_overrides[get_task_manager] = lambda: _NoTasks()


def _paid_hero(db, make_user, make_creation, completed_steps):
    user = make_user(credits=30)
    hero = make_creation(user.id, completed_steps)
    ledger.post(db=db, user_id=user.id, delta=-10, reason="spend", creation_id=hero.id)
    return user, hero


def test_owner_can_delete_a_paid_hero(db, make_user, make_creation, completed_steps):
    user, hero = _paid_hero(db, make_user, make_creation, completed_steps)
    client = TestClient(app)
    auth = {"Authorization": f"Bearer {create_access_token(user.id)}"}

    response = client.delete(f"/api/creations/{hero.id}", headers=auth)
    assert response.status_code == 200, response.text

    # Gone from everything the app shows...
    assert client.get(f"/api/creations/{hero.id}", headers=auth).status_code == 404
    listed = client.get("/api/creations/?limit=50", headers=auth).json()
    ids = [c["id"] for c in (listed["creations"] if isinstance(listed, dict) else listed)]
    assert hero.id not in ids

    # ...but the money still knows which hero it was spent on.
    db.expire_all()
    assert db.get(Creation, hero.id).deleted_at is not None
    charges = db.query(CreditTransaction).filter(CreditTransaction.creation_id == hero.id).all()
    assert [c.delta for c in charges] == [-10]


def test_someone_else_cannot_delete_it(db, make_user, make_creation, completed_steps):
    _owner, hero = _paid_hero(db, make_user, make_creation, completed_steps)
    stranger = make_user(username="stranger")
    client = TestClient(app)
    response = client.delete(f"/api/creations/{hero.id}",
                             headers={"Authorization": f"Bearer {create_access_token(stranger.id)}"})
    assert response.status_code == 403
    db.expire_all()
    assert db.get(Creation, hero.id).deleted_at is None
