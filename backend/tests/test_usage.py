"""
Per-call cost capture: every paid call writes a row, including the ones that
fail and the ones that are retries.

The providers are mocked. These tests never touch the network and never spend
money - they check that our side of the wire records what it should.
"""
import base64
from types import SimpleNamespace

import pytest

from app.config import pricing
from app.database import SessionLocal
from app.models import UsageEvent
from app.services import meshy as meshy_service
from app.services import openai as openai_service
from app.services import usage as usage_service
from app.services.usage import UsageContext


def _events(**filters):
    db = SessionLocal()
    try:
        q = db.query(UsageEvent)
        for key, value in filters.items():
            q = q.filter(getattr(UsageEvent, key) == value)
        return q.order_by(UsageEvent.created_at).all()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# The recorder itself
# ---------------------------------------------------------------------------

def test_record_usage_prices_from_the_table(make_user, make_creation):
    user = make_user()
    creation = make_creation(user.id)
    ctx = UsageContext.for_step(creation.id, user.id, "meshy_3d")

    usage_service.record_usage(ctx, pricing.PROVIDER_MESHY, pricing.OP_MESHY_IMAGE_TO_3D)

    (event,) = _events(creation_id=creation.id)
    assert event.provider == "meshy"
    assert event.operation == "image-to-3d"
    assert event.units == 20              # Meshy credits, their unit
    assert event.cost_usd_micros == 400_000
    assert event.user_id == user.id
    assert event.step_name == "meshy_3d"
    assert isinstance(event.cost_usd_micros, int)


def test_failed_calls_are_recorded_at_zero_but_keep_their_list_price(make_user, make_creation):
    """
    A failed call is (by the documented assumption in pricing.py) not billed -
    but the volume must never be invisible, and the price it would have cost is
    kept so flipping BILL_FAILED_CALLS re-prices the report without a code
    change.
    """
    user = make_user()
    creation = make_creation(user.id)
    ctx = UsageContext.for_step(creation.id, user.id, "openai_render")

    usage_service.record_usage(
        ctx, pricing.PROVIDER_OPENAI, pricing.OP_OPENAI_IMAGE_EDIT, status="failed"
    )

    (event,) = _events(creation_id=creation.id)
    assert event.status == "failed"
    assert event.cost_usd_micros == 0
    assert event.metadata_json["list_price_usd_micros"] == 167_000


def test_usage_survives_the_callers_transaction_rolling_back(make_user, make_creation, db):
    """
    THE key property. The money is spent the instant the provider accepts the
    request. If the pipeline's transaction later rolls back, the cost does not
    roll back with it - so the record must not either.

    Written on its own session, committed immediately.
    """
    user = make_user()
    creation = make_creation(user.id)
    ctx = UsageContext.for_step(creation.id, user.id, "meshy_3d")

    # Start some work on the caller's session, record usage, then throw the
    # caller's work away.
    db.add(UsageEvent(provider="internal", operation="scratch", units=0, cost_usd_micros=0))
    usage_service.record_usage(ctx, pricing.PROVIDER_MESHY, pricing.OP_MESHY_IMAGE_TO_3D)
    db.rollback()

    events = _events(creation_id=creation.id)
    assert len(events) == 1, "cost record was lost when the caller rolled back"
    assert events[0].cost_usd_micros == 400_000
    # The caller's own scratch row is gone, proving the rollback really happened.
    assert not _events(operation="scratch")


def test_recording_never_raises_even_when_the_database_is_broken(monkeypatch, caplog):
    """
    A bookkeeping failure must not break the pipeline that is earning the money.
    It must, however, be LOUD - the log line is the only way to reconstruct the
    row by hand.
    """
    def exploding_session():
        raise RuntimeError("database is on fire")

    monkeypatch.setattr(usage_service, "_session", exploding_session)
    with caplog.at_level("ERROR"):
        result = usage_service.record_usage(
            None, pricing.PROVIDER_OPENAI, pricing.OP_OPENAI_IMAGE_EDIT
        )
    assert result is None
    assert "FAILED TO RECORD USAGE EVENT" in caplog.text


def test_track_marks_success(make_user, make_creation):
    user = make_user()
    creation = make_creation(user.id)
    ctx = UsageContext.for_step(creation.id, user.id, "convert_vrm")

    with usage_service.track(ctx, pricing.PROVIDER_INTERNAL, pricing.OP_VRM_CONVERT) as call:
        call.provider_ref = "local-1"

    (event,) = _events(creation_id=creation.id)
    assert event.status == "succeeded"
    assert event.provider_ref == "local-1"


def test_track_marks_failure_and_reraises_unchanged(make_user, make_creation):
    """The caller's error handling must be completely unaffected."""
    user = make_user()
    creation = make_creation(user.id)
    ctx = UsageContext.for_step(creation.id, user.id, "openai_render")

    class Boom(RuntimeError):
        pass

    with pytest.raises(Boom, match="moderation_blocked"):
        with usage_service.track(ctx, pricing.PROVIDER_OPENAI, pricing.OP_OPENAI_IMAGE_EDIT):
            raise Boom("moderation_blocked")

    (event,) = _events(creation_id=creation.id)
    assert event.status == "failed"
    assert event.cost_usd_micros == 0
    assert event.metadata_json["error_type"] == "Boom"
    assert "moderation_blocked" in event.metadata_json["error"]


def test_finalize_by_provider_ref_closes_an_async_task(make_user, make_creation):
    """
    Meshy submits in one function and answers minutes later in another. The
    outcome is matched back on the Meshy task id.
    """
    user = make_user()
    creation = make_creation(user.id)
    ctx = UsageContext.for_step(creation.id, user.id, "meshy_3d")

    usage_service.record_usage(
        ctx, pricing.PROVIDER_MESHY, pricing.OP_MESHY_IMAGE_TO_3D,
        status="submitted", provider_ref="task-abc",
    )
    assert _events(creation_id=creation.id)[0].status == "submitted"

    usage_service.finalize_usage_by_provider_ref(
        pricing.PROVIDER_MESHY, "task-abc", "succeeded"
    )
    event = _events(creation_id=creation.id)[0]
    assert event.status == "succeeded"
    assert event.cost_usd_micros == 400_000  # still billed - it worked


def test_finalize_a_failed_meshy_task_refunds_the_booked_cost(make_user, make_creation):
    user = make_user()
    creation = make_creation(user.id)
    ctx = UsageContext.for_step(creation.id, user.id, "meshy_3d")
    usage_service.record_usage(
        ctx, pricing.PROVIDER_MESHY, pricing.OP_MESHY_IMAGE_TO_3D,
        status="submitted", provider_ref="task-fail",
    )

    usage_service.finalize_usage_by_provider_ref(
        pricing.PROVIDER_MESHY, "task-fail", "failed",
        metadata={"meshy_error": "input image rejected"},
    )
    event = _events(creation_id=creation.id)[0]
    assert event.status == "failed"
    assert event.cost_usd_micros == 0
    assert event.metadata_json["list_price_usd_micros"] == 400_000
    assert event.metadata_json["meshy_error"] == "input image rejected"


def test_calls_with_no_creation_are_still_recorded():
    """A script's call costs money too. Recorded, just unattributed."""
    usage_service.record_usage(None, pricing.PROVIDER_OPENAI, pricing.OP_OPENAI_IMAGE_EDIT)
    (event,) = _events(provider="openai")
    assert event.creation_id is None
    assert event.cost_usd_micros == 167_000


# ---------------------------------------------------------------------------
# The wiring: openai.py
# ---------------------------------------------------------------------------

class _FakeImages:
    def __init__(self, behaviour):
        self._behaviour = behaviour
        self.calls = 0

    def edit(self, **kwargs):
        self.calls += 1
        return self._behaviour(self.calls, kwargs)


class _FakeOpenAI:
    def __init__(self, behaviour):
        self.images = _FakeImages(behaviour)


@pytest.fixture
def fake_openai(monkeypatch):
    """Patch app.services.openai to use a fake client, and pretend we have a key."""
    holder = {}

    def install(behaviour):
        client = _FakeOpenAI(behaviour)
        holder["client"] = client
        monkeypatch.setattr(openai_service, "OpenAI", lambda api_key=None: client)
        monkeypatch.setattr(openai_service, "OPENAI_API_KEY", "sk-test")
        return client

    return install


def _ok_response(*_args, **_kwargs):
    png = base64.b64encode(b"\x89PNG\r\n\x1a\n-pretend-image").decode()
    return SimpleNamespace(data=[SimpleNamespace(b64_json=png)], _request_id="req_123")


def test_openai_render_records_one_event_per_call(fake_openai, make_user, make_creation, tmp_path):
    fake_openai(lambda n, kwargs: _ok_response())
    user = make_user()
    creation = make_creation(user.id)
    src = tmp_path / "processed.jpg"
    src.write_bytes(b"jpeg-bytes")

    openai_service.render_image(
        src, tmp_path / "rendered.png",
        usage=UsageContext.for_step(creation.id, user.id, "openai_render"),
    )

    (event,) = _events(creation_id=creation.id)
    assert event.provider == "openai"
    assert event.operation == "images.edit"
    assert event.status == "succeeded"
    assert event.cost_usd_micros == 167_000
    assert event.provider_ref == "req_123"
    # The parameters the price is quoted for are recorded with the cost, so a
    # later price change can be checked against what was actually requested.
    assert event.metadata_json["size"] == "1024x1024"
    assert event.metadata_json["quality"] == "high"


def test_openai_render_records_the_failure_too(fake_openai, make_user, make_creation, tmp_path):
    def blow_up(n, kwargs):
        raise RuntimeError("Your request was rejected by the safety system")

    fake_openai(blow_up)
    user = make_user()
    creation = make_creation(user.id)
    src = tmp_path / "processed.jpg"
    src.write_bytes(b"jpeg-bytes")

    with pytest.raises(Exception, match="safety system"):
        openai_service.render_image(
            src, tmp_path / "rendered.png",
            usage=UsageContext.for_step(creation.id, user.id, "openai_render"),
        )

    (event,) = _events(creation_id=creation.id)
    assert event.status == "failed"
    assert event.cost_usd_micros == 0
    assert event.metadata_json["list_price_usd_micros"] == 167_000


def test_a_retried_render_is_two_rows_not_one(fake_openai, make_user, make_creation, tmp_path):
    """
    THE MEASUREMENT THAT MATTERS. A hero whose render failed once and succeeded
    on the retry has TWO openai rows against its creation_id. The margin report
    sums them, so the hero costs what it really cost - not the list price of the
    happy path.
    """
    def fail_then_succeed(n, kwargs):
        if n == 1:
            raise RuntimeError("500 server error")
        return _ok_response()

    fake_openai(fail_then_succeed)
    user = make_user()
    creation = make_creation(user.id)
    src = tmp_path / "processed.jpg"
    src.write_bytes(b"jpeg-bytes")
    ctx = UsageContext.for_step(creation.id, user.id, "openai_render")

    with pytest.raises(Exception):
        openai_service.render_image(src, tmp_path / "rendered.png", usage=ctx)
    openai_service.render_image(src, tmp_path / "rendered.png", usage=ctx)

    events = _events(creation_id=creation.id)
    assert len(events) == 2
    assert [e.status for e in events] == ["failed", "succeeded"]
    # Failure not billed, success billed once.
    assert sum(e.cost_usd_micros for e in events) == 167_000


def test_openai_render_still_works_with_no_usage_context(fake_openai, tmp_path):
    """Cost capture is optional. A call without context must not break."""
    fake_openai(lambda n, kwargs: _ok_response())
    src = tmp_path / "in.jpg"
    src.write_bytes(b"jpeg")
    out = openai_service.render_image(src, tmp_path / "out.png")
    assert out.exists()
    # Recorded, just unattributed.
    assert len(_events(provider="openai")) == 1


# ---------------------------------------------------------------------------
# The wiring: meshy.py
# ---------------------------------------------------------------------------

@pytest.fixture
def meshy_client(monkeypatch):
    """A MeshyClient whose HTTP layer is replaced by a scripted responder."""
    def build(responder):
        client = meshy_service.MeshyClient(api_key="test-key")
        monkeypatch.setattr(
            client, "_request",
            lambda method, endpoint, **kwargs: responder(method, endpoint, kwargs),
        )
        return client
    return build


def test_meshy_3d_books_the_full_cost_at_submission(meshy_client, make_user, make_creation, tmp_path):
    """
    The cost is incurred the moment Meshy accepts the task - not when the model
    finally downloads, which may be five minutes and one server restart later.
    """
    client = meshy_client(lambda m, e, k: {"result": "meshy-task-1"})
    user = make_user()
    creation = make_creation(user.id)
    image = tmp_path / "rendered.png"
    image.write_bytes(b"png-bytes")

    task_id = client.create_image_to_3d_task(
        image, usage=UsageContext.for_step(creation.id, user.id, "meshy_3d")
    )

    assert task_id == "meshy-task-1"
    (event,) = _events(creation_id=creation.id)
    assert event.operation == "image-to-3d"
    assert event.provider_ref == "meshy-task-1"
    assert event.cost_usd_micros == 400_000
    # Acceptance is not success: the poller decides that, later.
    assert event.status == "submitted"


def test_meshy_rig_is_recorded_at_zero(meshy_client, make_user, make_creation):
    """Free is a price. Recorded so the day it stops being free is one edit."""
    client = meshy_client(lambda m, e, k: {"result": "rig-task-1"})
    user = make_user()
    creation = make_creation(user.id)

    client.create_rigging_task(
        "meshy-task-1", usage=UsageContext.for_step(creation.id, user.id, "meshy_rig")
    )

    (event,) = _events(creation_id=creation.id)
    assert event.operation == "rigging"
    assert event.units == 0
    assert event.cost_usd_micros == 0


def test_a_rejected_meshy_submission_is_recorded_as_failed(meshy_client, make_user, make_creation, tmp_path):
    def reject(method, endpoint, kwargs):
        raise meshy_service.MeshyAPIError("Insufficient Meshy credits")

    client = meshy_client(reject)
    user = make_user()
    creation = make_creation(user.id)
    image = tmp_path / "rendered.png"
    image.write_bytes(b"png")

    with pytest.raises(meshy_service.MeshyAPIError):
        client.create_image_to_3d_task(
            image, usage=UsageContext.for_step(creation.id, user.id, "meshy_3d")
        )

    (event,) = _events(creation_id=creation.id)
    assert event.status == "failed"
    assert event.cost_usd_micros == 0
    assert "Insufficient Meshy credits" in event.metadata_json["error"]


def test_meshy_client_works_without_a_usage_context(meshy_client, tmp_path):
    client = meshy_client(lambda m, e, k: {"result": "t"})
    image = tmp_path / "x.png"
    image.write_bytes(b"png")
    assert client.create_image_to_3d_task(image) == "t"
    assert len(_events(provider="meshy")) == 1


def test_finalize_never_raises_when_the_database_is_broken(monkeypatch, caplog):
    """Same hole as record_usage, same harness. Closing an event must not
    be able to take the pipeline down either."""
    def exploding_session():
        raise RuntimeError("database is on fire")

    monkeypatch.setattr(usage_service, "_session", exploding_session)
    with caplog.at_level("ERROR"):
        usage_service.finalize_usage("some-id", "succeeded")
        usage_service.finalize_usage_by_provider_ref("meshy", "task-1", "succeeded")
    assert "FAILED TO FINALIZE USAGE EVENT" in caplog.text


def test_finalize_of_an_unknown_event_is_a_noop(caplog):
    with caplog.at_level("WARNING"):
        usage_service.finalize_usage("no-such-event", "succeeded")
        usage_service.finalize_usage(None, "succeeded")
        usage_service.finalize_usage_by_provider_ref("meshy", "no-such-task", "succeeded")
        usage_service.finalize_usage_by_provider_ref("meshy", None, "succeeded")
    assert _events() == []
