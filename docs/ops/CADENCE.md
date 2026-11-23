# How the team runs: daily sync, 3-day sprints

Raz set this on 2026-11-23, from the operating kit's Team Cadence
(`docs/product/templates/WEEKLY_REVIEW.md` is the long form). The PM conducts
it; every agent comes to a ceremony with a **working demo on staging, tested
— never slides or a description**. The one rule above all: *evidence over
activity* (`docs/product/OPERATING.md`).

## The rhythm

- **A sprint is 3 days.** Anchor: 2026-11-23. Today's sprint day =
  `(days since 2026-11-23) mod 3`. Day 0 is **kickoff**, day 2 is **review +
  retro**, day 3 starts the next sprint.
- **Daily sync, every morning.** The PM gathers each agent's state (shipped /
  blocked / next), unblocks what it can, and gives Raz a 5-line sync.
- **Three ceremonies per sprint**, all run by the PM:

| Ceremony | When | What happens | What Raz gets |
|---|---|---|---|
| **Kickoff** | day 0, morning | The PM sets ONE money-focused sprint goal and gives each agent 1–3 outcomes, each with the working demo it must show at review. | The goal and each agent's commitments. |
| **Review** | day 2, evening | Each agent brings a working, staging-tested demo. The PM runs the robot, checks each demo, and compares committed vs delivered. | A demo per agent (a staging link, a screenshot, a green robot) and what shipped. |
| **Retro** | day 2, after review | Keep / stop / one process fix for next sprint; it feeds the next kickoff. | Three lines: keep, stop, the one change. |

## What a "working demo" means (the gate)

A demo counts only if Raz could click or watch it himself:
- a **staging link** on the real site, or
- a **screenshot / short recording** of the real thing on staging, or
- a **green staging robot** run, or
- for a backend-only change, a **passing test** named, plus the staging
  behaviour it proves.

A plan, a diff, "it should work", or a canvas mock is **not** a demo. An agent
with nothing working says so at the sync before the review, so the PM can help
or re-scope — never a surprise at review.

## Requests to Raz

Raz's role is to monitor, answer the PM, and unblock (payments, accounts,
approvals). **Every request to Raz funnels through the PM**, who keeps one
prioritised list and surfaces at most the top one or two at a time, batched —
never a flood. No agent asks Raz directly.

## The log

The PM keeps `SPRINT_LOG.md` next to this file: one entry per sprint — the
goal, each agent's commitments, what was demoed at review, and the retro. It
is the record of what we learned, not a status board.

## Who comes to each ceremony

All standing agents: Gidi · Payments, Maya · Design, Liran · Dev, Nir · 3D,
Tom · Content. An agent with nothing in flight this sprint sits the sprint
out and says so at kickoff.
