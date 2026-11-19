---
id: H-008
title: "The grown-up check does not lose the kid"
status: untested
area: activation
segment:
  drawer: "kid 7-12 alone"
  payer: "parent"
  door: "any"
statement: "We believe at least 70% of 'Is a grown-up with you?' answers will be Yes, and at least half of the 'Not yet' browsers will come back and sign in within 24 hours, because kids hand the phone over."
metric: "`adult_confirmed` (answer), then `signin_shown` / `signin_done` for the same browser"
threshold:
  supported: "Yes 70% or more, and half of Not yet return within 24 h"
  rejected: "Yes under 50%, or under a quarter of Not yet return"
test: "funnel observation"
sample: "100 `adult_confirmed` answers"
duration: "1 week of campaign"
impact: 4
uncertainty: 4
priority: 16
experiments: []
---

# H-008: The grown-up check does not lose the kid

We believe at least 70% of 'Is a grown-up with you?' answers will be Yes, and at least half of the 'Not yet' browsers will come back and sign in within 24 hours, because kids hand the phone over.

**Why we think so.** The check is a deliberate wall in front of payment. The question is how much it costs.

**How we'll know.** Funnel observation. Supported: Yes 70% or more, and half of Not yet return within 24 h. Rejected: Yes under 50%, or under a quarter of Not yet return. Anything between is inconclusive. The thresholds are targets we chose, not measurements.

**Notes.** A low Yes rate is not a reason to remove it (children's privacy); it is a reason to design the hand-over.

**Result.** Not tested yet.
