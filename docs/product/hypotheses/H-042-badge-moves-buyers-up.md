---
id: H-042
title: "A Best value badge on the $40 pack raises the average order"
status: untested
area: payment
segment:
  drawer: "any"
  payer: "parent"
  door: "any"
statement: "We believe buyers will spend at least 20% more per first purchase when the Best value badge sits on Studio ($40) instead of Maker ($15), because a badge points the eye and many buyers take the pack it points at."
metric: "mean `purchase_done` amount_cents (test: false) per first purchase, by arm; pack mix; guardrail `checkout_started` / `credits_shown`"
threshold:
  supported: "average first order 20% or more higher, and `checkout_started` / `credits_shown` not more than 3 points lower"
  rejected: "average first order the same or lower, or checkouts more than 3 points lower"
test: "A/B experiment"
sample: "about 200 first purchases per arm (Studio's share from 10% to 20%)"
duration: "about 3 months at campaign traffic: too slow for now"
impact: 2
uncertainty: 3
priority: 6
experiments: [E-007]
---

# H-042: A Best value badge on the $40 pack raises the average order

We believe buyers will spend at least 20% more per first purchase when the Best value badge sits on Studio ($40) instead of Maker ($15), because a badge points the eye and many buyers take the pack it points at.

**Why we think so.** Studio is the cheapest per hero. Today the badge is on Maker (`highlight` in `backend/app/config/packs.py`).

**How we'll know.** A/B experiment. Supported: average first order 20% or more higher, with checkouts not more than 3 points lower. Rejected: the same or lower, or checkouts more than 3 points lower. Anything between is inconclusive. The thresholds are targets we chose, not measurements.

**Notes.** Studio's blurb says "for a classroom or a party": a family may read a badge there as "not for us". The checkout guardrail watches for that.

**Result.** Not tested yet.
