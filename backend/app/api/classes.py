"""Classes: the teacher's endpoints, the student's and the parent's.

    /api/classes/...        the teacher (signed in)
    /api/class/join...      a student joining with a PIN (no account)
    /api/class/me...        a student with a pass: their one hero
    /api/class/claim/...    a parent keeping their child's hero

The rules live in app/services/classes.py; the product in
docs/product/class-sessions.md. A student's hero is made by the same two
functions as any hero (creations.create_with_drawing, creations.start_pipeline),
owned by the class's wallet, so the ordinary pipeline charges and refunds it.
"""
import logging
from contextlib import contextmanager
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.creations import _checked_style, create_with_drawing, start_pipeline
from app.database import get_db
from app.models import ClassGuest, ClassRoom, Creation, User
from app.config import packs as packs_config
from app.services import classes, demo_library, lemonsqueezy
from app.schemas.creation import file_versions
from app.services.auth import get_current_user_required, verify_access_token
from app.services.task_manager import get_task_manager

logger = logging.getLogger(__name__)

teacher_router = APIRouter()
student_router = APIRouter()

COOKIE_PATH = "/api/class"
# A pass and a browser marker outlive any one session: a student who missed the
# hero last week makes it with the same pass next week.
COOKIE_MAX_AGE = 60 * 60 * 24 * 365


@contextmanager
def _refusals():
    try:
        yield
    except classes.ClassError as e:
        raise HTTPException(status_code=e.status, detail=e.message)


# ---------------------------------------------------------------------------
# Teacher
# ---------------------------------------------------------------------------

class CreateClassRequest(BaseModel):
    title: str
    seats: int
    ages: Optional[str] = None


class SchoolRequest(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None


class SeatsRequest(BaseModel):
    seats: int


class BuySeatsRequest(BaseModel):
    seats: int
    title: Optional[str] = None
    ages: Optional[str] = None
    redirect_url: Optional[str] = None


class StartRequest(BaseModel):
    minutes: int = 45
    approve_first: bool = False


class ExtendRequest(BaseModel):
    minutes: int = 15


@teacher_router.get("")
def list_classes(db: Session = Depends(get_db), user: User = Depends(get_current_user_required)):
    rows = db.query(ClassRoom).filter(ClassRoom.owner_id == user.id).order_by(ClassRoom.created_at.desc()).all()
    return {"classes": [classes.class_view(db, c) for c in rows], "hero_cost": classes.hero_cost(),
            "school": classes.school_view(user), "seat_price": seat_price()}


@teacher_router.get("/school")
def get_school(user: User = Depends(get_current_user_required)):
    return {"school": classes.school_view(user)}


@teacher_router.put("/school")
def put_school(body: SchoolRequest, db: Session = Depends(get_db),
               user: User = Depends(get_current_user_required)):
    """The teacher's school: name and type required, city and country not."""
    with _refusals():
        return {"school": classes.set_school(db, user, body.name, body.type, body.city, body.country)}


def seat_price() -> Optional[dict]:
    """The class price, for "Pay $X for N seats": a part per order plus a part
    per seat, in cents (app/config/packs.py has the numbers and their margin).
    None hides the option: no class-seats variant, or no store, configured,
    exactly as GET /api/payments/packs omits a pack it cannot sell."""
    if not (lemonsqueezy.is_configured() and packs_config.class_seats_variant_id()):
        return None
    return {
        "order_cents": packs_config.price_cents(packs_config.CLASS_ORDER_USD_MICROS),
        "seat_cents": packs_config.price_cents(packs_config.CLASS_SEAT_USD_MICROS),
        "max_seats": packs_config.CLASS_MAX_SEATS,
    }


def _open_seats_checkout(db: Session, user: User, classroom: ClassRoom, seats: int,
                         redirect_url: Optional[str]) -> dict:
    """A Lemon Squeezy checkout for `seats` seats of `classroom`. Nothing is
    granted here: the signed webhook adds the seats when the money arrives."""
    if redirect_url:
        # The app asks to come back to the class, whose id it may not know yet.
        redirect_url = redirect_url.replace("{class_id}", classroom.id)
    try:
        url, quote = lemonsqueezy.create_class_seats_checkout(
            class_id=classroom.id, class_title=classroom.title, seats=seats,
            user_id=user.id, email=user.email, redirect_url=redirect_url,
        )
    except lemonsqueezy.NotConfiguredError as exc:
        logger.error("Class seat checkout unavailable: %s", exc)
        raise HTTPException(status_code=503, detail="Payments are unavailable right now.") from exc
    except lemonsqueezy.LemonSqueezyError as exc:
        logger.error("Class seat checkout failed for class %s: %s", classroom.id, exc)
        raise HTTPException(status_code=502, detail="Payments are unavailable right now.") from exc
    classes.funnel("class_checkout_opened", class_id=classroom.id, seats=quote["seats"], cents=quote["price_cents"])
    return {
        "checkout_url": url,
        "class_id": classroom.id,
        "seats": quote["seats"],
        "price_cents": quote["price_cents"],
        "price_display": quote["price_display"],
        "test_mode": lemonsqueezy.test_mode(),
    }


@teacher_router.post("/buy", status_code=201)
def buy_new_class(body: BuySeatsRequest, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user_required)):
    """A new class, paid with money at the class price: the class is made now
    with no seats, and the seats arrive with the payment."""
    if seat_price() is None:
        raise HTTPException(status_code=503, detail="Payments are unavailable right now.")
    with _refusals():
        classroom = classes.create_class_to_buy(db, user, body.title or "", body.seats, body.ages)
    try:
        return _open_seats_checkout(db, user, classroom, body.seats, body.redirect_url)
    except HTTPException:
        classes.discard_unpaid_class(db, classroom)
        raise


@teacher_router.post("", status_code=201)
def create_class(body: CreateClassRequest, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user_required)):
    with _refusals():
        classroom = classes.create_class(db, user, body.title, body.seats, body.ages)
    return classes.class_view(db, classroom, with_roster=True)


@teacher_router.get("/{class_id}")
def get_class(class_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user_required)):
    with _refusals():
        classroom = classes.owned_class(db, user, class_id)
    return {**classes.class_view(db, classroom, with_roster=True), "seat_price": seat_price()}


@teacher_router.post("/{class_id}/seats")
def add_seats(class_id: str, body: SeatsRequest, db: Session = Depends(get_db),
              user: User = Depends(get_current_user_required)):
    with _refusals():
        classroom = classes.owned_class(db, user, class_id)
        classes.add_seats(db, classroom, user, body.seats)
    return classes.class_view(db, classroom, with_roster=True)


@teacher_router.post("/{class_id}/buy")
def buy_seats(class_id: str, body: BuySeatsRequest, db: Session = Depends(get_db),
              user: User = Depends(get_current_user_required)):
    """More seats for an existing class, paid with money at the class price."""
    if seat_price() is None:
        raise HTTPException(status_code=503, detail="Payments are unavailable right now.")
    with _refusals():
        classroom = classes.owned_class(db, user, class_id)
        if classroom.owner_id != user.id:
            raise classes.ClassError(404, "Class not found", "not_found")
        classes.check_seats(body.seats, already=classroom.seats)
    return _open_seats_checkout(db, user, classroom, body.seats, body.redirect_url)


@teacher_router.post("/{class_id}/start")
def start_class(class_id: str, body: StartRequest, db: Session = Depends(get_db),
                user: User = Depends(get_current_user_required)):
    with _refusals():
        classroom = classes.owned_class(db, user, class_id)
        classes.start_session(db, classroom, body.minutes, body.approve_first)
    return classes.class_view(db, classroom, with_roster=True)


@teacher_router.post("/{class_id}/extend")
def extend_class(class_id: str, body: ExtendRequest, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user_required)):
    with _refusals():
        classroom = classes.owned_class(db, user, class_id)
        session = classes.live_session(db, classroom)
        if session is None:
            raise classes.ClassError(409, "This class is not live", "not_live")
        classes.extend_session(db, session, body.minutes)
    return classes.class_view(db, classroom, with_roster=True)


@teacher_router.post("/{class_id}/end")
def end_class(class_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user_required)):
    with _refusals():
        classroom = classes.owned_class(db, user, class_id)
        session = classes.live_session(db, classroom)
        if session is not None:
            classes.end_session(db, session)
    return classes.class_view(db, classroom, with_roster=True)


@teacher_router.post("/{class_id}/students/{guest_id}/{action}")
def student_action(class_id: str, guest_id: str, action: str, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user_required)):
    status = {"approve": "approved", "block": "blocked"}.get(action)
    if status is None:
        raise HTTPException(status_code=404, detail="Unknown action")
    with _refusals():
        classroom = classes.owned_class(db, user, class_id)
        classes.set_guest_status(db, classroom, guest_id, status)
    return classes.class_view(db, classroom, with_roster=True)


@teacher_router.get("/{class_id}/stage")
def class_stage(class_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user_required)):
    """Every finished hero of the class, for the class stage (all dance together)."""
    with _refusals():
        classroom = classes.owned_class(db, user, class_id)
    return {"title": classroom.title, "heroes": classes.stage_manifest(db, classroom)}


# ---------------------------------------------------------------------------
# Student
# ---------------------------------------------------------------------------

def _secure(request: Request) -> bool:
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    return proto.split(",")[0].strip() == "https"


def _set_cookie(response: Response, request: Request, name: str, value: str) -> None:
    response.set_cookie(name, value, max_age=COOKIE_MAX_AGE, path=COOKIE_PATH, httponly=True,
                        samesite="lax", secure=_secure(request))


def _device_token(request: Request) -> Optional[str]:
    return request.headers.get(classes.DEVICE_HEADER) or request.cookies.get(classes.DEVICE_COOKIE)


def _pass_token(request: Request) -> Optional[str]:
    return request.headers.get(classes.GUEST_HEADER) or request.cookies.get(classes.GUEST_COOKIE)


def _guest(request: Request, db: Session) -> ClassGuest:
    guest = classes.guest_by_token(db, _pass_token(request))
    if guest is None:
        # 403, never 401: a 401 makes the app forget whoever is signed in.
        raise HTTPException(status_code=403, detail="Join the class first")
    return guest


class JoinRequest(BaseModel):
    pin: str
    first_name: Optional[str] = None
    age: Optional[int] = None


@student_router.get("/join/{pin}")
def find_class(pin: str, request: Request, response: Response, db: Session = Depends(get_db)):
    """Is there an open class with this PIN? Gives the browser its marker."""
    device = _device_token(request)
    with _refusals():
        session = classes.find_open_by_pin(db, pin, device)
    if not device:
        device = classes.new_token()
        _set_cookie(response, request, classes.DEVICE_COOKIE, device)
    classroom = session.classroom
    guest = classes.guest_by_token(db, _pass_token(request))
    return {
        "title": classroom.title,
        "seats_left": max(0, classroom.seats - classroom.seats_used),
        "seconds_left": classes.session_view(session)["seconds_left"],
        "device_token": device,
        # This browser already joined this class: skip the name, show its hero.
        "joined": guest is not None and guest.class_id == classroom.id,
    }


@student_router.post("/join")
def join_class(body: JoinRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    device = _device_token(request)
    with _refusals():
        session = classes.find_open_by_pin(db, body.pin, device)
        guest, token, device = classes.join(db, session, body.first_name, body.age, device, _pass_token(request))
    _set_cookie(response, request, classes.DEVICE_COOKIE, device)
    if token:
        _set_cookie(response, request, classes.GUEST_COOKIE, token)
    return {**classes.guest_view(db, guest), "pass": token, "device_token": device}


@student_router.post("/leave")
def leave(request: Request, response: Response):
    """"Next student" on a shared tablet: this browser drops its pass (the
    student and their hero are untouched). The browser marker stays, so the
    next child on it waits for the teacher's approval."""
    response.delete_cookie(classes.GUEST_COOKIE, path=COOKIE_PATH)
    return {"ok": True}


@student_router.get("/me")
def my_hero(request: Request, db: Session = Depends(get_db)):
    return classes.guest_view(db, _guest(request, db))


@student_router.post("/me/hero", status_code=201)
async def make_my_hero(
    request: Request,
    image_file: UploadFile = File(...),
    style: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    task_manager=Depends(get_task_manager),
):
    """The student's one hero: spends their pass and a class seat, then runs
    the ordinary pipeline, paid from the class's prepaid seats."""
    guest = _guest(request, db)
    style = _checked_style(style)
    contents = await image_file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="That photo is empty. Try again.")

    # DEMO ONLY (off unless PIPELINE_DEMO_LIBRARY is set; never in production):
    # a drawing byte-identical to a library hero's is made in the pipeline's
    # existing mock mode. See app/services/demo_library.py.
    mock = demo_library.match(db, contents)

    def create(classroom: ClassRoom) -> Creation:
        return create_with_drawing(
            db, classroom.wallet_user_id, contents,
            character_name=mock.character_name if mock else None,
            name=guest.first_name, age=guest.age, style=style,
            class_id=classroom.id, is_public=False,
        )

    with _refusals():
        creation = classes.start_guest_hero(db, guest, create)
    start_pipeline(creation, db, task_manager, mock_creation_id=mock.id if mock else None, style=style)
    db.refresh(guest)
    return classes.guest_view(db, guest)


@student_router.post("/me/hero/retry")
async def retry_my_hero(request: Request, db: Session = Depends(get_db), task_manager=Depends(get_task_manager)):
    """A hero that failed is made again: same pass, same seat, charged again
    to the class and refunded again if it fails again.

    `async` for the same reason as make_my_hero and every endpoint in
    creations.py that starts a run: start_pipeline hands its task to the event
    loop, and FastAPI runs a plain `def` in a worker thread, which has none."""
    guest = _guest(request, db)
    creation = db.query(Creation).filter(Creation.id == guest.creation_id, Creation.deleted_at.is_(None)).first()
    if creation is None or creation.status != "failed":
        raise HTTPException(status_code=409, detail="Nothing to try again")
    if classes.current_session_for(db, guest) is None:
        raise HTTPException(status_code=410, detail="Class time is over")
    if guest.status == "blocked":
        raise HTTPException(status_code=403, detail="Ask your teacher")
    from_step = next((s.step_name for s in sorted(creation.steps, key=lambda s: _step_index(s.step_name))
                      if s.status in ("failed", "pending")), None)
    start_pipeline(creation, db, task_manager, from_step=from_step)
    db.refresh(guest)
    return classes.guest_view(db, guest)


def _step_index(name: str) -> int:
    from app.config.steps import get_all_step_names
    names = get_all_step_names()
    return names.index(name) if name in names else len(names)


# ---------------------------------------------------------------------------
# Parent
# ---------------------------------------------------------------------------

def _claim_view(db: Session, guest: ClassGuest, viewer_id: Optional[str] = None) -> dict:
    """What the claim link shows. The token is its only credential, so this
    holds the child's first name and age, the class's title, and this one
    hero's summary and public files. Nothing about the class, the teacher,
    other children or the account that kept it.

    Once kept, the link is spent: it says only that the hero has a home,
    except to the parent who kept it. A link forwarded to a class group must
    not show anyone else the child's name, age or hero."""
    kept_by_you = viewer_id is not None and guest.claimed_by == viewer_id
    if guest.claimed_by is not None and not kept_by_you:
        return {"first_name": None, "age": None, "class_title": None, "hero": None,
                "claimed": True, "kept_by_you": False}
    creation = db.query(Creation).filter(Creation.id == guest.creation_id).first()
    hero = classes.hero_view(creation)
    if hero is not None:
        # The page shows the hero live, as its own page does (HeroLive): which
        # of its files exist, each with the version its URL carries.
        hero["file_versions"] = file_versions(creation)
    return {
        "first_name": guest.first_name,
        "age": guest.age,
        "class_title": guest.classroom.title,
        "hero": hero,
        "claimed": guest.claimed_by is not None,
        # Lets the parent who kept it, opening the link again, see that it is
        # theirs rather than "already has a home".
        "kept_by_you": kept_by_you,
    }


def _viewer_id(request: Request) -> Optional[str]:
    """The signed-in account looking at a claim link, if any. Never refuses:
    a stale token on a parent's phone must not hide the child's hero."""
    auth = request.headers.get("authorization") or ""
    if not auth.lower().startswith("bearer "):
        return None
    try:
        return verify_access_token(auth.split(" ", 1)[1].strip())
    except Exception:
        return None


@student_router.get("/claim/{token}")
def see_claim(token: str, request: Request, db: Session = Depends(get_db)):
    with _refusals():
        guest = classes.guest_by_claim(db, token)
    classes.funnel("parent_link_opened", class_id=guest.class_id, guest=guest.id)
    return _claim_view(db, guest, _viewer_id(request))


@student_router.post("/claim/{token}")
def claim_hero(token: str, db: Session = Depends(get_db), user: User = Depends(get_current_user_required)):
    with _refusals():
        guest = classes.guest_by_claim(db, token)
        classes.claim(db, guest, user)
    db.refresh(guest)
    return _claim_view(db, guest, user.id)
