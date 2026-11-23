# Team design review — for Raz's approval

PM review, 2026-11-23, backed by research on how multi-agent dev teams are run
(sources at the end). Proposes org changes; **nothing changes until Raz approves.**

## Verdict

The **shape is right** — one orchestrator (PM) + specialists is the standard,
proven pattern (Anthropic's own multi-agent system). But we have three real
problems:
1. **The PM is a bottleneck** — every deliverable, review and hand-off routes
   through it.
2. **No one owns growth / acquisition** — the top of our one KPI's funnel.
3. **Verification is ad-hoc** — the PM is the sole checker (that is how the
   broken camera reached Raz: it was never used by a checker).

## How the best teams run (research)

- **Orchestrator–worker.** A lead plans, delegates to specialists, reviews
  **condensed results**, decides next steps. Workers don't talk to each other;
  routing is through the lead — which bottlenecks the lead if not relieved.
- **Essential roles:** lead, implementer, **reviewer/critic** (verification is
  what catches confidently-wrong output). Planner + tester near-essential.
  Designer, researcher, release-integrator, domain specialists (payments, 3D)
  are added only when a domain **recurs** with distinct tools.
- **Relieve the lead:** workers write bulky output to the **repo / shared docs**
  and pass the lead a **one-line reference** (PR link, doc section), never the
  full payload. (Anthropic's explicit bottleneck fix.)
- **Context:** subagents inherit nothing — every brief needs objective, output
  format, tools/sources, explicit boundaries, and the rules docs to obey. Vague
  briefs are the #1 cause of duplicated/misread work. Reviewers get **read-only**
  tools.
- **No merge races:** non-overlapping file/domain scopes; worktree isolation;
  a shared task list. Code isolation ≠ runtime isolation (ports, the two DBs).
- **Tiers + guardrails:** simple = 1 agent, comparison = 2–4, complex = more;
  cheaper models for research, stronger for review and payments logic.

## Our team vs that

| Role | Now | Issue |
|---|---|---|
| PM (orchestrator) | all routing, review, prioritisation, Raz interface | **overloaded** — coordination + judgment in one agent |
| Gidi · Payments + books | money path + bookkeeping | two jobs; fine for now |
| Maya · Design | screens, brand, the design gate | ok |
| Liran · Dev | builds; **owns staging releases** (new) | ok (release owner fixed the merge race) |
| Nir · 3D | the printed toy | **parked** — not on the path to the first paid hero |
| Tom · Content | ads + demo/presentation videos | ok |
| Compass (docs), Scout (PR review) | on-demand | reviewer should be **standing**, not on-demand |

## Recommendations (prioritised — each is a decision for Raz)

1. **Relieve the PM.** (a) Agents hand off via repo/PR + a one-line reference,
   not the full output through me. (b) **Give the PM a "chief of staff" agent**
   for the mechanical work — triage messages, assign non-overlapping scopes,
   run the merge queue, chase CI, run the 3× syncs. The PM keeps judgment:
   money-check, Raz-facing decisions, promotes.
2. **Add a Growth / Acquisition owner.** Owns the one promise from ad → share
   page, the landing/share experiments, and pilots → paid (Schneider 10 Dec, the
   first class). This is the biggest **capability** gap — the KPI depends on it.
3. **Make the reviewer (Scout) standing and read-only, and gate every merge on
   it.** Add the rule "a checker uses the real thing" so UX breaks like the
   camera are caught before Raz.
4. **A handoff-brief template** in `team-handoff` (objective, output format,
   tools/sources, boundaries, rules links). Cuts duplicated/misread work.
5. **Non-overlapping scopes + worktree isolation per sprint**; watch runtime/DB
   collisions. (The merge race is already fixed: Liran owns releases + #353.)
6. **Effort + model tiers** so the PM neither over- nor under-delegates; Haiku
   for research, stronger models for review and payments.
7. **Park Nir** until toy demand is shown; **watch Gidi** (payments + books) and
   split the books out if they grow.

## Are we still true to the operating kit (`OPERATING.md`)?

- **One KPI (paid heroes/week):** in words yes, but the team is weighted to
  build/design/polish and **no one drives acquisition** — so in practice we are
  **drifting** off the KPI. Rec 2 (Growth owner) is the fix.
- **Pilots before A/B:** Schneider 10 Dec is the plan — it needs the Growth
  owner to actually run it.
- **One promise, everywhere:** the family film delivers it. On track.
- **Weekly review:** scheduled and running. On track.

## Decisions for Raz

- [ ] Add a **Growth/Acquisition** agent.
- [ ] Add a PM **chief-of-staff** agent (or decide the PM stays solo and we only
      change the hand-off routing).
- [ ] Make **Scout** a standing, read-only reviewer that gates merges.
- [ ] **Park Nir** until toy demand.

## Sources

- Anthropic — How we built our multi-agent research system:
  https://www.anthropic.com/engineering/multi-agent-research-system
- Claude Code — Subagents: https://code.claude.com/docs/en/sub-agents
- Claude Agent SDK — Subagents:
  https://platform.claude.com/docs/en/agent-sdk/subagents
- Keeping context consistent across parallel agents:
  https://dev.to/jcamarate/keeping-context-and-decisions-consistent-across-parallel-ai-agents-32nj
- Git worktrees for parallel agents:
  https://www.augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution
