"""
Files served from S3 must be cacheable by the browser.

/api/files/... answers with a redirect to a presigned S3 URL. A presigned URL
carries its signing time, so presigning on every request gave a new URL every
request: the browser cache never hit, and a hero's 3D files downloaded again
on every screen that showed them (the hero page, then the game). The URL is now
signed at the start of the hour, so it is the same all hour, and the redirect
says how long it may be reused.
"""
import datetime
import threading
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import files as files_api
from app.utils import storage as storage_mod
from app.utils.storage import S3FileStorage

HOUR = 1_790_000_000 - 1_790_000_000 % 3600  # an hour boundary


@pytest.fixture
def s3(monkeypatch):
    monkeypatch.setenv("S3_BUCKET", "heroes")
    monkeypatch.setenv("S3_ACCESS_KEY_ID", "AKIDEXAMPLE")
    monkeypatch.setenv("S3_SECRET_ACCESS_KEY", "secret")
    monkeypatch.setenv("S3_ENDPOINT", "https://storage.example.com")
    return S3FileStorage()


def _query(url):
    return {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}


def test_the_url_is_the_same_all_hour(s3):
    first, _ = s3.get_cacheable_url("u", "c", "opt_avatar.vrm", now=HOUR + 5)
    later, _ = s3.get_cacheable_url("u", "c", "opt_avatar.vrm", now=HOUR + 3599)
    next_hour, _ = s3.get_cacheable_url("u", "c", "opt_avatar.vrm", now=HOUR + 3600)

    assert first == later
    assert next_hour != first


def test_the_url_is_signed_at_the_hour_and_valid_for_two(s3):
    url, _ = s3.get_cacheable_url("u", "c", "opt_avatar.vrm", now=HOUR + 1234)
    q = _query(url)

    signed = datetime.datetime.fromtimestamp(HOUR, datetime.timezone.utc)
    assert q["X-Amz-Date"] == signed.strftime("%Y%m%dT%H%M%SZ")
    # Handed out until HOUR+3600 and valid until HOUR+7200: never less than an
    # hour left on a URL a browser was just given.
    assert q["X-Amz-Expires"] == "7200"
    assert urlparse(url).path.endswith("/heroes/u/c/opt_avatar.vrm")


def test_s3_is_told_to_revalidate_rather_than_trust_a_stale_copy(s3):
    url, _ = s3.get_cacheable_url("u", "c", "avatar.vrm", now=HOUR)
    # A hero made again within the hour keeps the same URL; no-cache makes the
    # browser ask (a 304 when unchanged) instead of showing the old hero.
    assert _query(url)["response-cache-control"] == "no-cache"


def test_the_redirect_may_be_cached_until_the_url_changes(s3):
    assert s3.get_cacheable_url("u", "c", "a.vrm", now=HOUR)[1] == 3600
    assert s3.get_cacheable_url("u", "c", "a.vrm", now=HOUR + 3000)[1] == 600


def test_other_signatures_keep_the_real_clock(s3):
    s3.get_cacheable_url("u", "c", "a.vrm", now=HOUR)
    plain = _query(s3.get_file_url("u", "c", "a.vrm"))
    signed = datetime.datetime.strptime(plain["X-Amz-Date"], "%Y%m%dT%H%M%SZ").replace(tzinfo=datetime.timezone.utc)
    assert abs((datetime.datetime.now(datetime.timezone.utc) - signed).total_seconds()) < 60


def test_the_pinned_clock_belongs_to_one_thread(s3):
    """Uploads and HEADs on other threads sign while a presign is running."""
    storage_mod._install_signing_clock()
    import botocore.auth as auth
    storage_mod._signing.at = datetime.datetime.fromtimestamp(HOUR, datetime.timezone.utc)
    try:
        seen = []
        t = threading.Thread(target=lambda: seen.append(auth.get_current_datetime()))
        t.start()
        t.join()
        assert auth.get_current_datetime() == storage_mod._signing.at.replace(tzinfo=None)
        assert abs((datetime.datetime.utcnow() - seen[0]).total_seconds()) < 60
    finally:
        storage_mod._signing.at = None


def test_the_endpoint_returns_the_same_cacheable_redirect_twice(s3, monkeypatch):
    monkeypatch.setattr(files_api, "get_storage", lambda: s3)
    monkeypatch.setattr(s3, "file_exists", lambda *a: True)
    app = FastAPI()
    app.include_router(files_api.router, prefix="/api/files")
    client = TestClient(app, follow_redirects=False)

    a = client.get("/api/files/u/c/rendered.png")
    b = client.get("/api/files/u/c/rendered.png")

    assert a.status_code == 302
    assert a.headers["location"] == b.headers["location"]
    cache = a.headers["cache-control"]
    assert cache.startswith("public, max-age=")
    assert 0 < int(cache.split("=")[1]) <= 3600
