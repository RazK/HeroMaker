---
id: H-003
title: "Gift and birthday visitors buy more often"
status: untested
area: acquisition
segment:
  drawer: "any"
  payer: "grown-up giver"
  door: "gift/birthday"
statement: "We believe visitors from a gift or birthday ad will buy at least 1.5 times as often as visitors from the general family ad because a gift has a date and a recipient."
metric: "`purchase_done` per first `visit`, door `ad-gift` / `ad-birthday` against `ad-family`"
threshold:
  supported: "gift or birthday door converts at 1.5x the family door or more"
  rejected: "1.0x or less"
test: "funnel observation by door (separate ad sets, equal budget)"
sample: "500 first visits per door"
duration: "2 to 3 weeks of campaign for four doors"
impact: 4
uncertainty: 5
priority: 20
experiments: [E-002]
---

# H-003: Gift and birthday visitors buy more often

We believe visitors from a gift or birthday ad will buy at least 1.5 times as often as visitors from the general family ad because a gift has a date and a recipient.

**Why we think so.** Raz is asking who the campaign catches. Doors are the cheapest way to answer it: one link per audience, no questions asked.

**How we'll know.** Funnel observation by door (separate ad sets, equal budget). Supported: gift or birthday door converts at 1.5x the family door or more. Rejected: 1.0x or less. Anything between is inconclusive. The thresholds are targets we chose, not measurements.

**Notes.** Purchases are rare, so expect wide error bars: a 1.5x difference on 10 purchases is noise. Read it together with `make_started`, which is ten times more frequent.

**Result.** Not tested yet.
