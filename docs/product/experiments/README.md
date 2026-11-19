# Experiments

One file per experiment: `E-NNN-<slug>.md`. The method is in
[`../README.md`](../README.md). **Nothing here is run without Raz's yes.**

| Id | Experiment | Status | Tests |
|---|---|---|---|
| [E-001](E-001-gallery-order.md) | Gallery order: today's vs shuffled per visitor | draft | H-006, H-007 |
| [E-002](E-002-campaign-doors.md) | The first campaign, one door per audience | draft | H-001, H-002, H-003, H-024, H-038 |
| [E-003](E-003-first-pack-offer.md) | A one-hero offer on the Buy sheet | draft | H-012, H-013 |

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
