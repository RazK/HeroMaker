---
id: E-003
title: "A one-hero offer on the Buy sheet"
status: draft
hypotheses: [H-012, H-013]
flag_key: first-pack
variants: [packs, single]
audience: "signed-in accounts with no purchase yet that open the Buy credits sheet; not class seats, not robots"
share: "50/50, by a stable hash of the anonymous visitor id"
primary_metric: "checkout_started / credits_shown, by arm"
guardrails: ["revenue per credits_shown (purchase_done amount_cents)", "second purchase within 30 days", "hero_failed"]
sample: "about 300 credits_shown per arm (from an assumed 20% to 30%)"
stop_date: "set when it starts: the sample, or 5 weeks"
approved: ""
started: ""
closed: ""
result: ""
decision: ""
---

# E-003: A one-hero offer on the Buy sheet

**Question.** Does a first purchase small enough to be a try ($2 for one
hero) bring more parents through checkout, without lowering what we earn per
parent who sees the sheet?

**Variants.**
- `packs`: today's sheet. Starter $5 (3 heroes), Maker $15 (10), Studio $40 (30).
- `single`: the same, with "One hero · $2" first.

**Audience and share.** Signed-in accounts that have never bought, the first
time they open the Buy credits sheet; 50/50 by a hash of the visitor id. A
parent keeps the arm they first saw. Class seats are out of it.

**Metrics.**
- Primary: `checkout_started` / `credits_shown` (H-013). Supported at 1.5x or
  more.
- Pack mix: `purchase_done` (pack) in each arm (H-012).
- Guardrails: revenue per `credits_shown` (`purchase_done` amount_cents) must
  not be lower in `single`; second purchase within 30 days, read later;
  `hero_failed`.

**Sample and stop.** From an assumed 20% to 30% checkout rate, about 300
sheets per arm. Assuming about 25 first-time sheets a day during a campaign,
about 3.5 weeks. Without a campaign it would take months: do not run it then.

**Needs before it runs.**
- **Raz's decision on the price.** A $2 hero keeps about $1.40 after Lemon
  Squeezy's fee. At the cost in the code's price table ($0.57 a hero) that is
  59% and clears the 50% floor (`MIN_GROSS_MARGIN_BPS`); at Meshy's current
  prices (about $0.87) it is $0.53, 38%, under it: the same open question as
  every pack (READINESS item 7).
- A new Lemon Squeezy product and variant, live and test.
- The experiment plumbing (`experiments/README.md`).
- Raz's yes.

**Result.** Not run.

**Decision.** None yet.
