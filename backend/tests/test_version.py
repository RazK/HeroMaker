"""GET /api/version: the backend says which commit it was built from."""
import pytest
from fastapi.testclient import TestClient

from app import version as version_mod
from app.main import app


@pytest.fixture
def version_file(tmp_path, monkeypatch):
    monkeypatch.setattr(version_mod, "VERSION_FILE", tmp_path / "VERSION")
    monkeypatch.delenv("APP_VERSION", raising=False)
    return tmp_path / "VERSION"


def test_falls_back_to_dev(version_file):
    assert version_mod.get_version() == "dev"


def test_reads_the_file_the_deploy_job_writes(version_file):
    version_file.write_text("v177 · aadc82c\n", encoding="utf-8")
    assert version_mod.get_version() == "v177 · aadc82c"


def test_env_var_wins(version_file, monkeypatch):
    version_file.write_text("v1 · 0000000\n", encoding="utf-8")
    monkeypatch.setenv("APP_VERSION", "v2 · 1111111")
    assert version_mod.get_version() == "v2 · 1111111"


def test_endpoint(version_file):
    version_file.write_text("v177 · aadc82c\n", encoding="utf-8")
    client = TestClient(app)
    assert client.get("/api/version").json() == {"version": "v177 · aadc82c"}
    assert client.get("/health").json()["version"] == "v177 · aadc82c"
