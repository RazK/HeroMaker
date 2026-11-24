# WhatsApp / Telegram bot — a second interface (requirements)

**Status:** requirements gathering (product-led). Not in a sprint yet.
**Owner:** PM (product). Design: Maya (+ Dana). Build: a pod, formed when this
moves to build (Raz's call, 2026-11-24).
**From:** Raz, 2026-11-24. **Money-check:** *yes, later* — see below.

A chat interface where a parent talks to HeroMaker on their phone, sends their
child's drawing, and gets back the painting, the 3D hero and the video — most of
what the website does. For the Schneider pilot (10 Dec) and like occasions,
where parents live in WhatsApp, not a browser.

## Money-check (run 2026-11-24)

- **Money moment:** the reveal, delivered where the parent already is; and the
  **home-from-class → home-buy bridge** (Noa's first paid funnel).
- **How soon:** *not before Schneider as a product.* WhatsApp needs Meta
  business verification (weeks). Telegram has no such gate.
- **Number it moves:** painting-seen → purchase for pilot families; reach for
  parents who will not open a browser.
- **Smallest version:** a thin **Telegram** bot on the **existing** API —
  photo in → pipeline → painting back → the existing pay link. No new backend.
- **Cost:** Telegram prototype ~a few days, no provider fee. WhatsApp adds a
  Business API provider (Twilio / 360dialog), a verified number and fees. Plus
  Maya's design time and the PM's.
- **Verdict:** **Later / smaller.** Real and on-KPI, but not this sprint.
  Gather requirements and design now (cheap); build Telegram first; WhatsApp
  once the flow is proven and the Business API is set up. **Revisit trigger:**
  after requirements + Maya's design are approved by Raz.

## Hard constraints (do not design around these — design *to* them)

1. **Same API endpoints as the website.** The bot is a new *client*, not a new
   backend. It calls the same upload / pipeline / status / packs / checkout /
   receipts endpoints. No pipeline logic is re-implemented in the bot (this is
   the `demo_purchase.py` trap — a second code path that can drift from the
   real one). See CLAUDE.md → Payments.
2. **Payments stay webhook-only.** The bot sends the parent to the existing
   `checkout_url`; credits are granted **only** by the signed Lemon Squeezy /
   Grow webhook. The bot must never tell the backend a payment happened.
3. **Privacy.** A child's drawing, name or face must not sit in chat logs or
   bot storage beyond what the pipeline already needs. Follow the pilot rule
   (no child PII). Decide retention before build.
4. **One identity, two front doors.** A parent who starts on WhatsApp and
   later opens the website should be the same account with the same heroes.
   How we link a phone number to an account is an open question (below).

## Open questions (requirements to settle with the team)

- **Auth:** how does a chat user become an account? Phone number as identity?
  A magic link? Anonymous start, then link on pay (ties to the backlog item
  "low-friction / anonymous start")?
- **Progress:** the pipeline takes minutes. Push updates as they happen, or on
  a "where is it?" message? What does "making your hero…" look like in chat?
- **Delivery:** the 3D hero and the video — as a video file, a link to the web
  studio, or both? What renders inline in WhatsApp vs needs a link?
- **The pay moment in chat:** how does "Bring it to life" read as a WhatsApp
  message + button? (Maya — ties to the pay-pop-up redesign.)
- **Class flow:** a teacher's class code over chat — does a parent join a class
  from WhatsApp, or only make a single hero?
- **Scope of v1:** which website actions the bot must have, and which it links
  out to the web for.
- **Telegram vs WhatsApp first:** confirm Telegram as the prototype channel;
  confirm the WhatsApp Business API provider and who owns that account.

## Plan

1. **Requirements** (this doc) → review with the team.
2. **Design** the chat flow with Maya (+ Dana): the message script, the pay
   moment, progress, delivery — phone-first, on-brand. Raz approves at the gate.
3. **Form the pod** when it moves to build (lead + designer + dev).
4. **Build the Telegram prototype** on the existing endpoints; test with a real
   drawing end to end (the robot rule: drive the real code path).
5. **WhatsApp** once the flow is proven and the Business API is set up.

## Links

- `docs/product/MONEY_MOMENTS.md`, `docs/product/OPERATING.md`
- `docs/ops/BACKLOG.md` (this initiative is listed there)
- Pilot: `docs/product/pilots/` (Schneider, 10 Dec)
