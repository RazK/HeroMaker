---
id: E-007
title: "Best value badge on the $15 pack vs the $40 pack"
status: draft
lever: "AOV (average first order)"
hypotheses: [H-042, H-012]
flag_key: best-value-badge
variants: [maker, studio]
audience: "signed-in accounts that open the Buy credits sheet; not class seats, not robots, not admins"
share: "50/50, by a stable hash of the anonymous visitor id"
primary_metric: "mean purchase_done amount_cents (test: false) per first purchase, by arm"
guardrails: ["checkout_started / credits_shown", "purchase_done per credits_shown", "second purchase within 60 days"]
sample: "about 200 first purchases per arm (Studio's share from 10% to 20%)"
stop_date: "set when it starts: the sample, or 6 weeks; at campaign traffic the sample takes about 3 months, so do not start it before sales grow"
approved: ""
started: ""
closed: ""
result: ""
decision: ""
---

# E-007: "Best value" badge on the $15 pack vs the $40 pack

**Question.** Does moving the Best value badge from Maker ($15) to Studio
($40) raise what a first purchase is worth, without fewer people buying?

**Variants.**
- `maker`: today. The badge on Maker (`highlight: True` in
  `backend/app/config/packs.py`).
- `studio`: the same sheet, the badge on Studio.

**Audience and share.** Signed-in accounts that open Buy credits; 50/50 by a
hash of the visitor id; a parent keeps the arm they first saw. Class seats
are out of it.

**Metrics.**
- Primary: mean `purchase_done` amount_cents (test: false) per first
  purchase, by arm (H-042). Supported at 20% or more higher.
- Pack mix: `checkout_started` (pack) and `purchase_done` (pack) per arm
  (H-012 is read here too).
- Guardrails: `checkout_started` / `credits_shown` not more than 3 points
  lower in `studio`; purchases per sheet; second purchase within 60 days,
  read later.

**Sample and stop.** An average order is noisy; read as Studio's share of
first purchases, from an assumed 10% to 20% needs about 200 first purchases
per arm. At about 4 purchases a day during a campaign (2% of 200 visits) that
is about 100 days: **too slow, past the six-week rule**. Run it only when
first purchases reach about 10 a day. Until then, ask the five price
interviews of H-014 which pack they would pick and why.

**Needs before it runs.**
- First purchases at about 10 a day, or Raz choosing to run it longer.
- Raz's yes (it steers what a parent pays).
- The switch: which pack is highlighted, by arm, one line where
  `get_packs` is served, or in `BuyCredits.tsx`.
- The experiment plumbing (`README.md`).

**Result.** Not run.

**Decision.** None yet.
