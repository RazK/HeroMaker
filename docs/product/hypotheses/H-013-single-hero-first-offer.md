---
id: H-013
title: "A one-hero offer converts first-timers"
status: untested
area: payment
segment:
  drawer: "any"
  payer: "parent"
  door: "ad"
statement: "We believe signed-in parents with no purchase yet will start checkout at least 1.5 times as often when a single hero for $2 is offered beside the packs, because the first payment is the hardest."
metric: "`checkout_started` / `credits_shown`, by variant; guardrail revenue per `credits_shown` from `purchase_done` amount_cents"
threshold:
  supported: "1.5x or more, and revenue per sheet not lower"
  rejected: "under 1.1x, or revenue per sheet lower"
test: "A/B experiment (price test)"
sample: "about 300 `credits_shown` per arm"
duration: "about 3.5 weeks at campaign traffic; not feasible without one"
impact: 4
uncertainty: 4
priority: 16
experiments: [E-003]
---

# H-013: A one-hero offer converts first-timers

We believe signed-in parents with no purchase yet will start checkout at least 1.5 times as often when a single hero for $2 is offered beside the packs, because the first payment is the hardest.

**Why we think so.** Starter asks for $5 before the parent has seen a single hero of their own.

**How we'll know.** A/B experiment (price test). Supported: 1.5x or more, and revenue per sheet not lower. Rejected: under 1.1x, or revenue per sheet lower. Anything between is inconclusive. The thresholds are targets we chose, not measurements.

**Notes.** Needs Raz: a new price and a new Lemon Squeezy variant. At today's costs a $2 hero keeps about $0.53, under the 50% margin floor (READINESS item 7).

**Result.** Not tested yet.
