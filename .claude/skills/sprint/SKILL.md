---
name: sprint
description: Use when the PM runs a sprint ceremony (kickoff, review, retro) or the daily sync, or when an agent is asked to prepare for one. The team's 3-day sprint cadence and the working-demo gate (docs/ops/CADENCE.md).
---

# Sprint cadence

The rhythm, the dates and the ceremonies are in `docs/ops/CADENCE.md`. This
skill is how to run or prepare for one.

## If you are the PM, running a ceremony

Compute the sprint day first: `(days since 2026-11-23) mod 3` (day 0 kickoff,
day 2 review+retro). Then:

- **Daily sync (every morning):** ReadNotifications; check each agent's
  session (get_session) for shipped / blocked / next; unblock what you can
  (answer, re-scope, hand off); give Raz 5 lines — the number if known, what
  shipped, who is blocked and on what, the one thing you need from him, or
  "nothing" if there is nothing for him.
- **Kickoff (day 0):** run `money-check` on the open work; pick ONE
  money-focused sprint goal; give each agent 1–3 outcomes, each naming the
  **working staging demo** it must show at review; append the sprint to
  `docs/ops/SPRINT_LOG.md`; tell Raz the goal and the commitments.
- **Review (day 2):** run the staging robot; collect each agent's demo and
  check it is real (a staging link, a screenshot, a green robot, or a named
  passing test + the staging behaviour). Present Raz committed-vs-delivered,
  one demo per agent. No demo, no credit — say so plainly.
- **Retro (after review):** keep / stop / one process fix; write it to the
  log; carry the fix into the next kickoff.

Message agents with a one-shot scheduled task into their session; collect
their replies; synthesise. Never present Raz a demo you have not seen working
yourself.

## If you are an agent, preparing

- At kickoff you are given outcomes and the demo each must produce. Reply with
  your 1–3 commitments and the exact demo you will show (what, on staging).
- By review, have a **working demo on staging, tested by you** — not a plan, a
  diff or a mock. If it will not be ready, say so at the daily sync BEFORE
  review, with why and what you need. A surprise at review is the failure, not
  an unfinished task honestly flagged early.
- Everything through the normal flow: branch, PR, CI green, the PM merges,
  staging, your own robot/Playwright check. Design behind Maya's gate; money
  changes keep their invariants; children's privacy holds.
