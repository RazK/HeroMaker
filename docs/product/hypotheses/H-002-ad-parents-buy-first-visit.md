---
id: H-002
title: "Ad parents buy a first pack"
status: untested
area: payment
segment:
  drawer: "kid 4-9"
  payer: "parent"
  door: "ad"
statement: "We believe parents of kids 4-9 arriving from a paid ad will buy a pack in at least 2% of first visits because seeing their own child's drawing alive is worth $5 to them."
metric: "`purchase_done` (test: false) per first `visit`, cut by door"
threshold:
  supported: "2% or more of first ad visits buy within 7 days"
  rejected: "under 0.5%"
test: "funnel observation by door"
sample: "1,000 first visits from the ad door (20 purchases at the target)"
duration: "5 days at campaign traffic; over a month without one"
impact: 5
uncertainty: 5
priority: 25
experiments: [E-002]
---

# H-002: Ad parents buy a first pack

We believe parents of kids 4-9 arriving from a paid ad will buy a pack in at least 2% of first visits because seeing their own child's drawing alive is worth $5 to them.

**Why we think so.** Nothing yet says a stranger pays. The campaign is the first time anyone who does not know Raz meets a price.

**How we'll know.** Funnel observation by door. Supported: 2% or more of first ad visits buy within 7 days. Rejected: under 0.5%. Anything between is inconclusive. The thresholds are targets we chose, not measurements.

**Notes.** The drawer's age is unknown before payment (see the gaps in HYPOTHESES.md); the segment is checked afterwards from `survey_answered`. Needs production analytics on and a live store (READINESS list 3).

**Result.** Not tested yet.
