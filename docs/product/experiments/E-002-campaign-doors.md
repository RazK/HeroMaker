---
id: E-002
title: "The first campaign, one door per audience"
status: draft
lever: "CAC (cost per buyer, by door)"
hypotheses: [H-001, H-002, H-003, H-024, H-038]
flag_key: none
variants: [ad-family, ad-gift, ad-birthday, ad-teacher]
audience: "everyone who arrives through one of the campaign's ad sets; each ad set links with its own via tag"
share: "equal budget per ad set"
primary_metric: "purchase_done (test: false) per first visit, by door"
guardrails: ["hero_failed per hero started", "cost per first visit, by door (from the ad dashboards)"]
sample: "500 first visits per door, 2,000 in all"
stop_date: "set when it starts: when every door has 500 first visits, or 3 weeks"
approved: ""
started: ""
closed: ""
result: ""
decision: ""
---

# E-002: The first campaign, one door per audience

**Question.** Who does the campaign catch, and which of them pays?

**Variants.** Not an A/B test: four ad sets, the same app, each linking with
its own door tag, so each audience is its own segment without asking anyone
anything (`docs/analytics/REQUIREMENTS.md`, "the door").

| Door tag | Audience | Ad says, roughly |
|---|---|---|
| `ad-family` | parents of kids 4-12 | Your child's drawing, alive |
| `ad-gift` | grown-ups looking for a present | A gift made from their own drawing |
| `ad-birthday` | parents planning a party | Every guest makes a hero |
| `ad-teacher` | teachers | One hero per child, no accounts |

The ad copy and targeting are Raz's. The tags are what this experiment needs.

**Audience and share.** Everyone through those links. Equal daily budget per
ad set, so the doors are compared on the same money.

**Metrics.**
- Primary: `purchase_done` (test: false) per first `visit`, by door (H-002,
  H-003). For `ad-teacher`: `class_created`, then `purchase_done`
  (pack: class_seats).
- Along the way, by door: `make_started` per first visit (H-001), then
  `adult_confirmed`, `signin_done`, `credits_shown`, `checkout_started`.
- After payment: `survey_answered` purpose and who, by door (H-024, H-038).
- Guardrails: `hero_failed` per hero started (a broken provider ruins every
  door at once); cost per first visit, from the ad dashboards, written here
  by hand.

**Sample and stop.** 500 first visits per door. At 200 visits a day split
four ways, about 10 days; the teacher door will be slower. Purchases are
rare: at the 2% target that is about 10 per door, enough to see a 3x
difference, not a 1.5x one. `make_started` is the steadier signal.

**Needs before it runs.**
- Raz's yes, the budget, and the ad copy.
- Production able to take money and make heroes (READINESS list 3, items 1-6).
- Production analytics on: `ANALYTICS_ENABLED`, the production PostHog key,
  and the privacy page saying what is collected, in Raz's words.
- For `ad-teacher`: class seats buyable on production (READINESS item 9).
- No code: the door already works (`?via=`).

**Result.** Not run.

**Decision.** None yet.
