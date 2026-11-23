"""Only a creation's owner, or an admin, may change, delete or run it."""
import pytest
from fastapi import HTTPException

from app.api.creations import _own_creation


def test_owner_gets_their_creation(db, make_user, make_creation):
    owner = make_user()
    hero = make_creation(owner.id)
    assert _own_creation(db, hero.id, owner, "delete this creation").id == hero.id


def test_admin_gets_anyones_creation(db, make_user, make_creation):
    hero = make_creation(make_user().id)
    admin = make_user(is_admin=True)
    assert _own_creation(db, hero.id, admin, "delete this creation").id == hero.id


def test_someone_else_is_refused_with_the_action_named(db, make_user, make_creation):
    hero = make_creation(make_user().id)
    with pytest.raises(HTTPException) as e:
        _own_creation(db, hero.id, make_user(), "run this step")
    assert e.value.status_code == 403
    assert e.value.detail == "You don't have permission to run this step"


def test_missing_creation_is_404(db, make_user):
    with pytest.raises(HTTPException) as e:
        _own_creation(db, "no-such-id", make_user(), "update this creation")
    assert e.value.status_code == 404
