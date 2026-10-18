# Classes: a teacher pays, every child makes one hero, parents keep them

**Summary.** HeroMaker has three kinds of buyers but needs only two products.

- **Individuals and families** are the same product: a parent buys credits and
  the household makes heroes. A family simply buys a bigger pack.
- **A class is different.** One adult pays for a group of children who have no
  accounts.

A **teacher** is a kind of user with their own home: a list of **classes**. The
teacher creates a class in advance and **pays for its seats up front**, one
hero per seat, from their credits. In the lesson they tap **Start class**,
confirm how long it runs, and project a 6-digit PIN and a QR code.

Each child scans or types the PIN, enters a **first name and age**, and gets a
**one-hero pass** held by their browser. They then make **exactly one hero**,
paid from the class's seats, with no sign-up. Afterwards the class page is the
class's gallery, where all the heroes are kept.

Each child's hero has **Show your parents**. A parent who signs up through it
**keeps the hero**, with the child's name and age, in their own account. That is
how a class turns into paying households and more teachers.

What bounds the cost is a **server-side seat counter**, not device tricks. The
pass makes "one hero per child" the easy path, and the projected roster catches
the rest.

Status: built on `claude/class-sessions` (backend, frontend, tests) and
demonstrated on video. Not deployed.

---

## 0. What we found in the repository's history

The founder recalled an earlier teacher concept. Everything in git history (all
100 branches) and in the PR titles and bodies (105 PRs) was searched for
*teacher / classroom / kindergarten / school / class / גננת / כיתה*.
**There is no earlier teacher design: no screen, no flow, no data model.**
What exists:

- `f118274` *Price the credit packs*: the Studio pack, "Thirty heroes. For a
  classroom or a party." (`backend/app/config/packs.py`). **We build on it**:
  it becomes the teacher's Class 30 pack (section 5).
- `2743531` *Five landing-page concepts*: all five concepts listed "For
  classrooms and big families" in pricing. `0e33337` then deleted that line as
  "a promise nobody made": the product could not serve a class. This feature is
  the thing that makes that line true.
- `5f7e4f3` / `e269c6a` *event photos* (`marketing/photos/CONTACT-SHEET.md`):
  - Hanukkah 2025 at Schneider Children's Hospital: kids drawing at tables, then
    playing on a big screen.
  - An evening event: a wall of drawings with the gallery **projected above
    it**.

  These are the real-world precedent for the projected live roster and the
  class gallery. **We build on that** for the session screen.

## 1. Who is involved

| Persona | Context | Wants | Must never |
|---|---|---|---|
| **Teacher** (kindergarten, grades 1–4, after-school art) | Plans at home on a phone or laptop; runs the lesson from a laptop on a projector; 20–35 kids, 45 minutes | Set up the class the night before, start it with one tap, see every child's progress, a known cost paid once | Type 30 emails, chase passwords, pay twice, lose the heroes after class |
| **Student**, 5–10 years old | A class tablet (often shared) or a parent's phone | Draw, snap, see *their* hero come alive | Give an email, a password, a surname or a face photo |
| **Parent at home** | Opens a link the child brings home (QR, WhatsApp) | See the hero, keep it, maybe make more | Discover their child's data was shared without asking |
| **School / committee** | Sometimes the payer | One payment, a privacy answer | Sign a district DPA for a pilot |

## 2. How someone becomes a teacher

- **At sign-up**, with an "I'm a teacher" switch on the sign-up sheet.
- **Later**, from the account sheet: "Teacher home" on or off. Anyone can
  switch; there is nothing to verify, because a teacher pays like everyone else
  (no free class, section 5).
- **Creating a class** also turns it on.

With it on, the home screen is **My classes** instead of the gallery. The
gallery stays one tap away. The account, credits and Buy credits are the same as
everyone else's.

## 3. User stories

- As a teacher, I create **Grade 2B** with 28 seats the night before and pay 280
  credits once. I see the class on my home screen with "28 seats".
- As a teacher, I open the class during the lesson and tap **Start class**. I
  pick 45 minutes in the confirm dialog and get a PIN, a QR code and a live
  roster to project.
- As a student, I scan the QR code or type the PIN, type my first name and age,
  photograph my drawing, pick a style, and watch my hero being made. I don't
  sign up.
- As a student who already made a hero, I'm told kindly "You already made your
  hero!" and shown it again.
- As a teacher, after class (or next month) I open the class and see all its
  heroes, with names and ages. That is the class gallery, and it feeds the class
  stage.
- As a teacher, I start the class again next week for the two kids who were
  away. Their unused seats are still there.
- As a parent, I open my child's link, see "Maya, 7", and tap **Keep Maya's
  hero**. After a free sign-up, the hero is in My heroes with her name and age.
  I can buy credits to make more at home.

## 4. Flows

### Teacher, in advance (parent voice: this is money)
1. Home (**My classes**). Each class card shows its name, "12 of 28 heroes", up
   to five finished heroes on their plates, and a **Live** badge while a session
   runs. The bar holds **New class**, the one grape action.
2. **New class** sheet. It asks for the class name and the number of students
   (a − 28 + stepper). The primary button carries a trail: "Pay 280 credits". If
   the balance is short, the sheet says "You need 280 credits. You have 100." and
   offers **Buy credits**.
3. **Spending money confirms first** (brand book): a dialog asks "Pay 280 credits
   for 28 heroes?" with **Pay** and **Not now**. The credits leave the teacher's
   balance now.

### Teacher, in the lesson
4. **Class screen**: header, then the class gallery (empty at first), then a bar
   with "28 seats left" and **Start class**.
5. **Start class** opens a confirm dialog: "Start now?" with 30 / 45 / 60 minute
   chips (45 by default), an optional "Approve each student" switch, then
   **Start** and **Not now**.
6. **Live session**, made to be projected. It shows the big PIN, a QR code, the
   `…/join` address, the time left, and heroes made out of seats. Below that is
   the roster grid: tiles appear as children join and fill with their hero as it
   finishes. Children waiting for approval get **Approve** and **Block** on their
   tile. The bar holds **+15 min** and **End class**. Tapping a child's hero
   (here or in the class gallery) opens the gallery's hero page, read-only: its
   steps while it is made, then the hero live with its moves, **Share** and
   **Play**. Back returns to the class where it was left.
7. When time is up, or the teacher taps **End class**, no new heroes start.
   Heroes already being made finish. The class screen goes back to the class
   gallery.

### Student (kid voice)
1. QR code → `/join/123456`, or `/join` → 6 big digits on a numeric keypad.
2. "Who are you?": first name, then age (big 4–12 chips). **Let's go!**
3. **Take a photo** / **Choose a photo**, then the style picker, then **Make my
   hero**. This is the app's own create step, with the class paying.
4. **Making**: the drawing under the five-step stepper, "Painting it…".
5. **Done**: the hero, live, and "Maya's hero is ready!" The bar holds **Next
   student** (secondary, for a shared tablet) and **Show your parents** (grape,
   last).
6. **Show your parents**: a QR code a parent scans from the screen, and
   **Send the link** (the share sheet).
7. A second attempt: "You already made your hero!" and **See my hero**.

### Parent (parent voice)
1. `/claim/<token>` shows the painting, "Maya, 7 · Grade 2B", and **Keep Maya's
   hero**.
2. Signed out, that opens the existing sign-up sheet; afterwards the claim runs.
3. The hero moves into **My heroes**, name and age included. "It's yours." The
   bar holds **Make another** (Buy credits) and **See my heroes**.

## 5. Money

**One hero = 10 credits.** Our measured provider cost is **$0.567 per hero**
(`packs.creation_cost_usd_micros`: one OpenAI render plus Meshy 3D and rig), so
the research's $0.30–1 range holds.

**Paid up front, through the ledger.** Creating a class moves `seats × 10`
credits from the teacher to the **class's own wallet**. That is an internal
account of kind `class_wallet`: it has no email and no password, can never sign
in, and is hidden from the admin user list. The move is recorded as two
`class_seats` ledger rows, one on each side. A student's hero is an ordinary
`Creation` owned by that wallet, so the **existing pipeline charges it step by
step and `refund_last_step_charge` refunds it on any failure or timeout**. A
failed hero puts its credits back on the class, and the child taps **Try again**
without taking a second seat. Nothing is re-implemented, and the ledger
invariant `sum(delta) == balance` holds for teacher and wallet alike (tested).

**Unused seats stay on the class.** A class is what the teacher bought: 28
seats for Grade 2B. A child who was away makes their hero at the next session,
with the same pass if they joined, or as a new student. Returning credits
mid-year would turn seats into a general balance and make "what did this class
cost" unanswerable. **Add seats** covers a new child. When a teacher deletes
their account, the unused seats are forfeited like any balance, as the delete
dialog already says.

**No free class, ever.** A teacher discount instead:

| Pack | Credits | Price | Per hero | Our cost | Net after Lemon Squeezy (5% + $0.50) | Margin |
|---|---|---|---|---|---|---|
| Starter (individual) | 30 | $5 | $1.67 | $1.70 | $4.25 | 60% |
| Maker (family) | 100 | $15 | $1.50 | $5.67 | $13.75 | 59% |
| Studio, today | 300 | $40 | $1.33 | $17.01 | $37.50 | 55% |
| **Class 30, proposed** (Studio for teachers, 5% off) | 300 | **$38** | **$1.27** | $17.01 | $35.60 | **52%** |
| Class 30 at $36 (rejected) | 300 | $36 | $1.20 | $17.01 | $33.70 | 49.5%, under the 50% floor in `packs.py` |

**Proposal: $38 for 30 heroes.** That is 24% under 30 individual heroes ($50)
and 5% under Studio. It keeps a 52% margin, above the 50% floor. We need that
floor in a class, because a class's failed steps are refunded to the class while
the provider still billed us.

**Shipped as seats bought for one class (approved by Raz).** A teacher short of
credits sees **Pay $35.50 for 28 seats** on the New class and Add seats sheets.
The price is **$0.50 per order + $1.25 per seat**, so 30 seats cost $38.00 and
every size from 1 to 60 seats clears the 50% floor (the $0.50 is Lemon
Squeezy's fixed fee passed through; without it 1 to 6 seats fall to 20–49%).
The numbers and their proof live in `packs.py` (`check_class_seats`).

- The checkout uses `custom_price` on the class-seats variant
  (`LEMONSQUEEZY_VARIANT_CLASS_SEATS`; unset hides the option).
- The signed webhook re-prices the seats and grants them only if the order's
  pre-tax subtotal paid that much. They go **straight to the class wallet**,
  never to the teacher's balance, so a self-declared teacher gains nothing
  outside a live class session. One order grants once (`external_ref`).
- **A full refund takes back the seats no child has used yet**, with their
  credits, in one transaction. Seats already used stay used: those heroes are
  made and their provider cost is spent. A partial refund is logged for an
  admin, like a refunded pack.

## 6. One hero per student: the mechanism

| Layer | What it does | Defeated by | Why it is still right |
|---|---|---|---|
| **Paid seats** | `seats_used` moves only through one atomic `UPDATE … SET seats_used = seats_used + 1 WHERE seats_used < seats`. Tested with 10 threads racing for 3 seats. | Nothing. | **The money guarantee.** The worst case is the seats the teacher already paid for. |
| **Time window** | A hero can start only while a session of that class is open. The PIN is dead after it. | Nothing. | A leaked PIN expires with the lesson. |
| **One-hero pass** | Join gives the browser a random pass (an httpOnly cookie on `/api/class` and localStorage). We store only its SHA-256. One atomic `UPDATE … WHERE hero_started_at IS NULL` lets it start one hero. | Clearing site data or a private window, which looks like a new child. | No sign-up, no friction. Reloading, or coming back next week, finds *my* hero. |
| **Browser marker** | A second random httpOnly value marks the browser. The first child on it is approved at once. **Each further child on the same browser waits for the teacher's one-tap Approve** and is labelled "shared tablet" on the roster. | Clearing site data. | It handles a shared tablet with one tap per extra child, and a second attempt shows up on the projected roster. |
| **Live roster** | Every join and every hero is projected. **Approve / Block** per child. The "Approve each student" switch makes everyone wait (older kids, or a leaked PIN). | Nothing. | The teacher is in the room, and the roster is social proof. |
| **Throttles** | 8 wrong PINs per browser per 10 minutes, 120 per minute across browsers with no marker, and 60 joins per minute per session. | A determined bot. | They stop casual guessing without ever blocking a class. |
| **Fingerprinting / IP limits** | **Not used.** | | See below. |

**Why there is no fingerprinting and no IP limit.**

- **IP limits.** A classroom sits behind one school NAT address. An IP limit
  would block the third child of thirty, and "one hero per IP" means one per
  school.
- **Fingerprinting.** It reads canvas, fonts and hardware to track a device
  without asking. For children that is the profiling COPPA and GDPR-K forbid,
  and Israel's amendment 13 treats it as personal data. It also fails at the
  job: thirty identical school iPads look the same.

Our two random values identify only *a browser that joined this class*. They are
readable only under `/api/class`.

**The honest trade-off.** A child who clears site data can join again under a
name the whole class sees, if seats remain. The seats make that a cost the
teacher already paid. The roster makes it visible, and approve-first stops it.

**Brute-forcing the PIN** gets an intruder a seat at most, never data. A pass
sees only its own hero and the class name.

## 7. Kids' privacy (COPPA, GDPR-K, Israel's Privacy Protection Law)

- **Minimal data.** A first name (20 letters, letters only, any script), an
  optional age (3–14) and the drawing. No email, password, surname, face or
  location.
- **Consent.** The teacher or school acts for the parents in an educational
  activity. That is the school-authorisation exception under COPPA, and
  legitimate interest or a contract under GDPR. Nothing leaves the class until a
  **parent** claims a hero and becomes its account holder.
- **Who sees what.**
  - The teacher sees their class.
  - A child sees only their own hero.
  - A parent sees only the hero their link names.
  - Class heroes are in **no public list**: not Editors' choice, not "All
    heroes", not the teacher's "My heroes".
  - Hero pages and files are reachable only through unguessable links (UUIDs,
    and a 192-bit claim token).
- **Retention: nothing expires** (founder's decision). A class hero is kept like
  any hero. The normal deletion rules apply:
  - A teacher who deletes their account deletes their classes, the students'
    names and passes, and every **unclaimed** hero with its files.
  - A claimed hero belongs to the parent and is deleted with the parent's
    account or on request. Both cases are tested.
- No ads, tracking pixels or third-party scripts on `/join` or `/claim`.

## 8. Funnel metrics (structured `class_funnel` log lines)

`class_created` (seats, credits) → `session_started` → `student_joined` (shared
tablet, age given) → `hero_started` → `parent_link_opened` → `hero_claimed` →
the purchase (the payments log, joined on user) → `teacher_referral` (a teacher
sign-up from a parent's welcome screen; planned).

The ratios to watch:

| Ratio | What it tells us |
|---|---|
| joined ÷ seats | Class fit. |
| ready ÷ started | Reliability in front of 30 families. |
| **claims ÷ ready** | The funnel. |
| purchases ÷ claims | The business. |
| classes per teacher | Retention. |

## 9. Feeds the class stage

`GET /api/classes/{id}/stage` returns `[{name, age, heroName, vrmUrl,
renderUrl}]` for every finished hero. That is the manifest the class stage
(branch `claude/proto-hero-class`) reads, so a class's heroes dance together.
It is not duplicated here.

## 10. Open questions for Raz

1. **Class 30 at $38** (5% off Studio, 52% margin): yes? Shipped as a teacher
   discount code?
2. **Parent welcome offer** on claim: a discount on the first pack, a few
   credits, or nothing beyond keeping the hero?
3. **Shared tablets:** keep one Approve tap per extra child, or add a "this class
   shares tablets" switch that trusts the seats?
4. **Unclaimed heroes' files:** unguessable links today. Do they need to require
   the teacher's or the child's pass (stricter, more work)?
5. **Teacher deletes a class** (not their account): allow it, with unclaimed
   heroes deleted and unused seats returned as credits?
