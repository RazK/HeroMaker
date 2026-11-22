---
id: H-041
title: "A free painting sells the 3D hero"
status: untested
area: payment
segment:
  drawer: "any"
  payer: "parent"
  door: "ad"
statement: "We believe first-time parents will buy at least 1.5 times as often per hero started when they see their child's painting free and pay for the 3D hero, than when they pay before the painting, because the painting proves it is their child's drawing before any money is asked."
metric: "`purchase_done` (test: false) per browser with `make_started`, by arm; revenue per first `visit` (`purchase_done` amount_cents); guardrail provider cost of paintings never followed by a purchase"
threshold:
  supported: "1.5x or more purchases per hero started, and revenue per visitor higher after the cost of free paintings"
  rejected: "under 1.1x, or revenue per visitor lower after the cost of free paintings"
test: "A/B experiment"
sample: "about 450 `make_started` per arm"
duration: "about 5 weeks at campaign traffic; not feasible without one"
impact: 5
uncertainty: 4
priority: 20
experiments: [E-006]
---

# H-041: A free painting sells the 3D hero

We believe first-time parents will buy at least 1.5 times as often per hero started when they see their child's painting free and pay for the 3D hero, than when they pay before the painting, because the painting proves it is their child's drawing before any money is asked.

**Why we think so.** Today a parent pays $5 before seeing anything of their own (H-002). A free preview before payment is a common pattern elsewhere, which is why uncertainty is 4, not 5; we have no evidence of our own.

**How we'll know.** A/B experiment. Supported: 1.5x or more purchases per hero started, and revenue per visitor higher once the free paintings are paid for. Rejected: under 1.1x, or revenue per visitor lower. Anything between is inconclusive. The thresholds are targets we chose, not measurements.

**Notes.** A painting costs us about $0.17 (`docs/business/PLAN.md`). Free, it is a cost on every visitor who stops there, and an invitation to abuse: one free painting per account.

**Result.** Not tested yet.
