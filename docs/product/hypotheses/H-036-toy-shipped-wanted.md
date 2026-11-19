---
id: H-036
title: "Parents want the toy shipped"
status: untested
area: toy
segment:
  drawer: "any"
  payer: "parent"
  door: "family"
statement: "We believe at least 10% of visitors who view a toy will tap 'Send it to me' at a shown price of $25 because most homes have no 3D printer."
metric: "needs: `toy_ship_tapped` (a fake-door button on the toy slide), per `hero_slide_viewed` (slide: toy)"
threshold:
  supported: "10% or more"
  rejected: "under 2%"
test: "fake door"
sample: "300 toy slide views"
duration: "3 to 4 weeks"
impact: 4
uncertainty: 5
priority: 20
experiments: []
---

# H-036: Parents want the toy shipped

We believe at least 10% of visitors who view a toy will tap 'Send it to me' at a shown price of $25 because most homes have no 3D printer.

**Why we think so.** Shipping is a business of its own (printing, post, returns). Only build it if the fake door says so.

**How we'll know.** Fake door. Supported: 10% or more. Rejected: under 2%. Anything between is inconclusive. The thresholds are targets we chose, not measurements.

**Notes.** The fake door answers honestly ('Not yet. Thanks for telling us.') and collects nothing. Needs a design approved by Raz.

**Result.** Not tested yet.
