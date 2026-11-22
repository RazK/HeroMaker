---
id: H-012
title: "First-time buyers pick the smallest pack"
status: untested
area: payment
segment:
  drawer: "any"
  payer: "parent"
  door: "family"
statement: "We believe at least 60% of first purchases will be Starter ($5, 3 heroes) because a first purchase is a try."
metric: "`purchase_done` (pack), first purchase per account"
threshold:
  supported: "Starter is 60% or more of first purchases"
  rejected: "under 40% (then lead with Maker)"
test: "funnel observation"
sample: "30 first purchases"
duration: "1 to 2 weeks of campaign"
impact: 3
uncertainty: 3
priority: 9
experiments: [E-003, E-007]
---

# H-012: First-time buyers pick the smallest pack

We believe at least 60% of first purchases will be Starter ($5, 3 heroes) because a first purchase is a try.

**Why we think so.** Decides which pack the sheet puts first.

**How we'll know.** Funnel observation. Supported: Starter is 60% or more of first purchases. Rejected: under 40% (then lead with Maker). Anything between is inconclusive. The thresholds are targets we chose, not measurements.

**Result.** Not tested yet.
