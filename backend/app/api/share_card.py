"""What a chat app shows when someone shares a hero's link.

WhatsApp, Telegram, Facebook and the like read a link's Open Graph tags
without running JavaScript, so the React app's hero page gives them nothing:
a shared hero arrives as a bare address. nginx (frontend/nginx.conf) sends
those crawlers, and only them, from /hero/<id> to the card here; people still
get the app.

The card carries the hero's name and its painting, and the promise the rest
of the funnel makes. It never carries who drew it: the artist's name and age
stay off a page anyone can fetch (Raz's rule for children's data).
"""
from __future__ import annotations

import html
import io
import logging
from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse, Response
from sqlalchemy.orm import Session

from app.config.settings import get_frontend_url
from app.database import get_db
from app.utils.storage import get_storage

logger = logging.getLogger(__name__)

router = APIRouter()

PROMISE = "You draw it. We paint it. It comes alive!"
# The painting first; a hero not painted yet shows its drawing.
PICTURES = ("rendered.png", "original.jpg")
PREVIEW_MAX = 1200  # longest side, px: what the chat apps ask for


def _hero(db: Session, hero_id: str):
    from app.api.creations import _live_creation
    return _live_creation(db, hero_id)


def _title(creation) -> str:
    name = (creation.character_name or "").strip() if creation is not None else ""
    return f"Meet {name}!" if name else "A hero a kid drew"


def _card(title: str, image: Optional[str], url: str) -> str:
    e = lambda s: html.escape(s, quote=True)  # noqa: E731
    image_tags = (
        f'<meta property="og:image" content="{e(image)}">\n'
        f'<meta property="og:image:type" content="image/jpeg">\n'
        f'<meta name="twitter:image" content="{e(image)}">\n'
    ) if image else ""
    return (
        "<!doctype html>\n<html><head><meta charset=\"utf-8\">\n"
        f"<title>{e(title)} · HeroMaker</title>\n"
        '<meta name="robots" content="noindex">\n'
        '<meta property="og:site_name" content="HeroMaker">\n'
        '<meta property="og:type" content="website">\n'
        f'<meta property="og:title" content="{e(title)}">\n'
        f'<meta property="og:description" content="{e(PROMISE)} Tap to see it move.">\n'
        f'<meta property="og:url" content="{e(url)}">\n'
        '<meta name="twitter:card" content="summary_large_image">\n'
        f"{image_tags}"
        f'</head><body><p><a href="{e(url)}">{e(title)}</a></p></body></html>\n'
    )


@router.get("/heroes/{hero_id}/share-card", include_in_schema=False)
def share_card(hero_id: str, db: Session = Depends(get_db)):
    """The hero's link preview, as an HTML page of Open Graph tags."""
    front = get_frontend_url().rstrip("/")
    creation = _hero(db, hero_id)
    if creation is None:
        return HTMLResponse(_card("HeroMaker", None, front or "/"), status_code=404)
    url = f"{front}/hero/{creation.id}?via=share"
    # The picture goes through the frontend's /api proxy, so the card names
    # one host only.
    image = f"{front}/api/v1/heroes/{creation.id}/preview.jpg"
    return HTMLResponse(_card(_title(creation), image, url),
                        headers={"Cache-Control": "private, no-store"})  # same URL as the app page


@router.get("/heroes/{hero_id}/preview.jpg", include_in_schema=False)
def preview_image(hero_id: str, db: Session = Depends(get_db)):
    """The hero's painting (else its drawing) as a JPEG the chat apps all read."""
    from PIL import Image

    creation = _hero(db, hero_id)
    if creation is None:
        return Response(status_code=404)
    storage = get_storage()
    for name in PICTURES:
        try:
            data = storage.download_file(creation.user_id, creation.id, name)
        except Exception:
            continue
        if not data:
            continue
        try:
            img = Image.open(io.BytesIO(data))
            img.thumbnail((PREVIEW_MAX, PREVIEW_MAX))
            if img.mode in ("RGBA", "LA", "P"):
                img = img.convert("RGBA")
                flat = Image.new("RGB", img.size, (255, 255, 255))
                flat.paste(img, mask=img.split()[-1])
                img = flat
            out = io.BytesIO()
            img.convert("RGB").save(out, "JPEG", quality=85, optimize=True)
        except Exception as err:  # a broken file: try the next picture
            logger.warning(f"[{creation.id}] share preview from {name} failed: {err}")
            continue
        return Response(out.getvalue(), media_type="image/jpeg",
                        headers={"Cache-Control": "public, max-age=86400"})
    return Response(status_code=404)
