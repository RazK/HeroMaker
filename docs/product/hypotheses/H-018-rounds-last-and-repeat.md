---
id: H-018
title: "Game rounds last and get replayed"
status: untested
area: retention
segment:
  drawer: "kid 7-12"
  payer: "parent"
  door: "any"
statement: "We believe a Robot Rumble round will last a median of at least 90 seconds and at least 40% of kids who finish a round will start another because the hero is theirs."
metric: "`game_ended` (game, seconds); `game_started` count per browser per day"
threshold:
  supported: "median 90 s or more, and 40% replay"
  rejected: "median under 45 s, or under 20% replay"
test: "funnel observation"
sample: "100 `game_ended`"
duration: "1 to 2 weeks of campaign"
impact: 3
uncertainty: 4
priority: 12
experiments: []
---

# H-018: Game rounds last and get replayed

We believe a Robot Rumble round will last a median of at least 90 seconds and at least 40% of kids who finish a round will start another because the hero is theirs.

**Why we think so.** Play is what makes a hero worth more than a picture.

**How we'll know.** Funnel observation. Supported: median 90 s or more, and 40% replay. Rejected: median under 45 s, or under 20% replay. Anything between is inconclusive. The thresholds are targets we chose, not measurements.

**Notes.** `game_ended` has no hero id today (see gaps).

**Result.** Not tested yet.
