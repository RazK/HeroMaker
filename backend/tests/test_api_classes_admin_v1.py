"""Classes and the admin console on /api/v1: the same routers at one more
address, still only for the app's login (teacher, admin) or a student pass."""
from test_public_api import _bearer, _jwt, _key, client  # noqa: F401


def test_a_teacher_lists_classes_on_v1(client, make_user):
    teacher = make_user()
    r = client.get("/api/v1/classes", headers=_jwt(teacher))
    assert r.status_code == 200 and "classes" in r.json()


def test_a_key_cannot_run_classes_or_admin(client, make_user):
    admin = make_user(is_admin=True)
    key = _bearer(_key(client, admin)["key"])
    assert client.get("/api/v1/classes", headers=key).status_code == 401
    assert client.get("/api/v1/admin/users", headers=key).status_code in (401, 403)


def test_admin_on_v1_is_admins_only(client, make_user):
    assert client.get("/api/v1/admin/users", headers=_jwt(make_user(is_admin=True))).status_code == 200
    assert client.get("/api/v1/admin/users", headers=_jwt(make_user())).status_code == 403


def test_a_student_with_a_wrong_code_is_told_so(client):
    assert client.get("/api/v1/class/join/000000").status_code in (404, 410)


def test_the_student_pass_cookie_covers_the_v1_address():
    from app.api import classes

    assert "/api/v1/class/join".startswith(classes.COOKIE_PATH)
    assert "/api/class/join".startswith(classes.COOKIE_PATH)
