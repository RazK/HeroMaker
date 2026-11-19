---
id: H-009
title: "Parents finish signing in"
status: untested
area: activation
segment:
  drawer: "any"
  payer: "parent"
  door: "any"
statement: "We believe at least 65% of parents shown the sign-in sheet will finish it, most of them with Google, because it asks for one tap and nothing else."
metric: "`signin_done` / `signin_shown`, and `signin_done` (method)"
threshold:
  supported: "65% or more complete"
  rejected: "under 45%"
test: "funnel observation"
sample: "100 `signin_shown`"
duration: "1 week of campaign"
impact: 4
uncertainty: 3
priority: 12
experiments: []
---

# H-009: Parents finish signing in

We believe at least 65% of parents shown the sign-in sheet will finish it, most of them with Google, because it asks for one tap and nothing else.

**Why we think so.** Every paid hero passes through it. Password reset is off (READINESS item 8), which may scare password users.

**How we'll know.** Funnel observation. Supported: 65% or more complete. Rejected: under 45%. Anything between is inconclusive. The thresholds are targets we chose, not measurements.

**Result.** Not tested yet.
