---
id: H-034
title: "Parents add the printable toy"
status: untested
area: toy
segment:
  drawer: "any"
  payer: "parent"
  door: "family"
statement: "We believe at least 20% of parents making a hero will choose the toy too (moving hero + toy) when it is offered for 5 more credits, because a hero you can hold outlasts a screen."
metric: "`make_choice` (choice: both or toy) / `make_choice`"
threshold:
  supported: "20% or more"
  rejected: "under 5%"
test: "funnel observation once on sale; before that a fake door"
sample: "100 `make_choice`"
duration: "2 weeks of campaign once the toy is on sale"
impact: 4
uncertainty: 5
priority: 20
experiments: []
---

# H-034: Parents add the printable toy

We believe at least 20% of parents making a hero will choose the toy too (moving hero + toy) when it is offered for 5 more credits, because a hero you can hold outlasts a screen.

**Why we think so.** The toy is the second product and half of the pitch. It is not on sale today (`ACTION_FIGURE_FOR_SALE` off, production has no Hi3D keys), so `make_choice` only ever says moving.

**How we'll know.** Funnel observation once on sale; before that a fake door. Supported: 20% or more. Rejected: under 5%. Anything between is inconclusive. The thresholds are targets we chose, not measurements.

**Notes.** Turning it on is Raz's decision.

**Result.** Not tested yet.
