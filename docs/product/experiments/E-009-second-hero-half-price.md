---
id: E-009
title: "Second hero half price after the first"
status: draft
lever: "LTV (second purchase within 30 days)"
hypotheses: [H-044, H-021]
flag_key: second-hero-half
variants: [none, half-price]
audience: "accounts whose first purchase_done (test: false) is done and whose first hero is ready; not class seats, not robots, not admins"
share: "50/50 by account, assigned at the first purchase"
primary_metric: "accounts with a second purchase_done (test: false) within 30 days of the first / first-time buyers, by arm (our own table)"
guardrails: ["margin on the discounted purchase (amount_cents after fees minus heroes made from it at about $0.87)", "third purchase within 60 days", "refund requests"]
sample: "about 65 first-time buyers per arm to see 10% become 30%; about 200 per arm for 10% to 20%"
stop_date: "set when it starts: the sample plus the 30-day window; about 9 to 10 weeks at campaign traffic"
approved: ""
started: ""
closed: ""
result: ""
decision: ""
---

# E-009: Second hero half price after the first

**Question.** If a family is offered its next hero at half price once the
first is ready, do more of them buy again within 30 days, and does it pay?

**Variants.**
- `none`: today. No offer.
- `half-price`: when the first paid hero is ready, the hero screen offers the
  next hero at half price for 30 days, through a one-use Lemon Squeezy
  discount. **What "a hero" is to buy needs deciding first:** there is no
  one-hero product today (E-003 proposes $2). Half a Starter ($2.50 for 3) is
  the nearest with what exists.

**Audience and share.** First-time buyers once their first hero is ready,
50/50 by account at the first purchase (the account, not the browser:
the second purchase may come from another device). Left out: class seats,
robots, admins.

**Metrics.**
- Primary: second `purchase_done` (test: false) within 30 days of the first,
  per first-time buyer, by arm, from our own table (it knows the account;
  PostHog does not). Supported at 2x or more (H-044). The `none` arm is
  H-021's baseline.
- needs: `offer_shown` (browser, no properties), so the treatment can be
  checked to have reached people.
- Guardrails: the margin of the discounted purchase. Half a Starter keeps
  about $1.88 after Lemon Squeezy's fee for heroes that cost about $2.61: a
  loss of up to $0.74 if all three are made. It pays only through later
  full-price purchases, so third purchases within 60 days are watched.
  Refund requests, by hand.

**Sample and stop.** Buyers are rare. To see 10% (H-021's line) become 30%
needs about 65 first-time buyers per arm; at about 4 a day during a
campaign, 5 weeks of buyers, then the 30-day window: **9 to 10 weeks, past
the six-week rule.** To see 10% become 20% needs about 200 per arm, about
5 months. Honest options: run it as one offer per period (everyone for one
month, compared with H-021's cohort the month before), like a price test, or
wait for about 15 first-time buyers a day.

**Needs before it runs.**
- **Raz's price decision**: what is half price, on what, and accepting a loss
  on the discounted purchase.
- H-021's baseline cohort (start the clock with E-002).
- A Lemon Squeezy discount, one use per account, live and test.
- Built behind the flag: the offer on the hero screen (a design Raz
  approves), the arm stored on the account, `offer_shown` in the allow-list.

**Result.** Not run.

**Decision.** None yet.
