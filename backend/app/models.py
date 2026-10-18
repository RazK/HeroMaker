import uuid
from datetime import datetime, timedelta, date
from typing import Optional
from sqlalchemy import Column, String, Boolean, DateTime, Date, Text, JSON, ForeignKey, Integer, BigInteger, false
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import relationship
from app.database import Base
from app.config.steps import STEPS, get_last_step

class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String, unique=True, index=True)
    google_id = Column(String, unique=True, index=True, nullable=True)
    username = Column(String, unique=True, index=True)
    name = Column(String, nullable=True)  # User's real name (default for creation character_name)
    date_of_birth = Column(Date, nullable=True)  # User's date of birth (used to calculate age)
    password_hash = Column(String, nullable=True)
    credits = Column(Integer, default=0)
    is_admin = Column(Boolean, default=False)
    subscription_tier = Column(String, default='free')
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    # Set when the person deletes their account. The row stays, emptied of
    # everything that identifies them, because payments and the credit ledger
    # point at it and are kept for tax. A deleted user cannot sign in. See
    # app/services/account_deletion.py and m012_user_soft_delete.
    deleted_at = Column(DateTime, nullable=True, index=True)
    # A teacher's home is their classes (app/services/classes.py). Chosen at
    # sign-up or from the account sheet; anyone may switch it.
    is_teacher = Column(Boolean, nullable=False, default=False, server_default=false())
    # "person" for everyone who signs in. "class_wallet" is the account a class
    # holds its prepaid seats in: no email, no password, it can never sign in,
    # and it owns the class's heroes until a parent claims one. See m015_classes.
    kind = Column(String(20), nullable=False, default="person", server_default="person", index=True)
    # A teacher's school, asked once, before their first class (m016). Only
    # the name and the type are required; city and country help us see where
    # classes happen. Shown in the admin console's Schools list.
    school_name = Column(String(80), nullable=True)
    school_city = Column(String(60), nullable=True)
    school_country = Column(String(60), nullable=True)
    # One of app.services.classes.SCHOOL_TYPES.
    school_type = Column(String(20), nullable=True)

    creations = relationship("Creation", back_populates="user")
    
    def calculate_age(self) -> Optional[int]:
        """Calculate age from date_of_birth."""
        if not self.date_of_birth:
            return None
        today = date.today()
        age = today.year - self.date_of_birth.year
        # Adjust if birthday hasn't occurred this year
        if (today.month, today.day) < (self.date_of_birth.month, self.date_of_birth.day):
            age -= 1
        return age

class Creation(Base):
    __tablename__ = "creations"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"))
    character_name = Column(String, nullable=True)
    name = Column(String, nullable=True)  # Creator's name (user who created this)
    age = Column(Integer, nullable=True)  # Person's age (for original image)
    is_public = Column(Boolean, default=True)
    metadata_json = Column(JSON, default={}, name="metadata") # 'metadata' is reserved in Base
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    # Set when the owner deletes the hero. The row stays because the credit
    # ledger and usage_events reference it: a paid hero's cost must remain
    # attributable after it is gone from the app. See m009_creation_soft_delete.
    deleted_at = Column(DateTime, nullable=True, index=True)
    # The look of the painting: a key of app.services.openai.STYLES. NULL is
    # the default ("pixar"), which every hero made before styles existed is.
    # See m011_creation_style.
    style = Column(String, nullable=True)
    # Starred by an admin: shown under "Editors' choice", the gallery's default
    # view. New heroes start unstarred; m013_creation_featured starred every
    # finished hero that existed when it ran.
    featured = Column(Boolean, nullable=False, default=False, server_default=false(), index=True)
    # Set while the hero belongs to a class: made by a student, paid from the
    # class's prepaid seats. Cleared when a parent claims it into their own
    # account. A class hero is in no public gallery, only in its class's. See
    # app/services/classes.py and m015_classes.
    class_id = Column(String, ForeignKey("classes.id"), nullable=True, index=True)

    user = relationship("User", back_populates="creations")
    steps = relationship("CreationStep", back_populates="creation", cascade="all, delete-orphan", lazy="select")
    
    @property
    def status(self) -> str:
        """Calculate status: completed when last step done, failed if any failed, processing if any processing, else pending."""
        if not self.steps:
            return "pending"
        
        steps_by_name = {s.step_name: s for s in self.steps}
        
        # Check if any step failed
        if any(s.status == "failed" for s in self.steps):
            return "failed"
        
        # Check if any step is processing
        if any(s.status == "processing" for s in self.steps):
            return "processing"
        
        # Check if last step is completed (creation is done)
        last_step = get_last_step()
        if last_step:
            last_step_record = steps_by_name.get(last_step["name"])
            if last_step_record and last_step_record.status == "completed":
                return "completed"
        
        return "pending"
    
    @property
    def completed_at(self) -> Optional[datetime]:
        """Get completed_at from last step's completed_at (if all steps completed)."""
        if self.status != "completed":
            return None

        if not self.steps:
            return None
        
        steps_by_name = {s.step_name: s for s in self.steps}
        
        # Get completed_at of last step in STEPS order
        for step_config in reversed(STEPS):
            step = steps_by_name.get(step_config["name"])
            if step and step.completed_at:
                return step.completed_at
        
        return None
    
    @property
    def error_message(self) -> Optional[str]:
        """Get error_message from first failed step (in STEPS order)."""
        if self.status != "failed":
            return None

        if not self.steps:
            return None
        
        steps_by_name = {s.step_name: s for s in self.steps}
        
        # Get error_message from first failed step
        for step_config in STEPS:
            step = steps_by_name.get(step_config["name"])
            if step and step.status == "failed" and step.error_message:
                return step.error_message
        
        return None
    


class CreationStep(Base):
    __tablename__ = "creation_steps"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    creation_id = Column(String, ForeignKey("creations.id"), nullable=False, index=True)
    step_name = Column(String, nullable=False, index=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    estimated_duration = Column(Integer, nullable=True)  # seconds
    estimated_progress = Column(Integer, nullable=True)  # 0-100, nullable
    estimated_completion_time = Column(DateTime, nullable=True)  # Calculated completion time, updated when progress changes
    status = Column(String, default="pending")  # pending, processing, completed, failed
    error_message = Column(Text, nullable=True)
    metadata_json = Column(JSON, default={}, name="metadata")  # Step-specific metadata (e.g., Meshy API task IDs, animation URLs)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationship
    creation = relationship("Creation", back_populates="steps")


class Coupon(Base):
    """Coupon codes that can be redeemed for credits."""
    __tablename__ = "coupons"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    code = Column(String, unique=True, index=True, nullable=False)  # e.g., "HERO-XXXXXX"
    credit_amount = Column(Integer, nullable=False)  # Credits awarded on redemption
    max_uses = Column(Integer, default=1)  # Maximum total redemptions (default: single-use)
    current_uses = Column(Integer, default=0)  # How many times it's been redeemed
    allow_multiple_per_user = Column(Boolean, default=False)  # Allow same user to redeem multiple times
    expires_at = Column(DateTime, nullable=True)  # NULL = never expires
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    redemptions = relationship("CouponRedemption", back_populates="coupon", cascade="all, delete-orphan")


class CouponRedemption(Base):
    """Tracks which users have redeemed which coupons (single-use-per-user)."""
    __tablename__ = "coupon_redemptions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    coupon_id = Column(String, ForeignKey("coupons.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    redeemed_at = Column(DateTime, default=datetime.utcnow)

    coupon = relationship("Coupon", back_populates="redemptions")
    user = relationship("User")


# ============================================================================
# Financial spine: ledger, per-call cost capture, revenue
# ============================================================================
#
# Three rules govern everything below.
#
# 1. Money is an integer number of USD micros. Never a float, never a Decimal
#    in the database. `cost_usd_micros`, `gross_usd_micros` etc. are exact.
# 2. Credits are an append-only ledger. `users.credits` survives as a
#    denormalised cache so existing read paths keep working, but the ledger is
#    the truth and `sum(delta) == users.credits` is an invariant you can check
#    (see app/services/ledger.py::verify_user_balance).
# 3. Cost is captured per provider call, including the calls that fail and the
#    ones that get retried, because that is where the money actually goes.

# JSON on SQLite, JSONB on Postgres. JSONB is the right type on Postgres
# (binary, indexable) and does not exist on SQLite, so the column is declared
# once here as a variant and reused. Both dialects then work unmodified.
JSONVariant = JSON().with_variant(postgresql.JSONB, "postgresql")


# ---- credit ledger --------------------------------------------------------

# Allowed values for CreditTransaction.reason. Kept as a plain tuple of strings
# rather than a DB-level ENUM: adding a value to a Postgres ENUM needs a
# migration and SQLite has no ENUM at all, so the constraint lives in the
# service layer where it can be changed without a schema change.
CREDIT_REASONS = (
    "signup_grant",     # credits granted when an account is created
    "purchase",         # credits bought with money (external_ref = payment ref)
    "coupon",           # credits from redeeming a coupon code
    "spend",            # credits consumed by a pipeline step (delta < 0)
    "refund",           # credits returned, e.g. a step we failed to deliver
    "admin_adjust",     # manual correction by an admin, always explain in metadata
    # Not in the original spec, added deliberately: the backfill migration has
    # to turn a pre-ledger `users.credits` integer into a row, and it does not
    # know where those credits came from. Labelling them "opening_balance" is
    # honest; labelling them "signup_grant" would be inventing history.
    "opening_balance",
    # The person deleted their account; the balance left is forfeited, as the
    # delete dialog says. A row, so sum(delta) == users.credits still holds.
    "account_deleted",
    # Credits moved between a teacher and a class's wallet: negative on the
    # teacher when they pay for a class's seats, positive on the class.
    # app/services/classes.py.
    "class_seats",
)


class CreditTransaction(Base):
    """
    Append-only credit ledger. One row per movement of credits.

    Never UPDATE or DELETE a row here. A mistake is corrected by appending a
    compensating row (reason="admin_adjust" or "refund"), which is what makes
    the table auditable: "why do I have 7 credits" is answered by reading it.
    """
    __tablename__ = "credit_transactions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)

    # Signed. Positive adds credits, negative spends them. Never zero.
    delta = Column(Integer, nullable=False)

    # One of CREDIT_REASONS.
    reason = Column(String, nullable=False, index=True)

    # The external system's idempotency key - a payment provider's order id, a
    # coupon redemption id, whatever uniquely names the event that caused this
    # movement. UNIQUE, and NULL is allowed many times over (both SQLite and
    # Postgres treat NULLs as distinct in a unique index).
    #
    # THIS COLUMN IS THE WHOLE DEFENCE AGAINST WEBHOOK REPLAY. A payment
    # provider will deliver the same webhook twice; the second insert violates
    # this constraint and the credit is not granted a second time.
    external_ref = Column(String, nullable=True, unique=True)

    # Which creation this movement relates to, when it relates to one.
    creation_id = Column(String, ForeignKey("creations.id"), nullable=True, index=True)

    # Running balance after applying `delta`, computed under the same lock that
    # wrote the row. Lets you audit the ledger without summing it, and makes a
    # gap or a double-apply visible by inspection.
    balance_after = Column(Integer, nullable=False)

    metadata_json = Column(JSONVariant, default=dict, name="metadata")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    user = relationship("User")


# ---- per-call cost capture ------------------------------------------------

USAGE_STATUSES = (
    "submitted",   # call accepted by the provider, outcome not yet known
    "succeeded",
    "failed",
)


class UsageEvent(Base):
    """
    One row per paid provider call - including failures and retries.

    Retries are most of the cost overrun and are exactly what nobody measures,
    so they get a row like everything else. The cost of a hero is the SUM of the
    rows carrying its creation_id, not the list price of one happy path.
    """
    __tablename__ = "usage_events"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    creation_id = Column(String, ForeignKey("creations.id"), nullable=True, index=True)

    # Pipeline step that made the call, e.g. "openai_render". Nullable because a
    # call can be made outside the pipeline (a script, a manual retry).
    step_name = Column(String, nullable=True, index=True)

    # One of app.config.pricing.PROVIDERS.
    provider = Column(String, nullable=False, index=True)

    # Provider-specific operation, e.g. "images.edit", "image-to-3d".
    operation = Column(String, nullable=False)

    # How many billable units. Images for OpenAI, Meshy credits for Meshy.
    units = Column(Integer, nullable=False, default=1)

    # Integer USD micros. NEVER a float - see app/config/pricing.py.
    cost_usd_micros = Column(Integer, nullable=False, default=0)

    # The provider's own id for this call (Meshy task id, OpenAI request id) so
    # a line in our report can be reconciled against a line on their invoice.
    provider_ref = Column(String, nullable=True, index=True)

    status = Column(String, nullable=False, default="submitted", index=True)

    # Free-form: error class on failure, "list_price_usd_micros" for a failed
    # call that was not billed, request parameters worth keeping.
    metadata_json = Column(JSONVariant, default=dict, name="metadata")

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = relationship("User")


# ---- revenue --------------------------------------------------------------

PAYMENT_STATUSES = (
    "pending",
    "succeeded",
    "refunded",
    "failed",
)


class Payment(Base):
    """
    Money in. Nothing writes rows here yet - payments land next phase - but the
    margin report already reads from this table, so the payments integration
    only has to INSERT rows and the report starts showing revenue.

    gross = what the customer was charged.
    fee   = what the payment provider kept.
    net   = what actually arrived in the bank. Margin is computed against net,
            because gross margin against gross revenue flatters by ~3%.
    """
    __tablename__ = "payments"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)

    # "stripe", "paddle", "apple", ...
    provider = Column(String, nullable=False, index=True)

    # The provider's charge/order id. UNIQUE: same replay defence as the ledger.
    provider_ref = Column(String, nullable=False, unique=True)

    gross_usd_micros = Column(Integer, nullable=False, default=0)
    fee_usd_micros = Column(Integer, nullable=False, default=0)
    net_usd_micros = Column(Integer, nullable=False, default=0)

    status = Column(String, nullable=False, default="pending", index=True)

    metadata_json = Column(JSONVariant, default=dict, name="metadata")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    user = relationship("User")


class PasswordResetToken(Base):
    """
    One "forgot password" link. Single use, expires after an hour.

    Only the sha256 of the token is stored: the token itself exists in the
    email and nowhere else, so a leaked database cannot be turned into password
    resets. Written by POST /api/auth/forgot-password, consumed by
    POST /api/auth/reset-password (see app/services/password_reset.py).
    """
    __tablename__ = "password_reset_tokens"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    token_hash = Column(String(64), nullable=False, unique=True)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class RecurringExpense(Base):
    """
    A bill that arrives every month whatever happens: the Railway plan, the
    domain, an email service. Edited from the admin console's Money section,
    and part of its net figure.

    A charge falls on `started_on`'s day of the month, every month from
    `started_on` on, while the row is active. That is enough to answer "what did
    these cost in this period" and "what is due in the next 30 days" without
    pretending to be an accounting system. See app/services/company_finance.py
    and m014_recurring_expenses.
    """
    __tablename__ = "recurring_expenses"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(200), nullable=False)
    # Integer USD micros like every other amount here. BIGINT: a Postgres
    # INTEGER of micros tops out at $2,147.
    amount_usd_micros = Column(BigInteger, nullable=False)
    started_on = Column(Date, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)



class ClassRoom(Base):
    """
    A teacher's class: a name and seats paid for up front, one hero per seat.

    The seats' credits sit in the class's own wallet account (`wallet_user_id`,
    a User of kind "class_wallet"), moved there from the teacher through the
    ledger when the class is paid for. A student's hero is a Creation owned by
    that wallet, so the ordinary pipeline charges it and refunds it on failure.
    Unused seats stay on the class for its next session. See
    docs/product/class-sessions.md.
    """
    __tablename__ = "classes"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    owner_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    wallet_user_id = Column(String, ForeignKey("users.id"), nullable=False, unique=True)
    title = Column(String(60), nullable=False)
    # Seats paid for, and seats taken by a hero. seats_used <= seats always:
    # it only moves through one conditional UPDATE (classes._take_seat).
    seats = Column(Integer, nullable=False, default=0)
    seats_used = Column(Integer, nullable=False, default=0)
    # The children's ages, one of app.services.classes.AGE_BANDS, or None (m016).
    ages = Column(String(8), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    owner = relationship("User", foreign_keys=[owner_id])
    sessions = relationship("ClassSession", back_populates="classroom", order_by="ClassSession.created_at")


class ClassSession(Base):
    """One live slot of a class: a PIN, a QR code and a window to make heroes in."""
    __tablename__ = "class_sessions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    class_id = Column(String, ForeignKey("classes.id"), nullable=False, index=True)
    # Six digits, unique among OPEN sessions only (checked when one starts).
    pin = Column(String(6), nullable=False, index=True)
    starts_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    ends_at = Column(DateTime, nullable=False, index=True)
    # Every student waits for the teacher's tap before making a hero.
    approve_first = Column(Boolean, nullable=False, default=False)
    status = Column(String(16), nullable=False, default="open")  # open | ended
    ended_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    classroom = relationship("ClassRoom", back_populates="sessions")


class ClassGuest(Base):
    """
    One student: a first name, an optional age, and a one-hero pass held by
    their browser. No account, no email, no password; only hashes are stored.
    """
    __tablename__ = "class_guests"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    class_id = Column(String, ForeignKey("classes.id"), nullable=False, index=True)
    session_id = Column(String, ForeignKey("class_sessions.id"), nullable=False, index=True)
    first_name = Column(String(20), nullable=False)
    age = Column(Integer, nullable=True)
    # sha256 of the pass (httpOnly cookie + localStorage). Good for one hero.
    token_hash = Column(String(64), nullable=False, unique=True)
    # sha256 of the browser marker that joined, to spot a second student on
    # the same browser (who then waits for the teacher). Not a fingerprint: a
    # random value we issued, sent only to /api/class.
    device_hash = Column(String(64), nullable=True, index=True)
    shared_device = Column(Boolean, nullable=False, default=False)
    status = Column(String(16), nullable=False, default="approved")  # approved | waiting | blocked
    # Set by the atomic one-hero guard, before the creation exists.
    hero_started_at = Column(DateTime, nullable=True)
    creation_id = Column(String, ForeignKey("creations.id"), nullable=True, index=True)
    # sha256 of the parent link's token (derived: classes.claim_token).
    claim_hash = Column(String(64), nullable=True, unique=True)
    claimed_by = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    claimed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    session = relationship("ClassSession")
    classroom = relationship("ClassRoom")
