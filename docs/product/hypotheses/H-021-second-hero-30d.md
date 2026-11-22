---
id: H-021
title: "Buyers make a second hero and buy again"
status: untested
area: retention
segment:
  drawer: "any"
  payer: "parent"
  door: "family"
statement: "We believe at least 20% of first-time buyers will make a second hero within 30 days, and at least 10% will buy a second pack within 60 days, because kids draw again."
metric: "`make_started` / `hero_ready` per account after the first; second `purchase_done` per account (our own table, which has the account)"
threshold:
  supported: "20% second hero and 10% second purchase"
  rejected: "under 10% second hero"
test: "funnel observation (cohort)"
sample: "50 first-time buyers"
duration: "30 to 60 days after the first 50 purchases"
impact: 5
uncertainty: 4
priority: 20
experiments: [E-009]
---

# H-021: Buyers make a second hero and buy again

We believe at least 20% of first-time buyers will make a second hero within 30 days, and at least 10% will buy a second pack within 60 days, because kids draw again.

**Why we think so.** A hero keeps about $0.38 to $0.55 (READINESS section 4). A paid ad pays back only if a family buys more than once.

**How we'll know.** Funnel observation (cohort). Supported: 20% second hero and 10% second purchase. Rejected: under 10% second hero. Anything between is inconclusive. The thresholds are targets we chose, not measurements.

**Notes.** Slow by nature: start the clock with the first campaign.

**Result.** Not tested yet.
