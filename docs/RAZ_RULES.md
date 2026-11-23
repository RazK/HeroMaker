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
- **No ugly browser scrollbar** on the right of the landing page. Hide it, or
  make it thin and soft. (2026-11-23, pending Maya)

## Look

- **Toy Box is the only look.** Tokens in `frontend/src/styles/toybox.css`.
  (standing)
- **Staging never looks like production** (its own icon, a STAGING tag).
  (standing)

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
