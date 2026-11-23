# How the team runs: daily one-day sprints

Raz set this on 2026-11-23 (shortened from 3-day to one-day sprints the same
day, because the team ships in hours, not days). The PM conducts it; every
agent shows a **working demo on staging, tested — never slides or a
description**. The one rule above all: *evidence over activity*
(`docs/product/OPERATING.md`).

## The rhythm

- **A sprint is one day.** Every morning is a kickoff; every evening is a
  review. No multi-day counting.
- **Kickoff, every morning (~09:00 Israel).** The PM gathers each agent's state
  (shipped / blocked / next), unblocks what it can, runs money-check, picks
  **one money goal for the day**, and gives each agent **one outcome** — each
  naming the demo it will show that evening.
- **Review, every evening (~17:00 Israel).** Each agent delivers its demo; the
  PM checks each one is real before it reaches Raz.
- **Retro is not a daily ceremony.** The PM carries a process fix into the next
  morning's kickoff only when there is a real lesson, and logs it.

## What Raz gets — a demo video + a link, never text

Raz asked for this on 2026-11-23: **a short demo video + a link he can click,
not a written summary.**

**The video is a presentation, not a screen dump** (Raz's spec, 2026-11-23,
after a 50-second sped-up blur he could not follow):

- **Tom (content) makes the demo videos** — not the dev. He owns the format and
  a reusable template.
- **Max 25–30 seconds.**
- **Caption slide, then clip:** a full-screen text slide saying what you are
  about to see, then a **~5-second** screen recording of that step **at real
  speed**. Repeat per step.
- **Never sped up.** If a step runs longer than 5s, trim it — do not speed it
  up. He must be able to read and follow every moment.
- On-brand (Toy Box), clear, like a product explainer.

Each finished video goes to Raz with a staging link, sent straight to him. The
PM's own message to Raz is at most: a one-line "today's demos" header, the
**one** thing (if any) the PM needs from him with the ask on top, and the KPI
if known (paid heroes this week). No 5-line write-ups.

## What a "working demo" means (the gate)

A demo counts only if Raz could watch or click it himself:

- a **short demo video** of the real thing on staging (preferred), with
- a **staging link** on the real site to try, and/or
- a **green staging robot** run, or
- for a backend-only change, a **passing test** named plus the staging
  behaviour it proves.

A plan, a diff, "it should work", or a canvas mock is **not** a demo. An agent
with nothing working says so at the morning kickoff, never a surprise at the
evening review.

## Real-world milestones are tracked separately

Some things do not fit in a day because they move on bank / holiday / human
time, not agent time: Grow going live, a parent's consent, the Schneider pilot
(10 Dec), a real teacher actually paying, a toy sample shipping. These are
tracked on their own dates — not forced into a one-day sprint.

## Requests to Raz

Raz's role is to monitor, answer the PM, and unblock (payments, accounts,
approvals). **Every coordination request to Raz funnels through the PM**, who
keeps one prioritised list and surfaces at most the top one or two at a time —
never a flood. The exception is a finished **demo video**, which an agent sends
Raz directly (that is the deliverable he asked for). No agent sends Raz text
updates.

## The log

The PM keeps `SPRINT_LOG.md` next to this file: one short entry per day — the
goal, each agent's demo, and any retro line. It is the record of what we
learned, not a status board.

## Who comes to each day

All standing agents: Gidi · Payments, Maya · Design, Liran · Dev, Nir · 3D,
Tom · Content. An agent with nothing in flight that day says so at the morning
kickoff.
