---
id: E-006
title: "Pay before the painting vs see your painting free, pay for the 3D hero"
status: draft
lever: "conversion (first purchase) and revenue per visitor, and through them CAC"
hypotheses: [H-041]
flag_key: free-painting
variants: [pay-first, painting-free]
audience: "accounts with no purchase yet and not enough credits for a hero, from their first make_started; not class seats, not robots, not admins"
share: "50/50, by a stable hash of the anonymous visitor id"
primary_metric: "browsers with purchase_done (test: false) / browsers with make_started, by arm, within 7 days"
guardrails: ["provider cost of free paintings never followed by a purchase, per purchase (our own table: openai_render done, no meshy_3d)", "revenue per first visit (purchase_done amount_cents)", "free paintings per account (must be 1)", "hero_failed per hero started"]
sample: "about 450 make_started per arm (13% to 20% buy)"
stop_date: "set when it starts: the sample plus 7 days, or 6 weeks"
approved: ""
started: ""
closed: ""
result: ""
decision: ""
---

# E-006: Pay before the painting vs see your painting free, pay for the 3D hero

**Question.** If a parent sees their child's painting before paying anything,
do more of them pay for the 3D hero, and do we earn more per visitor once the
free paintings are paid for?

**Variants.**
- `pay-first`: today. Make a hero → sign in → Buy credits if short → photo →
  the whole hero is made, each step charged as it runs.
- `painting-free`: Make a hero → sign in → photo → the painting
  (`openai_render`) is made free, once per account → "Bring it to life" opens
  Buy credits → the 3D steps (`meshy_3d`, `meshy_rig`, `convert_vrm`) run on
  credits as today.

**Audience and share.** Accounts with no purchase yet and fewer credits than a
hero costs, from their first `make_started`; 50/50 by a hash of the visitor
id. A parent keeps the arm they first saw. Left out: class seats (already
paid by the teacher), robots, admins, accounts that already have credits.

**Metrics.**
- Primary: of browsers with `make_started`, the share with `purchase_done`
  (test: false) within 7 days, by arm (H-041). Supported at 1.5x or more.
- Why not `photo_taken` → `purchase_done`, as first asked: in `pay-first` the
  purchase comes **before** the photo, so that rate is near 100% there by
  construction. It is read inside `painting-free` only (`photo_taken` or
  `photo_chosen`, then `purchase_done`), as the painting's own conversion.
- Revenue per first `visit`: `purchase_done` amount_cents over first visits,
  by arm. It must be higher in `painting-free` **after** subtracting the
  guardrail below, or the arm loses even if more people buy.
- Guardrail, the cost: free paintings never followed by a purchase, at about
  $0.17 each (`docs/business/PLAN.md`), per purchase in the arm. Read from our
  own table (a creation with `openai_render` done and no `meshy_3d` started).
  To see it in PostHog too: needs: `painting_ready` (server, like
  `hero_ready`). Stop early if it passes $2 per extra purchase: a Starter
  keeps about $4.25 before hero costs.
- Guardrails: free paintings per account (must be 1: the cap holds);
  `hero_failed` per hero started.

**Sample and stop.** From an assumed 13% (2% of visits buy, 15% start) to 20%
needs about 450 `make_started` per arm. At 200 visits a day and 15% starting,
30 a day: about 30 days, then 7 days for late purchases, about 5 weeks. It
sees a 1.5x lift, not a 1.2x one. Without a campaign it would take months: do
not run it then. Stop early only on the cost guardrail.

**Needs before it runs.**
- **Raz's yes on giving the painting away.** It changes what we charge and
  when, and costs real money per visitor who stops there.
- E-002 read first, so `pay-first` has a real baseline (H-002).
- Built behind the flag: the painting step free once per account, the
  pipeline stopping after it until credits are there, the "Bring it to life"
  screen (a design Raz approves, phone and desktop), and the cap enforced
  server side.
- The experiment plumbing (`README.md`); production analytics on (G-1).

**Result.** Not run.

**Decision.** None yet.
