"""
The data-import path must stay inert unless an environment deliberately turns
it on.

It exists so staging can be filled with real creations copied from production
over HTTPS. That is developer plumbing with a lot of reach - it writes rows,
writes objects into the configured bucket, and makes outbound requests from the
backend - so the interesting behaviour to pin down is not that it works, but
that it refuses: no token, a non-admin token, or an environment that never set
ALLOW_DATA_IMPORT all get nothing.
"""
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api import admin as admin_api  # noqa: E402
from app.database import get_db  # noqa: E402
from app.models import User  # noqa: E402
from app.services import data_import  # noqa: E402
from app.services.auth import get_current_user  # noqa: E402


PAYLOAD = {
    "source_base_url": "https://heromaker.up.railway.app",
    "source_user_id": "a6705eca-49c5-4376-ac6e-8b6051878e76",
    "source_creation_id": "cc12f21f-1cab-4a1e-9bca-718cf87b8a49",
    "files": ["rendered.png"],
}


class ExplodingSession:
    """Any network call from a request that should have been refused is a bug."""

    def get(self, *a, **kw):  # pragma: no cover - only reached on failure
        raise AssertionError("import fetched a file when it should have refused")


def _client(user: User | None):
    """Mini app with only the admin router, authenticated as `user` (or nobody)."""
    app = FastAPI()
    app.include_router(admin_api.router, prefix="/api/admin")

    def _unauthenticated():
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Authentication required")

    app.dependency_overrides[get_current_user] = (lambda: user) if user else _unauthenticated
    app.dependency_overrides[get_db] = lambda: None
    return TestClient(app)


def _user(is_admin: bool) -> User:
    return User(id="u1", username="demo", email="demo@heromaker.local", is_admin=is_admin)


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    monkeypatch.setattr(data_import.requests, "Session", ExplodingSession)


@pytest.fixture
def flag_unset(monkeypatch):
    monkeypatch.delenv("ALLOW_DATA_IMPORT", raising=False)


@pytest.fixture
def flag_on(monkeypatch):
    monkeypatch.setenv("ALLOW_DATA_IMPORT", "true")


# --- the flag ---------------------------------------------------------------

def test_import_is_off_by_default(flag_unset):
    """No env var at all - the default an unaware deployment gets."""
    assert data_import.import_enabled() is False
    with pytest.raises(data_import.ImportDisabled):
        data_import.require_import_enabled()


@pytest.mark.parametrize("value", ["", "false", "0", "no", "TRUE ", " true"])
def test_only_the_exact_flag_value_enables_import(monkeypatch, value):
    """'true' after stripping and lowercasing, nothing else. Typos stay off."""
    monkeypatch.setenv("ALLOW_DATA_IMPORT", value)
    assert data_import.import_enabled() is (value.strip().lower() == "true")


def test_admin_gets_403_when_flag_is_unset(flag_unset):
    """Being an admin is not enough on an environment that never opted in."""
    response = _client(_user(is_admin=True)).post("/api/admin/import/creation", json=PAYLOAD)
    assert response.status_code == 403
    assert "ALLOW_DATA_IMPORT" in response.json()["detail"]


# --- the admin check --------------------------------------------------------

def test_non_admin_is_refused_even_with_the_flag_on(flag_on):
    response = _client(_user(is_admin=False)).post("/api/admin/import/creation", json=PAYLOAD)
    assert response.status_code == 403
    assert response.json()["detail"] == "Admin access required"


def test_anonymous_is_refused_even_with_the_flag_on(flag_on):
    response = _client(None).post("/api/admin/import/creation", json=PAYLOAD)
    assert response.status_code == 401


def test_non_admin_is_refused_before_the_flag_is_consulted(flag_unset):
    """Both gates off: the caller learns nothing about the flag's state."""
    response = _client(_user(is_admin=False)).post("/api/admin/import/creation", json=PAYLOAD)
    assert response.status_code == 403
    assert response.json()["detail"] == "Admin access required"


def test_status_endpoint_is_admin_only(flag_on):
    assert _client(None).get("/api/admin/import/status").status_code == 401
    assert _client(_user(is_admin=False)).get("/api/admin/import/status").status_code == 403
    assert _client(_user(is_admin=True)).get("/api/admin/import/status").json()["enabled"] is True


def test_status_reports_disabled_without_the_flag(flag_unset):
    body = _client(_user(is_admin=True)).get("/api/admin/import/status").json()
    assert body["enabled"] is False
    assert body["allowed_source_hosts"] == []


# --- where files may come from ---------------------------------------------

def test_source_must_be_https():
    with pytest.raises(data_import.ImportSourceRejected):
        data_import.validate_source_base_url("http://heromaker.up.railway.app")


@pytest.mark.parametrize("url", [
    "https://evil.example.com",
    "https://heromaker.up.railway.app.evil.example.com",
    "https://169.254.169.254",
    "https://localhost:8000",
    "",
])
def test_source_host_must_be_allowlisted(url):
    """The backend makes this request itself, so an open source URL would be SSRF."""
    with pytest.raises(data_import.ImportSourceRejected):
        data_import.validate_source_base_url(url)


def test_allowed_source_is_accepted_and_normalised():
    assert data_import.validate_source_base_url(
        "https://heromaker.up.railway.app/"
    ) == "https://heromaker.up.railway.app"


def test_source_hosts_are_configurable(monkeypatch):
    monkeypatch.setenv("DATA_IMPORT_SOURCE_HOSTS", "a.example.com, b.example.com")
    assert data_import.allowed_source_hosts() == {"a.example.com", "b.example.com"}
    data_import.validate_source_base_url("https://b.example.com")
    with pytest.raises(data_import.ImportSourceRejected):
        data_import.validate_source_base_url("https://heromaker.up.railway.app")


@pytest.mark.parametrize("filename", [
    "../../etc/passwd",
    "config.json",
    "thumb_rendered.png",
    ".env",
])
def test_only_pipeline_artifacts_may_be_fetched(filename):
    with pytest.raises(data_import.ImportSourceRejected):
        data_import.validate_filenames([filename])


def test_pipeline_artifacts_are_accepted():
    files = ["original.jpg", "rendered.png", "walking.glb", "avatar.vrm"]
    assert data_import.validate_filenames(files) == files


def test_bad_filename_is_a_400_not_a_fetch(flag_on):
    payload = dict(PAYLOAD, files=["../../secrets"])
    response = _client(_user(is_admin=True)).post("/api/admin/import/creation", json=payload)
    assert response.status_code == 400


def test_bad_source_url_is_a_400_not_a_fetch(flag_on):
    payload = dict(PAYLOAD, source_base_url="https://evil.example.com")
    response = _client(_user(is_admin=True)).post("/api/admin/import/creation", json=payload)
    assert response.status_code == 400


# --- the admin bootstrap ----------------------------------------------------

class FakeQuery:
    def __init__(self, user):
        self._user = user

    def filter(self, *a, **kw):
        return self

    def first(self):
        return self._user


class FakeDB:
    def __init__(self, user=None):
        self._user = user
        self.commits = 0

    def query(self, *a, **kw):
        return FakeQuery(self._user)

    def commit(self):
        self.commits += 1

    def refresh(self, obj):
        pass


def test_bootstrap_admin_does_nothing_without_the_flag(flag_unset, monkeypatch):
    monkeypatch.setenv("DATA_IMPORT_ADMIN_USERNAME", "demo")
    user = _user(is_admin=False)
    assert data_import.bootstrap_admin(FakeDB(user)) is None
    assert user.is_admin is False


def test_bootstrap_admin_does_nothing_without_a_username(flag_on, monkeypatch):
    monkeypatch.delenv("DATA_IMPORT_ADMIN_USERNAME", raising=False)
    user = _user(is_admin=False)
    assert data_import.bootstrap_admin(FakeDB(user)) is None
    assert user.is_admin is False


def test_bootstrap_admin_promotes_the_named_user(flag_on, monkeypatch):
    monkeypatch.setenv("DATA_IMPORT_ADMIN_USERNAME", "demo")
    user = _user(is_admin=False)
    assert data_import.bootstrap_admin(FakeDB(user)) is user
    assert user.is_admin is True


def test_bootstrap_admin_tolerates_a_missing_user(flag_on, monkeypatch):
    monkeypatch.setenv("DATA_IMPORT_ADMIN_USERNAME", "nobody")
    assert data_import.bootstrap_admin(FakeDB(None)) is None
