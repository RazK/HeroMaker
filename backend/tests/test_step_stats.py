"""Step estimates come from real recent runs, not the config guess.

Measured on staging (Sept-Oct 2026): 3D modelling's median was 166s while the
config said 309s. These pin how the measured figures are made.
"""
from datetime import datetime, timedelta

import pytest

from app.models import Creation, CreationStep, User
from app.services import step_stats


@pytest.fixture(autouse=True)
def fresh_cache():
    step_stats.reset_cache()
    yield
    step_stats.reset_cache()


def _user(db):
    u = User(username="stats", email="stats@example.com", password_hash="x")
    db.add(u)
    db.commit()
    return u


def _run(db, user, step, seconds, *, ago_days=1, status="completed", cached=False):
    c = Creation(user_id=user.id, name="t")
    db.add(c)
    db.commit()
    end = datetime.utcnow() - timedelta(days=ago_days)
    db.add(CreationStep(
        creation_id=c.id, step_name=step, status=status,
        started_at=end - timedelta(seconds=seconds), completed_at=end,
        metadata_json={"result_cache": {"hit": True, "key": "k"}} if cached else {},
    ))
    db.commit()


def test_measured_median_and_p90(db):
    u = _user(db)
    for s in [100, 120, 140, 160, 180, 200, 220, 240, 260, 600]:
        _run(db, u, "meshy_3d", s)
    got = step_stats.estimates(db)["meshy_3d"]
    assert got["source"] == "measured"
    assert got["samples"] == 10
    assert got["p50"] == 190
    assert 260 < got["p90"] < 600


def test_too_few_runs_falls_back_to_the_config_guess(db):
    u = _user(db)
    for s in [10, 20]:
        _run(db, u, "openai_render", s)
    got = step_stats.estimates(db)["openai_render"]
    assert got == {"p50": 54, "p90": 108, "samples": 0, "source": "configured"}


def test_cache_hits_failures_and_old_runs_do_not_count(db):
    u = _user(db)
    for s in [50, 50, 50, 50, 50]:
        _run(db, u, "openai_render", s)
    for _ in range(10):
        _run(db, u, "openai_render", 0.2, cached=True)  # answered from the cache
    _run(db, u, "openai_render", 900, status="failed")
    _run(db, u, "openai_render", 900, ago_days=step_stats.MAX_AGE_DAYS + 5)
    got = step_stats.estimates(db)["openai_render"]
    assert got["samples"] == 5
    assert got["p50"] == 50 and got["p90"] == 50


def test_total_adds_up_every_step(db):
    figures = step_stats.estimates(db)
    total = step_stats.total(db)
    assert total["p50"] == sum(f["p50"] for f in figures.values())
    assert total["p90"] >= total["p50"]


def test_the_api_serves_them(db):
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    u = _user(db)
    for s in [30, 30, 30, 30, 30]:
        _run(db, u, "meshy_rig", s)
    r = client.get("/api/v1/estimates")
    assert r.status_code == 200
    body = r.json()
    by_step = {s["step"]: s for s in body["stages"]}
    assert by_step["meshy_rig"]["typical_seconds"] == 30
    assert by_step["meshy_rig"]["source"] == "measured"
    assert set(by_step) == {"image_processing", "openai_render", "meshy_3d", "meshy_rig", "convert_vrm"}
    assert body["total"]["typical_seconds"] == sum(s["typical_seconds"] for s in body["stages"])


def test_a_step_response_quotes_the_measured_length(db):
    from app.schemas.creation import CreationStepResponse

    u = _user(db)
    for s in [40, 40, 40, 40, 40]:
        _run(db, u, "meshy_rig", s)
    step_stats.estimates(db)  # warm with this session
    step = db.query(CreationStep).filter_by(step_name="meshy_rig").first()
    assert CreationStepResponse.from_step(step).estimated_duration == 40
