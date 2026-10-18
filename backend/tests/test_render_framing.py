"""
The painting must show the whole character: nothing cut off at the edge of the
image, feet included. A painting with the feet sliced off becomes a 3D model
with no feet.

Drives the REAL code path: `pipeline.execute_step` -> `step_openai_render` ->
`openai.render_image` -> the real OpenAI SDK, with only the HTTP transport
under the SDK replaced, so the tests read the multipart body that would have
gone over the wire and answer with real PNGs. Credits go through the real
ledger.
"""
import asyncio
import base64
import importlib
import io

import pytest
from PIL import Image

from app.config.steps import get_step_cost
from app.models import CreationStep, CreditTransaction, UsageEvent
from app.services import openai as openai_service
from app.services import pipeline, result_cache
from app.utils.storage import get_storage

try:   # the OpenAI SDK's HTTP client, under whichever name this version ships
    _http = importlib.import_module("httpx2")
except ImportError:   # pragma: no cover
    _http = importlib.import_module("httpx")

SIZE = 256   # paintings in these tests; the checks do not depend on the size


def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def painting(top: int = 30, bottom: int = 30, left: int = 40, right: int = 40) -> bytes:
    """A transparent painting with an opaque 'character' this far from each
    edge. A negative or zero distance means it runs off that edge."""
    im = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    box = (max(0, left), max(0, top), SIZE - max(0, right), SIZE - max(0, bottom))
    im.paste((200, 60, 60, 255), box)
    return _png(im)


CLEAN = painting()
FEET_CUT = painting(top=10, bottom=0)        # the reported bug: boots sliced at the bottom


def _hand_cut() -> bytes:
    """Clean, except one outstretched hand that runs off the left edge."""
    im = Image.open(io.BytesIO(CLEAN)).copy()
    im.paste((200, 60, 60, 255), (0, 100, 41, 120))
    return _png(im)


HAND_CUT = _hand_cut()                       # 20 px of a hand on the left edge


def drawing_jpeg(w=300, h=600, paper=(240, 236, 228), ink=(20, 20, 160)) -> bytes:
    """A portrait phone photo of a drawing: paper, a figure from top to bottom."""
    im = Image.new("RGB", (w, h), paper)
    im.paste(ink, (w // 3, 5, 2 * w // 3, h - 5))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=95)
    return buf.getvalue()


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ---------------------------------------------------------------------------
# frame_drawing: the drawing goes out square, with room around it
# ---------------------------------------------------------------------------

def test_a_portrait_drawing_is_sent_square_with_room_around_it():
    framed = openai_service.frame_drawing(drawing_jpeg(300, 600))
    im = Image.open(io.BytesIO(framed))
    side = openai_service.FRAME_CANVAS_PX
    assert im.format == "PNG"
    assert im.size == (side, side)

    # The drawing's longer side spans FRAME_FILL of the canvas, centred: the
    # rows above and below it are all paper.
    span = round(side * openai_service.FRAME_FILL)
    margin = (side - span) // 2
    rgb = im.convert("RGB")
    assert rgb.getpixel((side // 2, margin - 3)) == pytest.approx((240, 236, 228), abs=6)
    assert rgb.getpixel((side // 2, side - margin + 3)) == pytest.approx((240, 236, 228), abs=6)
    assert rgb.getpixel((side // 2, side // 2)) == pytest.approx((20, 20, 160), abs=12)


def test_the_margin_is_the_drawings_own_paper_colour():
    framed = Image.open(io.BytesIO(openai_service.frame_drawing(drawing_jpeg(paper=(150, 120, 90)))))
    assert framed.convert("RGB").getpixel((2, 2)) == pytest.approx((150, 120, 90), abs=6)


def test_a_smaller_fill_leaves_more_room():
    def drawn_rows(fill):
        im = Image.open(io.BytesIO(openai_service.frame_drawing(drawing_jpeg(), fill=fill))).convert("L")
        dark = im.point(lambda v: 255 if v < 100 else 0)
        top, bottom = dark.getbbox()[1], dark.getbbox()[3]
        return bottom - top

    assert drawn_rows(openai_service.FRAME_RETRY_FILL) < drawn_rows(openai_service.FRAME_FILL)


def test_a_phone_photo_is_framed_the_right_way_up():
    """EXIF orientation is applied first: a portrait shot stored landscape
    must be framed as the portrait the user sees."""
    im = Image.new("RGB", (600, 300), (240, 240, 240))
    im.paste((0, 0, 0), (5, 100, 595, 200))           # stored on its side
    exif = Image.Exif()
    exif[0x0112] = 6                                  # rotate 90 CW to view
    buf = io.BytesIO()
    im.save(buf, "JPEG", exif=exif)
    framed = Image.open(io.BytesIO(openai_service.frame_drawing(buf.getvalue()))).convert("L")
    box = framed.point(lambda v: 255 if v < 100 else 0).getbbox()
    assert box[3] - box[1] > box[2] - box[0], "the dark bar must stand upright"


def test_a_transparent_drawing_is_flattened_on_white():
    im = Image.new("RGBA", (200, 400), (0, 0, 0, 0))
    im.paste((10, 10, 10, 255), (80, 20, 120, 380))
    framed = Image.open(io.BytesIO(openai_service.frame_drawing(_png(im))))
    assert framed.mode == "RGB"
    assert framed.getpixel((3, 3)) == (255, 255, 255)


def test_bytes_that_are_not_an_image_are_left_alone():
    assert openai_service.frame_drawing(b"\xff\xd8\xff not really a jpeg") is None


# ---------------------------------------------------------------------------
# touched_edges: is the character cut off?
# ---------------------------------------------------------------------------

def test_a_clean_painting_touches_nothing():
    assert openai_service.touched_edges(CLEAN) == {}


def test_feet_cut_off_at_the_bottom_are_found():
    edges = openai_service.touched_edges(FEET_CUT)
    assert set(edges) == {"bottom"}
    assert edges["bottom"] == SIZE - 80        # the character's full width


def test_every_edge_is_checked():
    assert set(openai_service.touched_edges(painting(top=0))) == {"top"}
    assert set(openai_service.touched_edges(painting(left=0))) == {"left"}
    assert set(openai_service.touched_edges(painting(right=0))) == {"right"}


def test_a_stray_speck_on_the_edge_is_not_a_crop():
    im = Image.open(io.BytesIO(CLEAN)).copy()
    for x in range(openai_service.EDGE_MIN_PIXELS - 1):
        im.putpixel((100 + x, SIZE - 1), (0, 0, 0, 255))
    assert openai_service.touched_edges(_png(im)) == {}


def test_a_soft_antialiased_fringe_is_not_a_crop():
    im = Image.open(io.BytesIO(CLEAN)).copy()
    for x in range(50, 200):
        im.putpixel((x, SIZE - 1), (0, 0, 0, openai_service.EDGE_ALPHA - 1))
    assert openai_service.touched_edges(_png(im)) == {}


def test_an_opaque_painting_cannot_be_judged():
    """No transparent background: the edges are background, not character."""
    assert openai_service.touched_edges(_png(Image.new("RGB", (64, 64), "white"))) is None
    assert openai_service.touched_edges(_png(Image.new("RGBA", (64, 64), (9, 9, 9, 255)))) is None
    assert openai_service.touched_edges(b"not a png") is None


# ---------------------------------------------------------------------------
# The wire
# ---------------------------------------------------------------------------

def _multipart(body: bytes, content_type: str) -> dict:
    boundary = content_type.split("boundary=", 1)[1].strip('"').encode()
    fields = {}
    for part in body.split(b"--" + boundary):
        head, _, value = part.partition(b"\r\n\r\n")
        if b'name="' not in head:
            continue
        name = head.split(b'name="', 1)[1].split(b'"', 1)[0].decode()
        fields[name] = value[:-2] if value.endswith(b"\r\n") else value
    return fields


@pytest.fixture
def wire(monkeypatch):
    """A real OpenAI client whose transport answers with `wire.answers` in
    turn (bytes = a painting, an Exception = a failed call)."""
    class Wire:
        answers = []
        sent = []

    w = Wire()
    w.answers, w.sent = [], []

    def handler(request):
        fields = _multipart(request.read(), request.headers["content-type"])
        w.sent.append({"prompt": fields["prompt"].decode(), "image": fields["image"]})
        answer = w.answers.pop(0)
        if isinstance(answer, Exception):
            return _http.Response(500, json={"error": {"message": str(answer), "type": "server_error"}})
        return _http.Response(200, json={"created": 1, "data": [{"b64_json": base64.b64encode(answer).decode()}]})

    real_openai = openai_service.OpenAI

    def client_on_mock_wire(api_key):
        return real_openai(api_key=api_key, max_retries=0,
                           http_client=_http.Client(transport=_http.MockTransport(handler)))

    monkeypatch.setattr(openai_service, "OpenAI", client_on_mock_wire)
    monkeypatch.setattr(openai_service, "OPENAI_API_KEY", "sk-test")
    return w


def _hero(db, make_user, make_creation, style=None):
    user = make_user(credits=100)
    creation = make_creation(user.id, {"openai_render": "pending"})
    if style:
        creation.style = style
        db.commit()
    get_storage().upload_file(user.id, creation.id, "processed.jpg", drawing_jpeg())
    return user, creation


def _paint(db, user, creation):
    return _run(pipeline.execute_step(creation.id, user.id, "openai_render", db))


def _rendered(user, creation) -> bytes:
    return get_storage().download_file(user.id, creation.id, "rendered.png")


def _framing(db, creation) -> dict:
    db.expire_all()
    step = db.query(CreationStep).filter_by(creation_id=creation.id, step_name="openai_render").one()
    return step.metadata_json["framing"]


def _spends(db, creation):
    return db.query(CreditTransaction).filter_by(creation_id=creation.id, reason="spend").all()


def _refunds(db, creation):
    return db.query(CreditTransaction).filter_by(creation_id=creation.id, reason="refund").all()


def _usage(db, creation):
    db.expire_all()
    return (db.query(UsageEvent).filter_by(creation_id=creation.id)
            .order_by(UsageEvent.created_at).all())


# ---------------------------------------------------------------------------
# The pipeline step
# ---------------------------------------------------------------------------

def test_what_goes_to_openai_is_the_framed_drawing_and_the_framing_prompt(db, make_user, make_creation, wire):
    user, creation = _hero(db, make_user, make_creation, style="anime")
    wire.answers = [CLEAN]
    assert _paint(db, user, creation) == {"status": "completed"}

    (sent,) = wire.sent
    assert sent["prompt"] == openai_service.STYLES["anime"]["prompt"] + "\n\n" + openai_service.FRAMING_PROMPT
    image = Image.open(io.BytesIO(sent["image"]))
    assert image.format == "PNG"
    assert image.size == (openai_service.FRAME_CANVAS_PX,) * 2
    assert _framing(db, creation) == {"attempts": 1, "kept_attempt": 1,
                                      "touched_edges": {}, "first_touched_edges": {}}


def test_feet_cut_off_are_painted_again_and_the_clean_one_is_kept(db, make_user, make_creation, wire):
    user, creation = _hero(db, make_user, make_creation)
    wire.answers = [FEET_CUT, CLEAN]
    assert _paint(db, user, creation) == {"status": "completed"}

    assert len(wire.sent) == 2
    assert _rendered(user, creation) == CLEAN
    # The second try has more room around the drawing.
    first, second = (Image.open(io.BytesIO(s["image"])).convert("L") for s in wire.sent)
    ink = lambda im: im.point(lambda v: 255 if v < 100 else 0).getbbox()  # noqa: E731
    assert ink(second)[3] - ink(second)[1] < ink(first)[3] - ink(first)[1]
    framing = _framing(db, creation)
    assert framing["attempts"] == 2 and framing["kept_attempt"] == 2
    assert framing["touched_edges"] == {}
    assert set(framing["first_touched_edges"]) == {"bottom"}


def test_the_retry_costs_the_user_nothing_more(db, make_user, make_creation, wire):
    """Same step, one charge. The second call is ours to pay, and is booked."""
    user, creation = _hero(db, make_user, make_creation)
    wire.answers = [FEET_CUT, CLEAN]
    _paint(db, user, creation)

    spends = _spends(db, creation)
    assert len(spends) == 1
    assert -spends[0].delta == get_step_cost("openai_render")
    assert _refunds(db, creation) == []
    db.refresh(user)
    assert user.credits == 100 - get_step_cost("openai_render")

    events = _usage(db, creation)
    assert [e.metadata_json["attempt"] for e in events] == [1, 2]
    assert [e.status for e in events] == ["succeeded", "succeeded"]
    assert set(events[0].metadata_json["touched_edges"]) == {"bottom"}
    assert events[1].metadata_json["touched_edges"] == {}


def test_a_clean_first_painting_is_not_painted_twice(db, make_user, make_creation, wire):
    user, creation = _hero(db, make_user, make_creation)
    wire.answers = [CLEAN]
    _paint(db, user, creation)
    assert len(wire.sent) == 1
    assert len(_usage(db, creation)) == 1


def test_never_more_than_one_retry_and_the_lesser_crop_is_kept(db, make_user, make_creation, wire):
    user, creation = _hero(db, make_user, make_creation)
    wire.answers = [FEET_CUT, HAND_CUT]    # bottom: 176 px; left: 20 px
    assert _paint(db, user, creation) == {"status": "completed"}
    assert len(wire.sent) == 2
    assert _rendered(user, creation) == HAND_CUT
    assert set(_framing(db, creation)["touched_edges"]) == {"left"}

    user, creation = _hero(db, make_user, make_creation)
    wire.sent.clear()
    wire.answers = [HAND_CUT, FEET_CUT]
    _paint(db, user, creation)
    assert _rendered(user, creation) == HAND_CUT
    assert _framing(db, creation)["kept_attempt"] == 1


def test_a_failed_retry_keeps_the_first_painting_and_the_step_completes(db, make_user, make_creation, wire):
    user, creation = _hero(db, make_user, make_creation)
    wire.answers = [FEET_CUT, RuntimeError("upstream is down")]
    assert _paint(db, user, creation) == {"status": "completed"}
    assert _rendered(user, creation) == FEET_CUT
    assert _refunds(db, creation) == []
    assert [e.status for e in _usage(db, creation)] == ["succeeded", "failed"]


def test_no_retry_when_the_step_has_no_time_left(db, make_user, make_creation, wire, monkeypatch):
    monkeypatch.setattr(openai_service, "RETRY_IF_FIRST_WITHIN_S", -1.0)
    user, creation = _hero(db, make_user, make_creation)
    wire.answers = [FEET_CUT]
    assert _paint(db, user, creation) == {"status": "completed"}
    assert len(wire.sent) == 1
    assert _framing(db, creation)["attempts"] == 1


def test_a_first_call_that_fails_still_fails_and_refunds(db, make_user, make_creation, wire):
    """The retry is for crops only; a provider error is handled as before."""
    user, creation = _hero(db, make_user, make_creation)
    wire.answers = [RuntimeError("boom")]
    with pytest.raises(Exception):
        _paint(db, user, creation)
    assert len(wire.sent) == 1
    assert len(_refunds(db, creation)) == 1


def test_a_painting_still_cut_after_the_retry_is_not_cached(
        db, make_user, make_creation, wire, monkeypatch):
    monkeypatch.setenv(result_cache.ENV_FLAG, "1")
    monkeypatch.delenv("RAILWAY_ENVIRONMENT_NAME", raising=False)
    monkeypatch.delenv("RAILWAY_ENVIRONMENT", raising=False)

    user, creation = _hero(db, make_user, make_creation)
    wire.answers = [FEET_CUT, FEET_CUT]
    _paint(db, user, creation)

    # Same drawing again: no cache hit, so it gets its own fresh tries.
    user2, creation2 = _hero(db, make_user, make_creation)
    wire.answers = [CLEAN]
    _paint(db, user2, creation2)
    assert len(wire.sent) == 3
    assert _rendered(user2, creation2) == CLEAN

    # ...and a clean one is cached as before.
    user3, creation3 = _hero(db, make_user, make_creation)
    _paint(db, user3, creation3)
    assert len(wire.sent) == 3


def test_framing_off_sends_exactly_what_was_sent_before_the_fix(tmp_path, wire):
    """render_check.py's 'before' column: the drawing file as it is, the
    style's own prompt, no check, no retry."""
    src = tmp_path / "processed.jpg"
    src.write_bytes(drawing_jpeg())
    wire.answers = [FEET_CUT]
    report = {}
    openai_service.render_image(src, tmp_path / "out.png", style="anime", report=report, framing=False)
    (sent,) = wire.sent
    assert sent["prompt"] == openai_service.STYLES["anime"]["prompt"]
    assert sent["image"] == src.read_bytes()
    assert report["attempts"] == 1
