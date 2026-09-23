"""
The pipeline's end of the plumbing.

Cost capture and the ledger are only worth anything if the pipeline actually
passes the user, the creation and the step down to them. These tests exercise
the real functions in app/services/pipeline.py with the providers mocked.
"""
import pytest

from app.config import pricing
from app.database import SessionLocal
from app.models import CreationStep, CreditTransaction, UsageEvent
from app.services import pipeline
from app.services.meshy import MeshyAPIError
from app.services.usage import UsageContext


def _events(creation_id):
    db = SessionLocal()
    try:
        return db.query(UsageEvent).filter(
            UsageEvent.creation_id == creation_id
        ).order_by(UsageEvent.created_at).all()
    finally:
        db.close()


@pytest.fixture
def step(db, make_user, make_creation):
    """A creation with a meshy_3d step, ready to be polled."""
    user = make_user(credits=20)
    creation = make_creation(user.id)
    record = CreationStep(creation_id=creation.id, step_name="meshy_3d", status="processing")
    db.add(record)
    db.commit()
    db.refresh(record)
    return user, creation, record


def _submit(ctx, task_id):
    """Stand in for MeshyClient.create_image_to_3d_task having been called."""
    from app.services import usage as usage_service
    usage_service.record_usage(
        ctx, pricing.PROVIDER_MESHY, pricing.OP_MESHY_IMAGE_TO_3D,
        status="submitted", provider_ref=task_id,
    )


def test_polling_a_succeeded_task_closes_its_usage_event(step, db, monkeypatch):
    """
    The submitted->succeeded transition. Without it every Meshy call in the
    report would sit at "submitted" forever and the success rate would be
    unknowable.
    """
    user, creation, record = step
    ctx = UsageContext.for_step(creation.id, user.id, "meshy_3d")
    _submit(ctx, "task-ok")
    monkeypatch.setattr(pipeline.time, "sleep", lambda *_a: None)

    url = pipeline._poll_meshy_task_with_progress(
        task_id="task-ok",
        status_func=lambda tid: {
            "status": "SUCCEEDED", "progress": 100,
            "model_urls": {"glb": "https://example.test/model.glb"},
        },
        step=record,
        db=db,
        get_download_url=pipeline._extract_3d_download_url,
    )

    assert url == "https://example.test/model.glb"
    (event,) = _events(creation.id)
    assert event.status == "succeeded"
    assert event.cost_usd_micros == 400_000  # it worked, so it is billed
    assert event.metadata_json["meshy_status"] == "SUCCEEDED"


def test_polling_a_failed_task_marks_it_failed_and_zeroes_the_cost(step, db, monkeypatch):
    user, creation, record = step
    ctx = UsageContext.for_step(creation.id, user.id, "meshy_3d")
    _submit(ctx, "task-bad")
    monkeypatch.setattr(pipeline.time, "sleep", lambda *_a: None)

    with pytest.raises(MeshyAPIError, match="failed"):
        pipeline._poll_meshy_task_with_progress(
            task_id="task-bad",
            status_func=lambda tid: {
                "status": "FAILED", "progress": 40,
                "error": {"message": "image could not be reconstructed"},
            },
            step=record,
            db=db,
            get_download_url=pipeline._extract_3d_download_url,
        )

    (event,) = _events(creation.id)
    assert event.status == "failed"
    assert event.cost_usd_micros == 0
    assert event.metadata_json["list_price_usd_micros"] == 400_000
    assert "could not be reconstructed" in event.metadata_json["meshy_error"]


def test_a_timed_out_task_keeps_its_cost_booked(step, db, monkeypatch):
    """
    A task we gave up waiting for is NOT a free task - Meshy may well finish it
    and bill us. Leaving it "submitted" with the cost booked is the safe
    direction to be wrong in, and the report flags it.
    """
    user, creation, record = step
    ctx = UsageContext.for_step(creation.id, user.id, "meshy_3d")
    _submit(ctx, "task-slow")
    monkeypatch.setattr(pipeline.time, "sleep", lambda *_a: None)

    clock = {"t": 0.0}

    def fake_time():
        clock["t"] += 5000.0  # blow straight past the 3600s ceiling
        return clock["t"]

    monkeypatch.setattr(pipeline.time, "time", fake_time)

    with pytest.raises(MeshyAPIError, match="timed out"):
        pipeline._poll_meshy_task_with_progress(
            task_id="task-slow",
            status_func=lambda tid: {"status": "IN_PROGRESS", "progress": 10},
            step=record,
            db=db,
            get_download_url=pipeline._extract_3d_download_url,
        )

    (event,) = _events(creation.id)
    assert event.status == "submitted"
    assert event.cost_usd_micros == 400_000, "a timed-out task must not be written off"
    assert event.metadata_json["client_timeout_seconds"] == 3600


def test_step_credit_spend_is_attributed_to_the_creation(db, make_user, make_creation):
    """
    pipeline.execute_step deducts credits with creation_id attached. Without it
    the margin report cannot put credits spent next to dollars spent, per hero.
    """
    from app.services.credits import deduct_credits

    user = make_user(credits=20)
    creation = make_creation(user.id)
    deduct_credits(user.id, 5, db, reason="step:meshy_3d", creation_id=creation.id)

    tx = db.query(CreditTransaction).filter(
        CreditTransaction.creation_id == creation.id
    ).one()
    assert tx.delta == -5
    assert tx.reason == "spend"
    assert tx.metadata_json["step_name"] == "meshy_3d"


def test_pipeline_passes_a_usage_context_to_every_paid_step():
    """
    Structural check on the wiring. A step that silently stops passing its
    context would produce unattributed cost, which looks like nothing being
    wrong at all.
    """
    from pathlib import Path
    src = (Path(__file__).resolve().parent.parent / "app" / "services" / "pipeline.py").read_text()
    for step_name in ("openai_render", "meshy_3d", "meshy_rig", "convert_vrm"):
        assert f'UsageContext.for_step(creation_id, user_id, "{step_name}")' in src, \
            f"{step_name} no longer passes a usage context"
    assert "creation_id=creation_id," in src, "credit spend is no longer attributed"
