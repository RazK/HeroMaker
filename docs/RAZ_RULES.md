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
