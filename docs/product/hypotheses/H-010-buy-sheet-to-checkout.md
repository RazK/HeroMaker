---
id: H-010
title: "The Buy sheet sends parents to checkout"
status: untested
area: payment
segment:
  drawer: "any"
  payer: "parent"
  door: "any"
statement: "We believe at least 30% of signed-in parents who see the Buy credits sheet will start checkout because they already chose to make a hero and the price is small."
metric: "`checkout_started` / `credits_shown`"
threshold:
  supported: "30% or more"
  rejected: "under 15%"
test: "funnel observation; interview 5 parents who stopped here"
sample: "100 `credits_shown`"
duration: "1 week of campaign"
impact: 5
uncertainty: 4
priority: 20
experiments: []
---

# H-010: The Buy sheet sends parents to checkout

We believe at least 30% of signed-in parents who see the Buy credits sheet will start checkout because they already chose to make a hero and the price is small.

**Why we think so.** This is where the money is decided. Everything before it is curiosity.

**How we'll know.** Funnel observation; interview 5 parents who stopped here. Supported: 30% or more. Rejected: under 15%. Anything between is inconclusive. The thresholds are targets we chose, not measurements.

**Notes.** If it fails, E-003 (the first-pack offer) is the next test.

**Result.** Not tested yet.
