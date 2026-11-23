# How we run: one number, one review a week, one promise

Raz adopted this on 2026-11-23 (D-001), from a startup operating kit he
brought. The kit's rule for a team our size: users before structure, one
KPI, one channel, no heavy test machinery. This page is what it means here.

## The number: paid heroes per week

- **KPI:** heroes finished (`hero_ready`) for accounts that have a real
  purchase (`purchase_done`, `test` false), per week, Sunday to Saturday,
  Israel time.
- **Activation** (the first real success): **the parent sees the painting**.
  The event: `hero_slide_viewed` with `slide: painting`, `from: mine`. Clicks
  and screen views are not activation.
- **Targets we chose, not forecasts:** 10 a week by 31 Dec 2026; 40 a week is
  break-even (about 160 a month, `docs/business/PLAN.md`).
- **Guardrails:** refunds, failed heroes (`hero_failed`), provider cost per
  hero (about $0.87), complaints.
- **Until production collects analytics (G-1)** the number is read from
  production's purchases and creations, not from events.

## The weekly review (Sunday, 5 lines to Raz)

1. **Score:** paid heroes this week vs the target; money in; guardrails.
2. **Learned:** what changed what we believe (a pilot, a result, a user).
3. **Decision:** the one thing Raz needs to decide, or "none".
4. **Next:** one to three commitments for the week, each with its owner.
5. **Stop:** one thing we did that brought no money, and stop doing it.

The longer form, for when there is more to say, is
[`templates/WEEKLY_REVIEW.md`](templates/WEEKLY_REVIEW.md).

## Tests: pilots before A/B

At a few heroes a day most A/B tests take months (see `README.md`, "Choosing
the test"). So, until we sell **20 heroes a week** (a threshold we chose):

- **Run only** [E-002](experiments/E-002-campaign-doors.md) (campaign
  doors, no code) and [E-006](experiments/E-006-free-painting.md) (pay after
  the painting). The other experiments stay drafts.
- **Learn from observed pilots:** Schneider (10 Dec) and a school class.
  Before each, write down the 3 questions it must answer. During it, write
  what children and parents do and say: where they wait, what they point at,
  what they ask, who asks for the link or the price. **Never a child's name,
  face or drawing.** After it, one line per question: what we now believe.
- No p-values from small samples. Say how many people and what is still
  unknown.

## One promise, everywhere

"You draw it. We paint it. It comes alive!" The ad, the landing page, the
first screen, the share video and the share page all say this and deliver
it. Before any money goes to an ad, check each step against it
([`templates/GROWTH_CAMPAIGN.md`](templates/GROWTH_CAMPAIGN.md), "Message
consistency check").

## Templates

In [`templates/`](templates/), from the kit, for when a short note is not
enough. Experiments keep their own format (`experiments/README.md`) and
decisions theirs (`DECISIONS.md`).

| Template | Use it for |
|---|---|
| `PRD.md` | A feature bigger than a day: problem, KPI, options, smallest test |
| `DESIGN_REVIEW.md` | Before showing Raz a screen (with `docs/design/PRINCIPLES.md`) |
| `FEATURE_LAUNCH.md` | Before promoting a feature to production |
| `GROWTH_CAMPAIGN.md` | Before any paid campaign or creative |
| `WEEKLY_REVIEW.md` | The weekly review, long form |
| `FINANCIAL_REVIEW.md` | Once a month: money in, costs, runway |
| `METRICS_DICTIONARY.md` | When a metric's definition is in doubt |

One rule from the kit does not apply here: "the agent does not merge". In
this project the agent merges to `main`, which deploys to staging; only Raz
promotes to production (`CLAUDE.md`). The kit itself puts the project's rules
first.
