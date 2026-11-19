---
id: H-015
title: "People who leave the wait come back for their hero"
status: untested
area: activation
segment:
  drawer: "any"
  payer: "parent"
  door: "any"
statement: "We believe at least 70% of browsers that leave while a hero is being made will open it within 24 hours because they paid for it and want to see it."
metric: "`wait_left`, then `hero_opened` (from: mine) or `screen_viewed` (screen: hero) for the same browser"
threshold:
  supported: "70% or more within 24 h"
  rejected: "under 40%"
test: "funnel observation"
sample: "60 `wait_left`"
duration: "1 week of campaign"
impact: 5
uncertainty: 4
priority: 20
experiments: []
---

# H-015: People who leave the wait come back for their hero

We believe at least 70% of browsers that leave while a hero is being made will open it within 24 hours because they paid for it and want to see it.

**Why we think so.** A hero takes about 8 minutes. A paid hero nobody comes back to is a refund request waiting to happen.

**How we'll know.** Funnel observation. Supported: 70% or more within 24 h. Rejected: under 40%. Anything between is inconclusive. The thresholds are targets we chose, not measurements.

**Notes.** Nobody is told when the hero is ready (no email, no push: out of scope). If this fails, that is the first thing to design.

**Result.** Not tested yet.
