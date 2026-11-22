---
id: H-044
title: "A half-price second hero brings a second purchase"
status: untested
area: retention
segment:
  drawer: "any"
  payer: "parent"
  door: "any"
statement: "We believe first-time buyers offered their next hero at half price will buy again within 30 days at least twice as often as buyers with no offer, because the first hero showed them it is worth it and the second asks less."
metric: "second `purchase_done` (test: false) per account within 30 days of the first, by arm (our own table, which has the account); needs: `offer_shown`"
threshold:
  supported: "2x or more second purchases, and third purchases not lower"
  rejected: "under 1.3x"
test: "A/B experiment, or one offer per period if too slow"
sample: "about 65 first-time buyers per arm to see 10% become 30%; about 200 per arm to see 10% become 20%"
duration: "at about 4 first-time buyers a day, 5 weeks of buyers plus the 30-day window: about 9 to 10 weeks. Too slow as an A/B at campaign traffic"
impact: 4
uncertainty: 4
priority: 16
experiments: [E-009]
---

# H-044: A half-price second hero brings a second purchase

We believe first-time buyers offered their next hero at half price will buy again within 30 days at least twice as often as buyers with no offer, because the first hero showed them it is worth it and the second asks less.

**Why we think so.** A hero keeps $0.29 to $0.55 (`docs/business/PLAN.md`): a paid ad pays back only on a second purchase (H-021). A second purchase is a smaller step than the first.

**How we'll know.** A/B experiment. Supported: 2x or more second purchases, with third purchases not lower. Rejected: under 1.3x. Anything between is inconclusive. The thresholds are targets we chose, not measurements.

**Notes.** At $0.87 a hero, half price loses money on the discounted purchase itself (half a Starter keeps about $1.88 for heroes that cost $2.61). It pays only if it leads to more full-price purchases. A price decision for Raz.

**Result.** Not tested yet.
