"""
The hero render is a cut-out: OpenAI is asked for a transparent background, and
the thumbnails served from it keep that transparency instead of turning it black.
"""
import base64
import io
from types import SimpleNamespace

from PIL import Image

from app.api import files as files_api
from app.services import openai as openai_service


def _png_bytes(mode="RGBA", alpha=0):
    img = Image.new(mode, (64, 64), (255, 0, 0, alpha) if mode == "RGBA" else (255, 0, 0))
    if mode == "RGBA":
        img.paste((0, 128, 255, 255), (16, 16, 48, 48))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def test_render_asks_openai_for_a_transparent_png(tmp_path, monkeypatch):
    calls = {}

    class FakeImages:
        def edit(self, **kwargs):
            calls.update(kwargs)
            return SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(_png_bytes()).decode())])

    class FakeClient:
        def __init__(self, api_key):
            self.images = FakeImages()

    monkeypatch.setattr(openai_service, "OpenAI", FakeClient)
    monkeypatch.setattr(openai_service, "OPENAI_API_KEY", "test-key")

    drawing = tmp_path / "processed.jpg"
    Image.new("RGB", (32, 32), "white").save(drawing, "JPEG")
    out = tmp_path / "rendered.png"

    openai_service.render_image(drawing, out)

    assert calls["background"] == "transparent"
    assert calls["output_format"] == "png"
    # Price is quoted for exactly this model, size and quality; keep them.
    assert (calls["model"], calls["size"], calls["quality"]) == ("gpt-image-1", "1024x1024", "high")
    assert "Transparent background" in calls["prompt"]
    with Image.open(out) as saved:
        assert saved.mode == "RGBA"


def test_thumbnail_of_a_transparent_render_stays_transparent(tmp_path):
    src = tmp_path / "rendered.png"
    src.write_bytes(_png_bytes())
    thumb = tmp_path / "thumb_rendered.png"

    assert files_api._generate_thumbnail(src, thumb)

    with Image.open(thumb) as t:
        assert t.format == "PNG"
        assert t.mode == "RGBA"
        assert t.getpixel((0, 0))[3] == 0, "the corner must stay see-through, not black"


def test_thumbnail_of_an_opaque_image_is_still_a_small_jpeg(tmp_path):
    src = tmp_path / "original.jpg"
    Image.new("RGB", (800, 600), "white").save(src, "JPEG")
    thumb = tmp_path / "thumb_original.jpg"

    assert files_api._generate_thumbnail(src, thumb)

    with Image.open(thumb) as t:
        assert t.format == "JPEG"
        assert max(t.size) <= max(files_api.THUMBNAIL_SIZE)
