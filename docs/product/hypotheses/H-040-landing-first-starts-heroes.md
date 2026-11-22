---
id: H-040
title: "The landing's promise starts more heroes than the gallery alone"
status: untested
area: activation
segment:
  drawer: "any"
  payer: "parent"
  door: "any"
statement: "We believe signed-out first-time visitors will start a hero at least 5 points more often when the landing's three pictures come before the gallery than when they land straight on the gallery, because the promise says in three seconds what the gallery leaves them to work out."
metric: "`make_started` per first `visit` (returning: false), by arm; guardrail `hero_opened` (from: gallery) per first visit"
threshold:
  supported: "5 points or more higher with the landing, and gallery opens not more than 5 points lower"
  rejected: "the landing arm is the same or lower"
test: "A/B experiment"
sample: "about 920 first visits per arm"
duration: "about 2 weeks at campaign traffic; about 9 weeks without one (do not run it then)"
impact: 3
uncertainty: 3
priority: 9
experiments: [E-005]
---

# H-040: The landing's promise starts more heroes than the gallery alone

We believe signed-out first-time visitors will start a hero at least 5 points more often when the landing's three pictures come before the gallery than when they land straight on the gallery, because the promise says in three seconds what the gallery leaves them to work out.

**Why we think so.** The landing (Raz, 2026-11-22) puts "Make a hero" on the first screen. The gallery shows finished heroes, but not that a child's own drawing becomes one.

**How we'll know.** A/B experiment. Supported: 5 points or more higher with the landing, and gallery opens not more than 5 points lower. Rejected: the same or lower. Anything between is inconclusive. The thresholds are targets we chose, not measurements.

**Notes.** The landing pushes the gallery down. If it costs gallery opens and starts no more heroes, the gallery should go first.

**Result.** Not tested yet.
