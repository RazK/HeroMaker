"""The /health version contract that deploy verification rests on.

devops/scripts/verify_deploy.py decides whether a deploy landed by comparing
`/health`'s `version` against the commit that was deployed. If that field ever
stops being reported, verification silently degrades back to what it replaced:
a check that says "healthy" about a container serving any build at all, which
is how production ran four-day-old code behind three green workflows.

So these tests guard the field itself, not just the helper that reads it.
"""
import importlib

from fastapi.testclient import TestClient

from app import build_info
from app.main import app

SHA = "0123456789abcdef0123456789abcdef01234567"


def _stamp(sha):
    """Write the file the deploy workflow writes, and reload the module."""
    path = build_info._SHA_FILE
    path.write_text(sha + "\n", encoding="utf-8")
    return path


def test_reports_unknown_when_nothing_stamped(monkeypatch):
    monkeypatch.delenv("BUILD_SHA", raising=False)
    assert not build_info._SHA_FILE.exists()
    assert build_info.build_sha() == build_info.UNKNOWN
    assert build_info.build_sha_short() == build_info.UNKNOWN


def test_reads_the_stamp_file(monkeypatch):
    monkeypatch.delenv("BUILD_SHA", raising=False)
    path = _stamp(SHA)
    try:
        assert build_info.build_sha() == SHA
        assert build_info.build_sha_short() == SHA[:7]
    finally:
        path.unlink()


def test_environment_variable_is_a_fallback(monkeypatch):
    monkeypatch.setenv("BUILD_SHA", SHA)
    assert not build_info._SHA_FILE.exists()
    assert build_info.build_sha() == SHA


def test_stamp_file_wins_over_the_environment(monkeypatch):
    monkeypatch.setenv("BUILD_SHA", "e" * 40)
    path = _stamp(SHA)
    try:
        assert build_info.build_sha() == SHA
    finally:
        path.unlink()


def test_health_reports_the_version(monkeypatch):
    """The exact field verify_deploy.py reads."""
    monkeypatch.delenv("BUILD_SHA", raising=False)
    path = _stamp(SHA)
    try:
        body = TestClient(app).get("/health").json()
        assert body["status"] == "healthy"
        assert body["version"] == SHA
    finally:
        path.unlink()


def test_health_still_answers_without_a_stamp(monkeypatch):
    """A local run must not 500 just because it was never stamped."""
    monkeypatch.delenv("BUILD_SHA", raising=False)
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json()["version"] == build_info.UNKNOWN
