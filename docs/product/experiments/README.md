# Experiments

One file per experiment: `E-NNN-<slug>.md`. The method is in
[`../README.md`](../README.md). **Nothing here is run without Raz's yes.**

## Run order

**One A/B at a time**, so no two tests change the same visitor's funnel. The
funnel observation by door keeps running underneath all of them.

1. **[E-002](E-002-campaign-doors.md) the campaign doors.** First: it is the
   baseline every other test is read against, and needs no code.
2. **[E-006](E-006-free-painting.md) free painting, pay for the 3D hero.** The
   biggest possible move in first purchases, and so in CAC.
3. Then by expected impact on CAC and LTV:
   1. [E-004](E-004-ad-video.md) ad video (CAC; fast, no code; needs Raz's OK for his face)
   2. [E-005](E-005-landing-first.md) landing first vs gallery (conversion at the top, every visitor)
   3. [E-008](E-008-ready-email.md) ready email (time to value, LTV; skip if H-015's baseline is already 70%)
   4. [E-003](E-003-first-pack-offer.md) $2 one-hero offer (first purchase; after E-006, which changes the same moment)
   5. [E-009](E-009-second-hero-half-price.md) second hero half price (LTV; too slow as an A/B today)
   6. [E-010](E-010-share-credits.md) share gives both sides credits (referral CAC; needs G-6 first; too slow today)
   7. [E-007](E-007-best-value-badge.md) Best value badge (AOV; too slow today)
   8. [E-001](E-001-gallery-order.md) gallery order (no direct money)

Planning arithmetic behind every duration (**assumptions, not
measurements**): during a campaign 200 visits a day, 15% start a hero (30), 2%
of visits buy (about 4), about 5 heroes made, half of them left during the
wait (2 to 3), about 1 shared. E-007, E-009 and E-010 break the six-week rule
at these numbers and say so; they wait for more sales or run as one offer per
period.

| Id | Experiment | Lever | Status | Tests |
|---|---|---|---|---|
| [E-001](E-001-gallery-order.md) | Gallery order: today's vs shuffled per visitor | conversion | draft | H-006, H-007 |
| [E-002](E-002-campaign-doors.md) | The first campaign, one door per audience | CAC | draft | H-001, H-002, H-003, H-024, H-038 |
| [E-003](E-003-first-pack-offer.md) | A one-hero offer on the Buy sheet | conversion | draft | H-012, H-013 |
| [E-004](E-004-ad-video.md) | Ad video: Violet dancing vs Raz waving with Violet copying | CAC | draft | H-039, H-001 |
| [E-005](E-005-landing-first.md) | Landing section first vs straight to the gallery | conversion | draft | H-040 |
| [E-006](E-006-free-painting.md) | Pay before the painting vs see your painting free | conversion, CAC | draft | H-041 |
| [E-007](E-007-best-value-badge.md) | Best value badge on the $15 pack vs the $40 pack | AOV | draft | H-042, H-012 |
| [E-008](E-008-ready-email.md) | Wait screen as today vs an email when the hero is ready | time to value, LTV | draft | H-043, H-015 |
| [E-009](E-009-second-hero-half-price.md) | Second hero half price after the first | LTV | draft | H-044, H-021 |
| [E-010](E-010-share-credits.md) | Plain share vs share gives both sides credits | CAC (referral) | draft | H-045, H-023 |

## Status

`draft` → `approved` (Raz said yes, with the date) → `running` → `closed`.
`abandoned` for one dropped before it ran, with one line on why.

## The flag key

`flag_key` is the experiment's name everywhere: the key in the analytics
`variants` map (`frontend/src/analytics.ts`), so every event of a browser in
the experiment carries its variant, and the PostHog feature-flag key, if a
PostHog flag is ever used. A lowercase slug (`a-z`, `0-9`, `-`, `_`, 40 at
most), unique, never reused after the experiment closes. `none` for an
experiment with no variants in the code (an observation by door, an
interview).

In code a key is written as a string literal, in one of these forms, so the
CI check can find it:

```ts
variants['gallery-order'] = arm;            // the analytics seam
experiment('gallery-order')                 // a helper, if one is added
posthog.getFeatureFlag('gallery-order')     // or isFeatureEnabled(...)
```

`devops/scripts/product_docs_check.py` fails CI when a key in the code has no
experiment file here, or when an experiment names a hypothesis that does not
exist.

**Before the first A/B experiment can run** (none can today):
- there is no assignment logic: `variants` is always empty;
- PostHog's flags are switched off on purpose (`advanced_disable_flags` in
  `frontend/src/posthogCore.ts`, so nothing in PostHog's dashboard can change
  the app). The simplest assignment that keeps that promise is local: a
  stable hash of the anonymous visitor id picks the arm;
- `variants` reaches our own table but not PostHog. It has to be registered
  there too, or PostHog cannot split a funnel by arm.

That is one small PR, made with the first experiment Raz approves.

## Template

Copy this into `E-NNN-<slug>.md`:

```markdown
---
id: E-NNN
title: "<the question, short>"
status: draft
lever: "<the funnel lever it moves: CAC, conversion, AOV, LTV or time to value>"
hypotheses: [H-NNN]
flag_key: <slug, or none>
variants: [<control>, <treatment>]
audience: "<who is in it, who is not (robots, class door, ...)>"
share: "<e.g. 50/50 of that audience>"
primary_metric: "<one metric, events named exactly>"
guardrails: ["<a metric that must not get worse>"]
sample: "<per arm, and how it was worked out>"
stop_date: "<set when it starts: the date, or the sample, whichever is later>"
approved: ""
started: ""
closed: ""
result: ""
decision: ""
---

# E-NNN: <title>

**Question.** One sentence.

**Variants.** What each arm sees.

**Audience and share.** Who is in it, how a browser is assigned, who is left out.

**Metrics.** Primary, then guardrails, with the events named exactly.

**Sample and stop.** How many, how long at the planning traffic, the stop rule.

**Needs before it runs.** What has to be built or decided, and by whom.

**Result.** The numbers, filled in when it closes.

**Decision.** What Raz decided, and the line in `../DECISIONS.md`.
```
