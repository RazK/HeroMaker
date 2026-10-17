"""
Backup expiry in backend/scripts/backup_database.py.

The privacy policy promises deleted data's backup copies are erased within 30
days. These drive the real script, with S3 and pg_dump faked, and assert the
deletions that must happen and the ones that must never happen.
"""
import importlib.util
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.utils.storage import S3FileStorage

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "backup_database.py"
spec = importlib.util.spec_from_file_location("backup_database", SCRIPT)
backup = importlib.util.module_from_spec(spec)
sys.modules["backup_database"] = backup
spec.loader.exec_module(backup)

NOW = datetime(2026, 10, 17, 2, 0, tzinfo=timezone.utc)
BUCKET = "bucket"


class FakeS3Client:
    """Just enough of boto3's S3 client: objects carry a LastModified."""

    def __init__(self, page_size=3):
        self.objects: dict[str, datetime] = {}
        self.deleted: list[str] = []
        self.page_size = page_size
        self.fail_put = False

    def add(self, key, age_days):
        self.objects[key] = NOW - timedelta(days=age_days)

    def put_object(self, Bucket, Key, Body, **_):
        if self.fail_put:
            raise RuntimeError("upload refused")
        self.objects[Key] = NOW

    def delete_object(self, Bucket, Key):
        self.deleted.append(Key)
        self.objects.pop(Key, None)

    def get_paginator(self, name):
        assert name == "list_objects_v2"
        client = self

        class Paginator:
            def paginate(self, Bucket, Prefix):
                keys = sorted(k for k in client.objects if k.startswith(Prefix))
                # Several pages, so a script that reads only the first fails.
                for i in range(0, max(len(keys), 1), client.page_size):
                    chunk = keys[i:i + client.page_size]
                    yield {"Contents": [{"Key": k, "LastModified": client.objects[k]}
                                        for k in chunk]} if chunk else {}

        return Paginator()


def key(age_days):
    return f"{backup.BACKUP_PREFIX}backup_{(NOW - timedelta(days=age_days)):%Y%m%d_%H%M%S}.sql"


@pytest.fixture
def s3():
    client = FakeS3Client()
    for age in range(0, 45):  # a nightly backup for each of the last 45 days
        client.add(key(age), age)
    return client


def expire(s3, keep=None, **kw):
    return backup.expire_old_backups(s3, BUCKET, keep or key(0), now=NOW, **kw)


def test_old_backups_are_deleted_and_recent_ones_kept(s3):
    expired = expire(s3, days=30)
    assert sorted(s3.deleted) == sorted(key(a) for a in range(31, 45))
    assert [k for k, _ in expired] == [key(a) for a in range(44, 30, -1)]  # oldest first
    for age in range(0, 31):
        assert key(age) in s3.objects


def test_retention_window_comes_from_env(s3, monkeypatch):
    monkeypatch.setenv("BACKUP_RETENTION_DAYS", "10")
    expire(s3)
    assert min(NOW - m for m in s3.objects.values()) == timedelta(0)
    assert max(NOW - m for m in s3.objects.values()) == timedelta(days=10)


def test_default_retention_is_30_days(monkeypatch):
    monkeypatch.delenv("BACKUP_RETENTION_DAYS", raising=False)
    assert backup.retention_days() == 30


def test_other_prefixes_are_untouched(s3):
    outside = [
        "_backups/other/backup_old.sql",
        "_backups/database_old/backup_old.sql",  # shares the prefix's text, not its folder
        "user1/creation1/model.glb",
        "_backups/backup_20200101_000000.sql",
    ]
    for k in outside:
        s3.add(k, 400)
    expire(s3, days=30)
    for k in outside:
        assert k in s3.objects
        assert k not in s3.deleted
    assert all(k.startswith(backup.BACKUP_PREFIX) for k in s3.deleted)


def test_min_keep_guard_holds_after_a_run_of_failures():
    # Backups stopped 40 days ago: everything is past the window.
    s3 = FakeS3Client()
    for age in range(40, 60):
        s3.add(key(age), age)
    expire(s3, keep="nonexistent", days=30)
    assert sorted(s3.objects) == sorted(key(a) for a in range(40, 47))
    assert len(s3.objects) == backup.MIN_BACKUPS_KEPT


def test_the_backup_just_made_is_never_deleted():
    # Even if its clock says it is old, and it falls outside the newest few.
    s3 = FakeS3Client()
    for age in range(0, 10):
        s3.add(key(age), age)
    s3.add("_backups/database/just_made.sql", 99)
    expire(s3, keep="_backups/database/just_made.sql", days=30)
    assert "_backups/database/just_made.sql" in s3.objects


# --- the whole script, end to end -------------------------------------------

@pytest.fixture
def run_script(s3, monkeypatch, tmp_path):
    """backup_database() with pg_dump and S3 faked, the real code path otherwise."""
    storage = object.__new__(S3FileStorage)
    storage.s3_client = s3
    storage.bucket_name = BUCKET
    monkeypatch.setattr(backup, "get_storage", lambda: storage)
    monkeypatch.setattr(backup, "DATABASE_URL", "postgresql://u:p@db:5432/hm")
    monkeypatch.setenv("S3_BUCKET", BUCKET)
    monkeypatch.delenv("BACKUP_RETENTION_DAYS", raising=False)
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))

    def fake_pg_dump(cmd, **kw):
        Path(cmd[cmd.index("-f") + 1]).write_text("-- dump\n" * 50)
        return subprocess.CompletedProcess(cmd, 0, "", "")

    monkeypatch.setattr(backup.subprocess, "run", fake_pg_dump)
    # The fake's clock is NOW, so ages line up with the real script's.
    real_expire = backup.expire_old_backups
    monkeypatch.setattr(backup, "expire_old_backups",
                        lambda *a, **kw: real_expire(*a, now=NOW, **kw))
    return summary


def test_successful_run_uploads_then_expires_and_reports(s3, run_script):
    before = set(s3.objects)
    backup.backup_database()
    new = set(s3.objects) - before
    assert len(new) == 1 and next(iter(new)).startswith(backup.BACKUP_PREFIX)
    expired = sorted(key(a) for a in range(31, 45))
    assert sorted(k for k in s3.deleted if k in before) == expired
    summary = run_script.read_text()
    for k in expired:
        assert k in summary
    assert "Deleted 14 backup(s)" in summary


def test_failed_upload_deletes_nothing(s3, run_script):
    s3.fail_put = True
    before = dict(s3.objects)
    with pytest.raises(SystemExit) as exc:
        backup.backup_database()
    assert exc.value.code == 1
    assert s3.deleted == []
    assert s3.objects == before
