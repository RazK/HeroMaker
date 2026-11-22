---
id: E-010
title: "Plain share vs share gives both sides credits"
status: draft
lever: "CAC (referral: new visitors per share, cost per new maker)"
hypotheses: [H-045, H-023]
flag_key: share-credits
variants: [plain, both-credits]
audience: "owners of a ready hero who open Share; not class heroes, not robots, not admins"
share: "50/50, by a stable hash of the anonymous visitor id"
primary_metric: "first visits with door share per share_tapped, by arm"
guardrails: ["make_started and purchase_done per first visit from a share", "provider cost of free heroes per new maker", "self-referrals (same account or device on both sides)"]
sample: "about 50 shares per arm (0.5 to 1.0 new first visits per share)"
stop_date: "set when it starts: the sample, or 6 weeks; at about 1 share a day the sample takes about 3 months"
approved: ""
started: ""
closed: ""
result: ""
decision: ""
---

# E-010: Plain share vs share gives both sides credits

**Question.** If sharing a hero gives the sharer and the friend a free hero
each, does every share bring more new people, at a cost per new maker we can
afford?

**Variants.**
- `plain`: today. Share sends the hero's link (`heroLink` in `HeroScreen.tsx`).
- `both-credits`: Share says "You both get a free hero". The friend gets one
  hero's credits (10) on sign-up through the link; the sharer gets 10 when
  the friend's first hero is made.

**Audience and share.** Owners of a ready hero who open Share, 50/50 by a
hash of the visitor id. Left out: class heroes (a child in a class is not
offered a reward for recruiting), robots, admins.

**Metrics.**
- Primary: first `visit`s whose door is `share`, per `share_tapped`, by arm
  (H-045). Supported at 2x or more. **needs: the share link's door** (G-6 in
  `../HYPOTHESES.md`: `?via=share` on the shared link); today a shared link
  arrives as "direct". The arm of the sharer has to ride on the link too
  (`?via=share-credits` vs `?via=share`), or the visits cannot be split.
- Then, per such visit: `make_started` and `purchase_done` (H-023).
- needs: `referral_credited` (server, `side`: sharer or friend), so the cost
  is counted where it happens.
- Guardrails: provider cost of the free heroes (about $0.87 each, two per
  referral, about $1.74) per new maker must stay under what a first purchase
  keeps; self-referrals (same account, or same visitor id, on both sides).

**Sample and stop.** Visits per share are counts, and lumpy (one share to a
family group brings ten). To see 0.5 new visits per share become 1.0 needs
about 50 shares per arm. If 20% of heroes are shared (H-022) and about 5 are
made a day during a campaign, that is about 1 share a day: **about 3 months,
far past the six-week rule.** Do not start it until G-6 has shown how many
visits a plain share brings (H-023), and shares reach several a day.

**Needs before it runs.**
- G-6 built and read for a few weeks: the baseline.
- **Raz's yes**: free heroes cost money, and a referral ties two accounts
  together, which changes what we keep about who knows whom (⚑).
- Built behind the flag: the credits on both sides, server side, once per
  friend account; `referral_credited` in the allow-list; the sheet's words (a
  design Raz approves).
- The experiment plumbing (`README.md`).

**Result.** Not run.

**Decision.** None yet.
