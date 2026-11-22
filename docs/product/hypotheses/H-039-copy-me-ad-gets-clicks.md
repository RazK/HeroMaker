---
id: H-039
title: "A hero copying a real person outclicks a dancing hero"
status: untested
area: acquisition
segment:
  drawer: "any"
  payer: "parent"
  door: "ad"
statement: "We believe parents shown a short ad will click at least 1.3 times as often when it shows Violet copying a grown-up who waves than when it shows Violet dancing, because a hero that moves with you is something no toy does."
metric: "click-through rate per ad (impressions and clicks, from the ad dashboards); `make_started` per first `visit`, by door"
threshold:
  supported: "click-through 1.3x or more, and `make_started` per first visit not lower"
  rejected: "click-through under 1.1x, or `make_started` per first visit lower"
test: "A/B experiment (two ad creatives, one door tag each)"
sample: "about 20,000 impressions per creative for the click-through; about 500 first visits per creative for `make_started`"
duration: "click-through in a few days; `make_started` 1 to 3 weeks of campaign"
impact: 3
uncertainty: 4
priority: 12
experiments: [E-004]
---

# H-039: A hero copying a real person outclicks a dancing hero

We believe parents shown a short ad will click at least 1.3 times as often when it shows Violet copying a grown-up who waves than when it shows Violet dancing, because a hero that moves with you is something no toy does.

**Why we think so.** The README GIF (`docs/assets/kalidoface_demo.gif`) is the strongest proof we have that the hero is alive, not a recording. Dancing is what every animated character does.

**How we'll know.** A/B experiment of two creatives, each with its own door tag. Supported: click-through 1.3x or more, and `make_started` per first visit not lower. Rejected: under 1.1x, or `make_started` lower. Anything between is inconclusive. The thresholds are targets we chose, not measurements.

**Notes.** The waving clip shows Raz's face: it needs his OK before it is an ad. A click is cheap; the `make_started` guardrail stops a clickbait winner.

**Result.** Not tested yet.
