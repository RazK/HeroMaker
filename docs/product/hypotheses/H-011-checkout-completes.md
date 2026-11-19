---
id: H-011
title: "Checkout completes"
status: untested
area: payment
segment:
  drawer: "any"
  payer: "parent"
  door: "any"
statement: "We believe at least 60% of started checkouts will end in a purchase because Lemon Squeezy's page is a familiar card form."
metric: "`purchase_done` / `checkout_started`"
threshold:
  supported: "60% or more"
  rejected: "under 40%"
test: "funnel observation"
sample: "50 `checkout_started`"
duration: "1 to 2 weeks of campaign"
impact: 4
uncertainty: 3
priority: 12
experiments: []
---

# H-011: Checkout completes

We believe at least 60% of started checkouts will end in a purchase because Lemon Squeezy's page is a familiar card form.

**Why we think so.** A drop here is trust or friction on a page we do not control.

**How we'll know.** Funnel observation. Supported: 60% or more. Rejected: under 40%. Anything between is inconclusive. The thresholds are targets we chose, not measurements.

**Result.** Not tested yet.
