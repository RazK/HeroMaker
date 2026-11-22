---
id: E-001
title: "Gallery order: today's vs shuffled per visitor"
status: draft
lever: "conversion (gallery to hero_opened to make_started)"
hypotheses: [H-006, H-007]
flag_key: gallery-order
variants: [default, shuffle]
audience: "every browser that sees the Editors' choice gallery; not robots, not the class door, not admins"
share: "50/50, by a stable hash of the anonymous visitor id"
primary_metric: "browsers with hero_opened (from: gallery) / browsers with gallery_seen, by order"
guardrails: ["make_started per browser", "screen_viewed (screen: gallery) seconds", "gallery_seen max_scroll_pct"]
sample: "about 1,000 gallery browsers per arm (a 5-point margin around an assumed 30% open rate)"
stop_date: "set when it starts: 14 days or the sample, whichever is later; 6 weeks at most"
approved: ""
started: ""
closed: ""
result: ""
decision: ""
---

# E-001: Gallery order, today's vs shuffled per visitor

**Question.** Does shuffling the gallery per visitor cost us opens, and once
position is random, which heroes pull people in?

**Variants.**
- `default`: today's order. Editors' choice, the most recently updated first
  (`list_creations`, `featured_only`). Everyone sees the same first row.
- `shuffle`: the same heroes, shuffled once per visitor (seeded by the
  anonymous visitor id), so a visitor sees the same order every time they
  come back, and two visitors see different first rows.

**Audience and share.** Every browser that sees the Editors' choice gallery,
50/50 by a hash of the visitor id. Left out: robots (already), browsers whose
door is a class (they see their class), and admins. The arm is sent as
`variants['gallery-order']` with every event, and the gallery's `order`
property (`GALLERY_ORDER` in `frontend/src/analytics.ts`) says `shuffle` in
that arm, so `gallery_seen` and `hero_opened` already record it.

**Metrics.**
- Primary: of browsers with a `gallery_seen`, the share with a `hero_opened`
  (from: gallery) in the same visit. Shuffle passes if it is no more than 5
  points below default (H-006).
- Per hero, in the shuffle arm only: `hero_opened` / impressions in
  `gallery_seen`, at the same grid place. Each featured hero is labelled
  child-like or polished by hand, here, before the start (H-007). The label
  is about the drawing, not the child.
- Guardrails: `make_started` per browser must not drop by more than 2 points;
  seconds on the gallery (`screen_viewed`) and `max_scroll_pct` are watched.

**Sample and stop.** A non-inferiority margin of 5 points around an assumed
30% open rate needs about 1,000 browsers per arm. At 200 visits a day
(campaign) that is 10 to 12 days; at 30 a day, about 10 weeks, which is too
long: run it only with campaign traffic. Read it at the stop date, not before.

**Needs before it runs.**
- Raz's yes.
- The experiment plumbing (`experiments/README.md`): local assignment, and
  `variants` sent to PostHog too.
- The shuffle itself in the gallery: a few lines, no new screen.
- Production analytics on (the privacy page first; only Raz changes its words).

**Result.** Not run.

**Decision.** None yet.
