---
id: E-005
title: "Landing section first vs straight to the gallery"
status: draft
lever: "conversion (visit to make_started), and through it CAC"
hypotheses: [H-040]
flag_key: landing-first
variants: [landing, gallery]
audience: "signed-out browsers on their first visit, any door except a class; not robots, not admins, not a shared hero link (it opens the hero)"
share: "50/50, by a stable hash of the anonymous visitor id"
primary_metric: "browsers with make_started / browsers with a first visit (returning: false), by arm"
guardrails: ["hero_opened (from: gallery) per first visit", "gallery_seen max_scroll_pct", "screen_viewed (screen: gallery) seconds"]
sample: "about 920 first visits per arm (15% to 20% make_started)"
stop_date: "set when it starts: 14 days or the sample, whichever is later; 6 weeks at most"
approved: ""
started: ""
closed: ""
result: ""
decision: ""
---

# E-005: Landing section first vs straight to the gallery

**Question.** Does the landing's promise (three pictures, then Make a hero)
start more heroes than opening straight on the gallery?

**Variants.**
- `landing`: today. A signed-out visitor sees the landing
  (`frontend/src/components/tb/Landing.tsx`) above the gallery.
- `gallery`: the same page without the landing. Make a hero stays in the bar,
  as it is today once the landing is scrolled past.

**Audience and share.** Signed-out browsers on their first visit, 50/50 by a
hash of the visitor id; a browser keeps its arm on later visits. Left out:
signed-in accounts (they never see the landing), the class door, a shared
hero link (it opens the hero, not the landing), robots, admins.

**Metrics.**
- Primary: of browsers with a first `visit` (returning: false), the share
  with a `make_started`, by arm. Supported if `landing` is 5 points or more
  higher (H-040).
- Guardrails: `hero_opened` (from: gallery) per first visit must not drop by
  more than 5 points in `landing`; `gallery_seen` max_scroll_pct and
  `screen_viewed` (screen: gallery) seconds are watched.
- No new event is needed: `make_started` fires from both the landing's button
  and the bar's. If we want to know which button, that is
  needs: `make_started.from` (landing or bar), one enum on an existing event.

**Sample and stop.** From an assumed 15% (H-001) to 20% needs about 920 first
visits per arm, about 1,850 in all. At 200 visits a day, almost all first
visits during a campaign, about 10 days; read it at 14. At 30 a day it would
take about 9 weeks: run it only with campaign traffic.

**Needs before it runs.**
- Raz's yes. The landing is his design; the `gallery` arm hides it for half of
  new visitors.
- The experiment plumbing (`README.md`): local assignment, and `variants`
  sent to PostHog too.
- The switch itself: render the landing or not, a few lines in `App.tsx`.
- Production analytics on (G-1).

**Result.** Not run.

**Decision.** None yet.
