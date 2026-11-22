---
id: E-004
title: "Ad video: Violet dancing vs Raz waving with Violet copying"
status: draft
lever: "CAC (click-through, then visit to make_started)"
hypotheses: [H-039, H-001]
flag_key: none
variants: [ad-video-dance, ad-video-copy]
audience: "one ad set per creative, same audience, same budget, same copy; the door that won E-002 (family, unless E-002 says otherwise)"
share: "equal daily budget per ad set"
primary_metric: "click-through rate per creative (clicks / impressions, from the ad dashboard)"
guardrails: ["make_started per first visit, by door", "cost per first visit, by door (from the ad dashboard)", "hero_failed per hero started"]
sample: "about 20,000 impressions per creative (1.0% to 1.3% click-through); about 500 first visits per creative for make_started (15% to 22%)"
stop_date: "set when it starts: both samples reached, or 3 weeks"
approved: ""
started: ""
closed: ""
result: ""
decision: ""
---

# E-004: Ad video, Violet dancing vs Raz waving with Violet copying

**Question.** Which ad brings more clicks, and more heroes started per click:
Violet dancing, or Raz waving with Violet copying him?

**Variants.** Two ad creatives, everything else the same (copy, audience,
budget, landing link). Not an app change: each ad set links with its own door
tag, like E-002.

| Door tag | The video |
|---|---|
| `ad-video-dance` | Violet: drawing → painting → dancing 3D (the landing's design) |
| `ad-video-copy` | Raz waves, Violet copies him (`docs/assets/kalidoface_demo.gif`, the README GIF) |

**Audience and share.** The audience of the door that won E-002 (family,
unless E-002 says otherwise), one ad set per creative, equal daily budget.
The platform shows each ad to its own people; that is the comparison.

**Metrics.**
- Primary: click-through rate per creative, from the ad dashboard, copied
  here by hand (G-12 in `../HYPOTHESES.md`). Supported at 1.3x or more (H-039).
- Guardrail, and the one that decides a close call: `make_started` per first
  `visit`, by door (H-001). A video that gets clicks and no heroes loses.
- Cost per first visit, from the ad dashboard; `hero_failed` per hero started.

**Sample and stop.** Click-through is cheap to read: from about 1.0% to
1.3% needs about 20,000 impressions per creative, a few days at a small
budget. `make_started` is the slow half: from 15% to 22% needs about 500
first visits per creative. With the whole campaign's 200 visits a day on these
two ad sets, about 5 days; on the family door's quarter (50 a day), about 3
weeks. Stop at both samples or 3 weeks, whichever comes first, and read
`make_started` as inconclusive if it is short.

**Needs before it runs.**
- **Raz's OK to use his face in an ad.** Without it there is no second arm.
- The video cut from the GIF to the ad formats (square and vertical), with
  the same length and end card as the dancing one.
- E-002 finished, so the door is chosen and nothing else changes during it.
- Raz's yes and the budget.
- No code: the door already works (`?via=`).

**Result.** Not run.

**Decision.** None yet.
