---
id: H-006
title: "A shuffled gallery opens as well as today's order"
status: untested
area: activation
segment:
  drawer: "any"
  payer: "nobody yet"
  door: "any"
statement: "We believe first-time visitors shown the Editors' choice gallery shuffled per visitor will open a hero at least as often (within 5 points) as visitors shown today's order, because a good first row is luck either way and shuffling spreads impressions over every hero."
metric: "visitors with `hero_opened` (from: gallery) / visitors with `gallery_seen`, by `order`"
threshold:
  supported: "shuffle is no more than 5 points below default"
  rejected: "shuffle is more than 5 points below default"
test: "A/B experiment"
sample: "about 1,000 gallery visitors per arm"
duration: "10 to 12 days at campaign traffic; about 10 weeks without one"
impact: 3
uncertainty: 3
priority: 9
experiments: [E-001]
---

# H-006: A shuffled gallery opens as well as today's order

We believe first-time visitors shown the Editors' choice gallery shuffled per visitor will open a hero at least as often (within 5 points) as visitors shown today's order, because a good first row is luck either way and shuffling spreads impressions over every hero.

**Why we think so.** Today's order is Editors' choice, most recently updated first. Everyone sees the same first row, so the heroes lower down are never really tested.

**How we'll know.** A/B experiment. Supported: shuffle is no more than 5 points below default. Rejected: shuffle is more than 5 points below default. Anything between is inconclusive. The thresholds are targets we chose, not measurements.

**Notes.** This is the prerequisite for H-007: per-hero click-through is only fair when position is random.

**Result.** Not tested yet.
