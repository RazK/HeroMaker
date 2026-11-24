# Raz's rules — the running list

This is the one place we keep every rule Raz gives us, so he never has to say it
twice. **Read it. Follow it. When Raz gives a new rule, add it here in the same
turn.** If a rule here clashes with your own habit, his rule wins.

Each rule has the date it was set.

## How to report to Raz

- **Simplified Technical English (ASD-STE100). Short.** One idea per sentence.
  (2026-11-23)
- **English, not Hebrew.** (2026-11-23)
- **The one ask on top, on its own line.** Then a few lines at most. Never a
  flood. One or two asks at a time. (2026-11-23)
- **Two sentences that run over two lines → each sentence on its own line.**
  Never let one sentence break mid-line while another shares the space.
  (2026-11-23)
- **Show numbered pictures, not names.** Names mean nothing to him. When you
  offer choices, show numbered images. (2026-11-23)
- **Real screenshots of the real app only.** Never a diagram, mock-up or
  hand-built page passed off as a screenshot. (2026-11-23)
- **Give a demo video + a link to try, not a text summary.** (2026-11-23)
- **A "done / ready" claim comes WITH the thing — the video or screenshot of
  it live on staging, never text alone.** One line on what he is about to see,
  then show it. If it is finished, send the video. (2026-11-24, after a
  text-only status update.)
- **Demo video spec:** max 25–30 s; a full-screen caption slide, then ~5 s of
  real-speed screen recording per step; never sped up; no sign-in/setup
  clutter; watch it in full first. A **content** person cuts it, never a
  developer. (2026-11-23)

## How to work

- **Try the product yourself before you claim or show anything.** Walk the
  whole real flow as a user. You only understand a problem once you have felt
  it. (2026-11-23)
- **You (the PM / product agent) are the user's ambassador.** Understand the
  user by using the product, not by reading logs. (2026-11-23)
- **Product behaviour is yours. Design is Maya's.** Fonts, spacing, layout,
  line breaks, the wording and look of a screen — these are design. Maya owns
  them because she holds Raz's taste. Build the behaviour; hand the design to
  Maya. (2026-11-23)
- **Keep this file and follow it.** Don't make Raz repeat a rule. (2026-11-23)
- **One-day sprints.** Every morning a kickoff, every evening a review.
  (2026-11-23)
- **Protect the running sprint; do not interrupt the team mid-sprint.** When
  Raz brings a new thing, the PM triages it: what still fits THIS sprint, and
  what is **backlogged** for the next. Keep `docs/ops/BACKLOG.md`. Deliver the
  sprint; carry the rest forward so we progress sprint to sprint. (2026-11-23)
- **Liran owns staging releases.** He is the only one who merges to `main` /
  releases to staging, one PR at a time. Everyone else opens PRs; the PM sets
  the order; Liran merges. No parallel merges (they race the staging deploy).
  (2026-11-23)
- **Every merge is gated on a read-only review.** Before Liran merges a PR, a
  reviewer (Scout / the `code-review` skill) checks it **read-only**
  (Read, Grep, Glob — no writes). No review, no merge. Verification is a
  standing role, not optional. (2026-11-23)
- **The team (2026-11-23):** PM (orchestrator) with **Anat · Chief of Staff**
  (mechanical coordination), **Gidi · Payments** + books, **Maya · Design**,
  **Liran · Dev** + releases, **Tom · Content** + videos, **Noa · Growth**
  (acquisition, the KPI's funnel, pilots). **Nir · 3D is parked** until toy
  demand. Scout (review) and Compass (docs) are specialists. (2026-11-23)
- **Every agent shows their work in their own chat.** When a teammate makes a
  deliverable — a video, a design, a mockup, a demo — they **present it in their
  own session** (SendUserFile, or an artifact Raz can open), not only hand it to
  the PM. Raz can open any teammate's chat and see the work. No silent,
  text-only hand-offs. (2026-11-23)
- **Team sync, 3× per sprint** — at the morning **kickoff**, a **midday** sync,
  and the evening **review** (a 1-day sprint). At each, the PM: (1) broadcasts a
  SHORT shared-state delta to all five agents — the owners, decisions and holds
  that changed since the last sync (e.g. "Liran owns staging") — with a pointer
  to this file; (2) collects each agent's one-line status; (3) reconciles any
  drift (two agents on the same thing, a stale assumption, a stuck hand-off);
  (4) surfaces to Raz only what he must decide. Keeps everyone aligned without a
  flood. (2026-11-23)
- **A sync is a working review, not just a status check.** Time it to when
  there are deliverables. The PM gathers every teammate's work (each already
  shown in that teammate's own chat), runs a **cross-team review** — each
  relevant teammate gives input; since there is no live group room, the PM
  brokers the discussion (puts each deliverable in front of the right people,
  collects input, iterates) — synthesizes **one team decision**, and shows Raz
  the deliverables and the decision. (2026-11-23)
- **Run the sprint autonomously; meet Raz between sprints.** Do NOT bring Raz
  micro-decisions — that is the PM's job. Between sprints the PM shows the last
  sprint's **results** and gets Raz's **approval for the next**. Inside the
  sprint the PM collects deliverables, syncs, gives feedback, cross-reviews,
  **decides**, and drives to the business goal (paid heroes/week). Raz may drop
  in and steer a teammate; the PM still owns the management. **Every sprint ends
  with clear progress and clear deliverables — no exceptions.** (2026-11-23)
- **Never make Raz repeat a note.** A note given twice is a failure. Capture
  every input in this file the same turn and apply it from then on. (2026-11-23)

## Words

- **Don't say "paywall".** The user never sees a wall. It is the **"Bring it to
  life"** moment — pay to continue. (2026-11-23)
- **Payments must be visibly designed and shown, not just working under the
  hood.** The "pick a pack → pay → done" screens and the checkout are a
  first-class design, and Raz sees them on staging. (2026-11-23)

## Staging and production (see also the release flow in CLAUDE.md)

- **Staging-first, always.** feature branch → PR → CI green → you merge →
  `main` auto-deploys to staging → you robot-test staging → Raz reviews →
  Raz approves *Promote to production*. Nothing reaches production any other
  way. (2026-10-18)
- **Never ask for approval without a working staging link** he can click and
  use. (standing)
- **The two databases stay separate.** Copy creations between them only with
  Raz's permission, asked each time. (standing)

## Product

- **One KPI: paid heroes per week.** Money first. (standing)
- **The paywall is not a failure.** When a hero pauses because the user is out
  of credits, show the finished painting big and proud and **ask for credits to
  bring it to life** — never a red cross or the word "failed". (2026-11-23)
- **The "Bring it to life" moment is a clear pay pop-up, not a passive screen.**
  It must make a clear call to pay: a pop-up that explains the plans and sends
  to payment — **like Simply Piano or Kahoot**. Phone: a bottom sheet. Desktop:
  a ~480 px dialog. It opens by itself when the painting is ready and the
  account cannot pay. It shows the painting + "Bring <hero> to life", the
  benefits, the plan cards from `/api/v1/packs` (Family pre-selected, "Best
  value"), and **"Continue to payment"** → `/api/v1/checkout` → `checkout_url`;
  after paying the buyer returns to the hero being made. "One payment. No
  subscription." Design is Maya's; Raz approves before Liran builds.
  (2026-11-23, after Raz rejected three passive paywall options.)
- **No ugly browser scrollbar** on the right of the landing page. Hide it, or
  make it thin and soft. (2026-11-23, pending Maya)

## Look

- **Toy Box is the only look.** Tokens in `frontend/src/styles/toybox.css`.
  (standing)
- **Staging never looks like production** (its own icon, a STAGING tag).
  (standing)
- **No text for its own sake — only text that earns its place.** Never add a
  title, label or line to fill or balance a UI element and then backfill the
  words. If it says nothing the screen does not already show, cut it. ("Heroes
  kids made" stated the obvious; a filler benefit line adds nothing.) Nothing
  to say → no text. (2026-11-24)

## Demo delivery (every demo, and the overnight sprint) — 2026-11-23

- A sprint ends in a **demo video (or videos), not text.**
- **One video per flow.** Show **happy flows and not-so-happy flows.**
- **Flows follow the business-plan personas** (`docs/design/USER_STORIES.md`,
  `docs/product/MONEY_MOMENTS.md`): one journey per persona, each with its happy
  path and its not-happy path.
  - **Visitor** — a shared link → sees the magic → starts their own. Not-happy:
    a hero still being made.
  - **Parent (the buyer)** — makes a hero → the reveal (the painting) → pays to
    bring it to life → the 3D hero. Not-happy: out of credits → the "Bring it to
    life" screen (never a failure).
  - **Kid** — makes the hero move → plays a game → shows family (share).
    Not-happy: a calm error, "try again".
  - **Teacher** — runs a class with a code, kids make heroes with no account →
    pays for seats. Not-happy: not enough seats.
  - **Collector** — turns the hero into a printable toy (take-apart, print
    file): the keepsake.
- Real UI, **recorded on staging** — the real features, merged first.
- **Real speed. Never sped up.** He must follow every moment.
- To explain a step: a **full-screen text-only slide** — enough time to read,
  not more (he has no patience) — then the clip of that step.
- **Review it many times** with all the context Raz gave; **the team reviews it
  too**; iterate until you believe he is satisfied. Never show half-baked work.
- **The delivery message, this exact shape:**
  1. "Good morning, Raz." (or the fitting greeting).
  2. A short **numbered list** of the features shipped. No bragging. Short.
  3. **One line per team member:** what they contributed.
  4. **The videos**, one per flow (happy and not-happy).
  5. **One link** to the live staging the videos were recorded on.
- All ready features **merge to staging first**, robot green, before the video.
- **Film/video app screens are real staging recordings only — never hand-made
  cards.** And every **film** cut goes to Maya for a **frame-by-frame** design
  gate BEFORE the PM sees it; a PM montage glance is not a substitute.
  (2026-11-23, after the family-film cut 1 slipped through with hand-made cards
  and ghost frames.)

## Film & brand — 2026-11-24 (Raz's notes on family-film cut 4)

- **A film always has sound.** Music that builds, the real moment (a laugh, a
  gasp), and the promise if we voice it. A silent video is a draft, not a film.
- **Say the value prop, clearly.** Every film states what HeroMaker is and why —
  one promise, shown on the end card (and said aloud where we voice it). If a
  stranger cannot tell what it is for, it fails.
- **Celebrate the "comes to life" moment — make it feel magical.** The drawing →
  hero reveal is the heart of the product (money moment #1). It is the emotional
  peak: the magic of the transition and the child's joy must land. Never a quiet
  cut past it.
- **"The whole family" means the whole family — grandma included.** The share /
  family beat shows more than mom.
- **Maya's gate catches layout and dead space too, not only frames.** A split,
  or any frame, must FILL the 9:16 frame, balanced — no empty dead space.
- **Ship a film only when it feels like a film, not a draft.** (Restates the
  demo-delivery rule, for film specifically.)
