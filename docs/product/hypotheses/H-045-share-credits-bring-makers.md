---
id: H-045
title: "Credits for both sides make a share bring new makers"
status: untested
area: referral
segment:
  drawer: "any"
  payer: "parent"
  door: "family"
statement: "We believe a shared hero will bring at least twice as many new first visits when the share gives both the sharer and the friend a free hero, because the friend gets a reason to try and the sharer a reason to send it."
metric: "first `visit` with door `share` per `share_tapped`, by arm; `make_started` and `purchase_done` per such visit; needs: the share link's door (G-6); needs: `referral_credited`"
threshold:
  supported: "2x or more new first visits per share, and cost per new maker under what a first purchase keeps"
  rejected: "under 1.3x"
test: "A/B experiment, or one offer per period if too slow"
sample: "about 50 shares per arm (to see 0.5 new visits per share become 1.0)"
duration: "at about 1 share a day during a campaign, about 3 months: too slow as an A/B for now"
impact: 3
uncertainty: 4
priority: 12
experiments: [E-010]
---

# H-045: Credits for both sides make a share bring new makers

We believe a shared hero will bring at least twice as many new first visits when the share gives both the sharer and the friend a free hero, because the friend gets a reason to try and the sharer a reason to send it.

**Why we think so.** A shared link arrives with a moving hero already in it (H-023); a free first hero removes the $5 between seeing and making.

**How we'll know.** A/B experiment. Supported: 2x or more new first visits per share, and cost per new maker under what a first purchase keeps. Rejected: under 1.3x. Anything between is inconclusive. The thresholds are targets we chose, not measurements.

**Notes.** A free hero costs us about $0.87; two per referral is about $1.74 per new maker, which is the referral's CAC. Tying two accounts together changes what we keep about who knows whom: Raz decides.

**Result.** Not tested yet.
