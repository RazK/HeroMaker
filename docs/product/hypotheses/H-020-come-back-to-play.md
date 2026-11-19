---
id: H-020
title: "Kids come back to play within a week"
status: untested
area: retention
segment:
  drawer: "kid 4-12"
  payer: "parent"
  door: "family"
statement: "We believe at least 25% of browsers that made a hero will come back within 7 days and tap a move or start a game because the hero is now their toy."
metric: "`visit` (returning: true) followed by `move_tapped` or `game_started`, within 7 days of `hero_ready`"
threshold:
  supported: "25% or more"
  rejected: "under 10%"
test: "funnel observation (retention by cohort)"
sample: "100 browsers with a ready hero"
duration: "2 weeks from the first 100 heroes"
impact: 4
uncertainty: 5
priority: 20
experiments: []
---

# H-020: Kids come back to play within a week

We believe at least 25% of browsers that made a hero will come back within 7 days and tap a move or start a game because the hero is now their toy.

**Why we think so.** A one-time wow sells one pack. Coming back is what sells the second.

**How we'll know.** Funnel observation (retention by cohort). Supported: 25% or more. Rejected: under 10%. Anything between is inconclusive. The thresholds are targets we chose, not measurements.

**Notes.** A browser, not a person: a parent who comes back on another device looks new (no one is identified). Read with H-021, which is per account.

**Result.** Not tested yet.
