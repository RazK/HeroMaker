# Building a game on the HeroMaker pipeline — what worked

Distilled from building Hero Dash end to end: a complete, playable game that
turned out to be the wrong game. The process converged fast and the corrections
landed cleanly; the concept was never tested as hard as the code was. Both
halves of that are worth keeping.

## What worked, and why

**Retire the scariest unknown before writing product code.** The first thing
built was a throwaway page that loaded a real production VRM headless and
screenshotted it. Ten minutes, and "does this even work" was answered with a
picture: 22/22 humanoid bones, spring bones, correct render. Every later
decision rested on that instead of on hope.

**Use real data from the first minute.** Thirty real avatars were pulled from
the live gallery and rendered as a contact sheet to pick six. Nothing was a
placeholder, so nothing changed appearance when it got real — and the roster
surfaced facts a placeholder never would, like heroes whose feet sit above y=0
and heroes who are 30% head.

**Build the inspection tool, not just the thing.** A "pose lab" page rendered
every animation state onto one contact sheet from three angles. It caught an
inverted rotation axis in a single screenshot — a bug that would have taken ten
play sessions to characterise by eye. This was the highest-leverage hour in the
project.

**Turn every reported bug into a harness, not just a fix.** Controls felt
mirrored, so `lanetest.mjs` now projects the hero into screen space and prints
which way each input moves them. The menu was cropped, so `fitcheck.mjs` reports
card overflow in pixels at seven viewport sizes. Loading was a blank page, so
`loadtest.mjs` throttles the connection and screenshots the boot. Each one
converts "looks right to me" into a number that fails loudly.

**Reproduce the deployment environment, not an approximation of it.** Two
user-visible failures came from testing somewhere easier than production: a
plain static server with no CSP, and a portrait viewport far taller than the one
the artifact viewer actually grants. `csp-server.mjs` and the viewport matrix in
`fitcheck.mjs` exist because of those.

**Look at the output constantly.** Nearly every real bug — the avatar stuck in
T-pose, the road z-fighting away at distance, the camera trapped inside a wall,
the hero invisible on the score screen — was found by taking a screenshot and
looking at it, not by reasoning about the code.

**Close each loop with something playable plus evidence,** and say plainly what
has not been verified. A link and screenshots each round kept the corrections
cheap and specific.

**Fix the class, not the instance.** When the packer silently shipped an
unstyled page, the fix was the missing regex *and* an assertion that fails the
build if the stylesheet is ever missing again.

## What went wrong, and the rules it leaves behind

**The concept was never tested as hard as the code.** Technical feasibility was
proven on day one; whether the game *showcased the asset* was never put in front
of anyone until the whole thing was built. A single early screenshot captioned
"this is what the player looks at for 90% of the game" would have ended the
runner idea immediately.

> **Rule: validate the core visual before building around it.** Before any
> gameplay code, produce a still of the actual play camera framing a real avatar
> and check it against the pitch. If the answer is not obviously yes, change the
> concept — not the lighting.

**A risk that was written down was mitigated instead of obeyed.** Hero Dash's
own brief says: *"a plain runner shows you the back of a character's head, which
wastes the asset."* That was correct, and the response was pose gates and a
camera that swings round during a power-up — decoration on top of a wrong
default, rather than a different default.

> **Rule: a risk you can name in one sentence is a decision, not a to-do.** If
> the genre fights the asset by default, no amount of set dressing changes the
> ratio. Re-decide, or raise it before building.

**Production conditions were discovered by shipping.** Both the CSP failure and
the cropped menu reached a real device first.

> **Rule: build the environment simulator before the first publish, not after
> the first bug report.**

**Interface polish was a late, separate round.** Spacing, alignment and visual
maturity were treated as finishing rather than as part of "done", so an
unfinished-looking build got shown.

> **Rule: nothing gets shown until it has had a deliberate design pass.** Judge
> it as a senior designer would: consistent rhythm, one spacing system, aligned
> optical edges, no orphaned controls, no default-looking anything.

## The asset's own constraints — established, do not re-derive

* VRM 0.0, **22 humanoid bones**, hips through toes including shoulders. **No
  fingers. No blendshapes, so no facial expression and no lip sync.**
* Height normalised to **1.7 m**, feet near y=0, rest pose is a **T-pose**.
* Proportions vary enormously: a hero can be 30% head, or a five-pointed star
  with two legs, or a cloud. **Anything tuned to human proportions breaks on
  half the roster; rotation-only poses on the normalized rig work on all of it.**
* Some avatars need grounding — their bounding box does not start at y=0.
* The **front is drawn by a child; the back is extrapolated by the pipeline.**
  Frame the front.
* Raw exports are ~5.5 MB. `hero-dash/tools/optimize_vrm.py` takes them to
  ~1.2 MB with no visible loss, and makes the texture survive a strict CSP.

## Publishing constraints — established, do not re-derive

* A published artifact runs under a CSP that refuses `fetch()` to `data:` and
  may refuse `blob:`. `hero-dash/src/avatar/loader.ts` documents both traps and
  the way past them.
* The artifact viewer adds chrome: a phone reporting 385x835 hands the page
  roughly **385x560**. Test there.
* A module script is deferred until the whole document has parsed. Shipping the
  engine as a classic script lets it boot mid-parse, which is the difference
  between playable at 2.6 MB and playable at 10 MB.
* Only Google Fonts is reachable. Everything else must be inlined.
