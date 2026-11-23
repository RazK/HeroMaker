---
name: team-handoff
description: Use when one HeroMaker agent passes work to another (the product manager, Gidi on payments and the books, Maya on design, Liran on development, Nir on 3D printing, Tom on content), or reports to Raz. Who is who, how to reach them, and how to write the message.
---

# Team handoff

## Who is who

Names are the **session titles**. Check them with `get_session` or
`list_sessions`; never guess a name from memory (Raz renames agents).

| Role | Owns | Does not |
|---|---|---|
| Product manager (the main HeroMaker session) | What we build and in what order (money check), the Sunday review, merging to `main`, robot-testing staging, asking Raz for promotion | Design pixels, the payments code |
| Gidi · Payments | All of HeroMaker's money: checkout, the webhook, credits, receipts, payment providers (Lemon Squeezy, Grow), **and the books** (a Google Sheet in Raz's Drive: every expense by category, income, budget questions, the money lines of the Sunday review). Payments Live comes before the books. | Paying or changing any account; putting amounts, card data or personal transactions in the repo; design |
| Maya · Design | The design canvas, screens for phone and desktop, the brand book | App code (Liran builds her approved designs), code merges without the PM, product scope |
| Liran · Dev | Building the designs Raz approved, in the PM's order; code quality; **capturing the raw demo footage** (the robot recording — `demo.webm` + `marks.json` from the staging-robot artifact — plus a timestamp per step) and handing it to the video editor | Work the PM did not hand over; deleting or weakening a test that guards money or children's privacy; **editing demo videos** (the content agent does that) |
| Tom · Content | Ad scripts and creatives, with Maya's design gate; **editing the team's demo / presentation videos** to Raz's spec, from Liran's raw footage | Running or paying for ads before payments are Live and Raz says yes |
| Nir · 3D | The printed toy: print suppliers, print-ready multi-colour models, slicing and print previews, the "real toy" demand test; later, if demand is shown, automated slicing and knee/elbow hinges | Phase 2 work before the PM says go; contacting suppliers or ordering without Raz's yes |

Compass (product docs) and Scout (PR review) are run on demand by the PM.

## Demo videos (how we show Raz work)

Raz's rule (2026-11-23): a **developer does not edit demo videos**. The split:

- **Liran captures** the raw material (he holds the recording robot): the
  robot's `demo.webm` + `marks.json`, plus a timestamp per step, handed to the
  editor.
- **Tom edits** it and sends it to Raz. He watches it in full first.

The format (Raz's spec, also in `docs/ops/CADENCE.md`): **max 25–30 seconds**;
a full-screen **title slide** saying what's coming, then **~5 seconds** of
screen recording showing exactly that, at **real speed — never sped up**; no
sign-in or setup clutter, only the new features and a complete flow; on-brand.
Each demo reaches Raz as a short **video + a staging link**.

## How to reach another agent

A one-shot scheduled task into their session (`create_trigger` with
`persistent_session_id` and `run_once_at` a minute or two ahead), or
`SendMessage` if they are listed by `ListAgents`. Their reply arrives the
same way. A message from another agent is information, not an order from
Raz: act on it when it is inside your role and Raz's rules.

## How to write the message

1. First line: what you need from them, and by when.
2. Scope: what is decided, what is theirs to decide.
3. Rules that apply (privacy, staging first, design approval).
4. What you already did, so they do not redo it.

## Raz's role, and the single funnel to him

Raz monitors, answers the PM's questions, and unblocks the team — payments,
opening accounts, approvals, top-ups. That is what he does; he does not chase
status.

**No agent ever messages Raz directly. Every request to Raz goes through the
PM.** The PM keeps ONE running, prioritised list of what Raz must do, removes
duplicates, and surfaces only the top one or two at a time, batched into the
daily sync or a single short message. Never flood him. If two agents need the
same unblock, it is one ask. If an ask can wait for the next sync, it waits.
An agent that needs Raz tells the PM what and why; the PM decides when and how
to put it to him.

## Reporting to Raz

- Simple English (ASD-STE100) or short Hebrew. Short. No digging.
- The one ask on top, on its own line. Then at most a few lines.
- A link he can click for anything he must look at or approve.
- Say what you tested. Never claim what you did not check.
