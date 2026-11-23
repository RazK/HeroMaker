---
name: weekly-review
description: Use when the Sunday review fires, or when Raz asks "where are we" / "what's the status" for the week. Writes the 5-line weekly review from real numbers (D-001).
---

# Weekly review

Format and targets are in `docs/product/OPERATING.md`. Five lines, the ask at
the top if there is one.

## Gather (never invent a number)

- **Paid heroes last week** (Sunday to Saturday, Israel time): heroes
  finished for accounts with a real purchase (`purchase_done`, `test`
  false). Until production analytics is on (G-1 in
  `docs/product/HYPOTHESES.md`), read production's purchases and creations
  through the admin pages or the Railway tools, read-only. Say where each
  number came from. If you cannot read one, write "unknown" and why.
- **Money in:** Lemon Squeezy orders (and Grow, once live). From the
  finance agent's sheet once it exists.
- **Guardrails:** refunds, `hero_failed`, provider cost per hero.
- **Team status:** read the other agents' sessions (`get_session`, their
  latest summary). Names are their session titles.
- **What shipped:** merges to `main` this week (`git log --since`), and what
  reached production.

## Write

1. Score: number vs target (10/week by 31 Dec; 40/week break-even), money
   in, guardrails.
2. Learned: one belief that changed, and from what.
3. Decision: the one thing Raz must decide, or "none".
4. Next: 1-3 commitments, each with an owner.
5. Stop: one thing that brought no money.

Then add the decision, if Raz makes one, to `docs/product/DECISIONS.md`.
