---
id: H-001
title: "Ad visitors start making a hero"
status: untested
area: activation
segment:
  drawer: "any"
  payer: "parent"
  door: "ad"
statement: "We believe parents arriving from a paid ad will start making a hero in at least 15% of first visits because the gallery shows in seconds that a child's drawing becomes a moving 3D hero."
metric: "`make_started` per first `visit` (returning: false), cut by door"
threshold:
  supported: "15% or more of first visits from the ad door reach `make_started`"
  rejected: "under 5%"
test: "funnel observation by door"
sample: "300 first visits from the ad door"
duration: "2 days at campaign traffic (200 visits a day); 10 days without one"
impact: 5
uncertainty: 4
priority: 20
experiments: [E-002, E-004]
---

# H-001: Ad visitors start making a hero

We believe parents arriving from a paid ad will start making a hero in at least 15% of first visits because the gallery shows in seconds that a child's drawing becomes a moving 3D hero.

**Why we think so.** The gallery is the whole pitch: no sign-up wall before it. If the pitch works, a meaningful share of strangers tries.

**How we'll know.** Funnel observation by door. Supported: 15% or more of first visits from the ad door reach `make_started`. Rejected: under 5%. Anything between is inconclusive. The thresholds are targets we chose, not measurements.

**Notes.** Under 5% means the landing does not explain itself to a stranger, or the ad reached the wrong people. Look at `gallery_seen` max_scroll_pct and `hero_opened` before blaming the ad.

**Result.** Not tested yet.
