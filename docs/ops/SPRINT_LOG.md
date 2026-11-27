# Sprint log

One entry per 3-day sprint (`CADENCE.md`). Newest first. The PM writes it.

## Format

```
## Sprint N — <start date> to <end date>
- Goal: <one money-focused outcome>
- Commitments: <agent>: <1-3 outcomes, each with the demo it will show>
- Review: <per agent: committed vs delivered, with the working demo>
- Retro: keep <x>; stop <y>; change <one process fix for next sprint>
```

## Log

## Day sprint — 2026-11-27

- **Goal:** hold discipline while the money goal is Raz-gated — advance only
  genuinely-unblocked, KPI-relevant work; do not spin the team on guesses.
- **Delivered on staging (green, robot runs 159–160, v2.0.266–267):** the Schneider
  Dec-10 pilot plan folded into docs/product/pilots/P-001 with privacy and
  consent as the first rule (#388), with a real-staging DEMO of the class flow
  through the pay-for-seats money moment (teacher -> pay 100 shekels for 10
  seats -> projected join code -> a kid joins with no account -> hero live);
  PRINCIPLES rule 21 now records the landing exception from #382 (#389). Both
  docs-only; the demo is backed by the green robot on the same build.
- **Held (no speculative builds):** Maya (ad + studio approval), Tom (ad
  direction), Gidi (go-live), Nir (parked) — all waiting on Raz.
- **Blocked on Raz only:** the 3 go-live steps; the ad direction; the
  studio-redesign approval; the pilot's dated calls (Hebrew screens 30 Nov,
  provider top-up 7 Dec, payments-Live-before-10-Dec).
- **KPI:** 0 paid heroes this week — payments not yet live on production.
- **Retro — keep:** restraint held — one real outcome was assignable, one was
  assigned, and it shipped. **Change:** verify drift against the agent, not a
  stale status flag — a get_session `unpushed_work` flag mis-flagged Maya's
  branch; she corrected it in one line. Trust the agent's live word over the
  cached summary.

## Day sprint — 2026-11-26

- **Goal:** keep the money goal moving while it is Raz-gated — make the product
  and funnel launch-ready for the first real payment.
- **Delivered on staging (green, robot runs 155–156, v2.0.264):** load-time wins
  (slim mocap clips #383, 9 KB logo #384, 5.8 KB favicon #385 — gallery −21%,
  hero −27% bytes); the go-live runbook + a strictly read-only check script
  (#386, docs/launch/GO_LIVE.md); the landing phone buttons flipped so Make a
  hero leads (#382, Raz's call). Plus, for review (not shipped): the launch +
  acquisition plan with a real funnel walk (Noa) and the real-footage ad reel
  (real speed, no AI people — Tom). Each shown to Raz as a video + link, verified
  by the PM.
- **Blocked on Raz only:** the 3 go-live steps (Grow registration + credentials +
  Stability); the ad direction; the studio-redesign approval.
- **KPI:** 0 paid heroes this week — payments not yet live on production.
- **Retro — keep:** honest measurement held (held the CPU-contaminated hero-load
  time and captioned the hero "1 MB less, not faster"; the robot asserts the real
  Grow path, not a mislabel). **Change:** every 3D screen-recording must PAUSE the
  page clock (~34 ms/frame) or it plays ~22× too fast — sped-up dance/game clips
  reached the ad Raz saw and read as "awful". Carry to tomorrow: a real-speed
  check on every motion capture before it is shown.

## Day sprint — 2026-11-25

- **Goal:** the first *real* paid hero — the real Grow connection proven on
  staging, ready for the first live payment.
- **Delivered on staging (green, robot runs 149–151, v2.0.258):** the real Grow
  payment provider end to end against a staging stand-in (build #375; notify
  hardening #376/#378 — token in the URL path not the query, multipart notify
  proven; the robot records and asserts the real Grow code path #379;
  deploy-race guard #380; toy-flake fix #381). Every money step runs the REAL
  Grow code, not grow_sandbox. Also: the brand-film 15s ad (redone from scratch
  — real app screens, CC0 music) and the studio-view redesign (one carousel
  spine, no chapter cards, no filler); 8 one-hour team seminars, each a ≤20s
  video. Each shown to Raz as a video + link, verified by the PM.
- **Blocked on Raz only:** G3 (Grow's own sandbox once Grow issues our IDs) +
  G4 (prod vars + one real ₪10 + refund); the ad approval; the AI-label choice.
- **KPI:** 0 paid heroes this week — payments not yet live on production.
- **Retro — keep:** show-don't-tell held (every demo a PM-verified video +
  link). **Change:** a provider/integration demo must ASSERT which code path it
  ran — the robot once mislabelled the Grow stand-in as "grow_sandbox"; now it
  records the checkout page and fails if it is not the real path (#379). And a
  "robot-only" test fix must be hand-verified not to MASK a real break — the
  first Take-apart fix would have hidden a false negative; a human tap on
  staging caught it. Carry both to tomorrow: assert-the-path + eyeball-the-feature.

## Day sprint — 2026-11-24

- **Goal:** the first paid hero — payments live. Move 0 → 1.
- **Delivered on staging (green, robot run 140):** money moment #1 — the "Bring
  it to life" pay pop-up + the real money path (pop-up → TEST checkout → signed
  webhook → the same hero resumes to 3D → receipt); the new camera; 4 UI polish
  fixes (equal buttons, sticky = Make a hero, no "Heroes kids made" title,
  stripped New hero sheet). Each shown to Raz as a video + staging link,
  verified by the PM.
- **Blocked on Raz only:** the 6 Grow go-live steps (real money on production).
- **KPI:** 0 paid heroes this week — payments not yet live on production.
- **Retro — keep:** show, don't tell (video + staging link, verified by the PM
  before showing). **Change:** map a goal's hard dependencies INTO the sprint —
  the pay pop-up was first mis-triaged to the backlog while "first paid hero"
  was the goal, and Raz caught it. When setting a goal, list what it cannot
  ship without and keep those in-sprint.

## Sprint 1 — 2026-11-23 (last 3-day sprint; cadence moved to one-day mid-day)

- **Goal:** The sister's money path, proven on staging — first painting free → pay ₪10 to bring the hero to life (or ₪10/seat, min 10, for a class) → receipt. So the moment Raz finishes the real Grow setup, a teacher can pay for real.
- **Commitments** (each shows a working staging demo at the day-2 review):
  - **Gidi (Payments):** (1) FREE_PAINTING on in staging, pay-after-the-reveal proven on the real `pipeline.execute_step` path (0 credits → free painting → NOT_ENOUGH_CREDITS pause → buy ₪10 in Grow sandbox → finish); (2) the sister's Grow + Morning do-list for Raz (only the steps he must do). Demo: a staging run/link of that flow.
  - **Liran (Dev):** (1) the share→make→pay funnel green on staging, robot kept green; (2) build Maya's "Bring it to life" screen + wire the toy fake-door event (`toy_ship_tapped`). Demo: a staging link where a shared hero link → make → pay works, green robot.
  - **Maya (Design):** (1) Raz's approval on the ready screens, built on staging with Liran; (2) design the "Bring it to life" pay-after-the-reveal screen + the toy fake-door. Demo: approved screens live on staging; the two designs sent to Raz.
  - **Nir (3D):** (1) the toy cost→price table in `docs/toy/` (per method: cost, time, price for ≥50% margin); (2) after Raz's 3 cast picks + copy-yes, the 3 cast heroes dancing/flipping on staging. Demo: the table; the 3 heroes on a staging link.
  - **Tom (Content):** the family film first full cut on the pages build (free HF quota), one money moment + one CTA. Demo: the film playing at razk.github.io/HeroMaker.
- **Context at kickoff:** staging green end to end (money path in Grow sandbox, make-a-hero, hero page). Shipped since the previous day: security guard for the leaked debug admin (#317), apostrophe fix (#320), shekel prices (#319), first-painting view ~70× faster (#328), dead-code/binary cleanup (#301–#308, #315, #330, #331), children's names off the public README (#327), robot-on-every-deploy (#310), two robot fixes for the new hero-page layout (#326, #332).
- **Review (2026-11-23):** the goal was hit on day 0.
  - **Gidi** — ✅ pay-after-the-reveal proven on staging (FREE_PAINTING on; real `execute_step` run + test #339); Grow+Morning do-list delivered to Raz.
  - **Liran** — ✅ the whole money path green on the CI robot end to end (run #112: 0 credits → free painting → pause → pay ₪10 + ₪39 → hero ready → class seats ₪100); all reliability/CI fixes merged; first-painting view ~70× faster.
  - **Nir** — ✅ toy cost→price table (`docs/toy/COST.md`; 7 cm full-colour = the product, ~₪149–186 at 50% margin); Elad's clean sample cast + the kid-photo shortlist; sent Raz the picture.
  - **Maya** — in progress: screens for Raz's approval; the "Bring it to life" screen.
  - **Tom** — family film in progress; now owns demo videos (remaking the money-path one to Raz's presentation spec).
  - Demo to Raz: the money-path presentation video (Tom) + staging link.
- **Retro:** keep — merge-green-PRs + robot-on-every-deploy kept staging shippable all day, and the team hit a 3-day goal by lunch. stop — a dev hand-cutting a sped-up 50 s demo video (unwatchable). change — (1) sprints are now **one day** (the team laps a 3-day plan); (2) demo videos are **presentation-style and Tom owns them** (CADENCE.md, #344).

> Open on Raz's side: 3 cast picks (Elad's 4) + Elad's one-line OK; the real-Grow setup for the first live paid class.
