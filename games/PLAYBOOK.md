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

**A pipeline whose end-to-end quality was never measured.** Hero Moves scored
players through solver, renderer, tracker and scorer, and every recorded run
came back OK or MISS. The natural reading was that the tracker was starved of
frames. It was not: a harness that posed an avatar into each move and pushed
one still frame through the real tracker and the real scorer showed a *perfect*
performance topping out at 0.59. The game could not be played well however well
you danced, and no amount of looking at recordings would have said so.

> **Rule: measure the ceiling of any scored or graded system in isolation.**
> Feed it a known-perfect input through the real code path and assert what it
> returns. A grading system that has never been shown a right answer is not
> known to have one.

**Two rules disagreed inside one number.** Animation dt was clamped to 0.1s so a
stalled frame could not fling the rig. The game clock was stepped by the same
value, so on a machine rendering at 3 fps the choreography ran at a tenth speed.

> **Rule: game time and animation time are different clocks.** Anything that
> decides *when* keeps wall-clock time; only what decides *how far* gets
> clamped.

**Contrast was assumed, never measured.** A cream heading on a cream card
renders without error, passes code review, and is only caught by someone
squinting at a phone — which is how it was caught. Worse, HUD text over a 3D
scene has no CSS background to inspect at all: white text was sitting on a
brightly lit stage floor.

> **Rule: check contrast programmatically, and give overlay text its own
> ground.** `hero-moves/tools/contrast.mjs` walks the live DOM, resolves what
> each text node is really painted over, folds in inherited opacity and fails
> below the AA ratio for its size. Text over a rendered scene cannot be checked
> that way, so it does not float — it sits on a plate.

**A scored system was built where a classified one would do.** Two prototypes in a
row asked 17 noisy 2D keypoints "how close is this pose to that pose" — a continuous
judgement, and the regime the tracker is worst in. The first topped out at 0.59 for a
known-perfect input. Asking instead "which of eight deliberately-separated poses is
this" reads correctly on every frame, and its ceiling can be proved with a one-frame
harness rather than hoped for.

> **Rule: prefer a label to a percentage.** A label survives jitter that a score does
> not, and a confusion matrix is a cheaper and more honest instrument than a
> distribution of near-misses. Reach for continuous scoring only when the thing being
> measured is genuinely continuous.

**Thresholds were guessed and silently threw the right answers away.** The first
accept guards on the classifier rejected 90% of the frames it had *correctly*
labelled. A system that is perfectly accurate and permanently unsure is exactly as
broken as one that is wrong, and it fails in a way no accuracy metric shows.

> **Rule: measure the thresholds, do not pick them.** Run the harness, take the
> distribution of the right answers, and set the guard from it — then report the
> accept rate alongside the accuracy, because either alone is misleading.

**The camera turned out to be the wrong axis, and it took market evidence rather than
engineering to see it.** Three unrelated measurements agree: the shipping
"webcam drives your avatar" product peaks at ~1,000 concurrent and is declining; the
one company that instrumented this exact configuration measured a phone as 10x worse
than a TV for retention and abandoned it; and the largest camera-free precedent for
this asset took 6.7M uploads on four animation clips and no game at all.

> **Rule: check whether the input device is the product before optimising it.** Two
> prototypes were spent making pose tracking good. Nobody had asked whether being
> tracked is what anyone wants, and the answer was available in an afternoon.

## The asset's own constraints — established, do not re-derive

* VRM 0.0, **22 humanoid bones**, hips through toes including shoulders. **No
  fingers. No blendshapes, so no facial expression and no lip sync.**
* Height normalised to **1.7 m**, feet near y=0, rest pose is a **T-pose**.
* Proportions vary enormously: a hero can be 30% head, or a five-pointed star
  with two legs, or a cloud. **Anything tuned to human proportions breaks on
  half the roster; rotation-only poses on the normalized rig work on all of it.**
* Some avatars need grounding — their bounding box does not start at y=0.
* **Some heroes are wider than they are tall.** Solving camera distance from
  height alone puts a cloud's arms off both edges of the frame.
* **Animation clips work, and the standard is not where the content is.** `.vrma`
  (VRM Animation 1.0, `VRMC_vrm_animation`) is the format the VRM consortium defines
  and `@pixiv/three-vrm-animation` plays it on a VRM 0.0 hero with **zero
  retargeting**. But free `.vrma` is scarce; the volume lives in CC0 glTF libraries —
  Quaternius' Universal Animation Library (250+) and the CMU mocap database (2,543) —
  which need a rig map. **The retarget is rotation-only and therefore
  proportion-blind: a mocap backflip lands correctly on a hero whose head is a third
  of its height.** Two licence traps: Ready Player Me's library forbids use with any
  non-RPM avatar, and AMASS/SMPL sets are non-commercial only.
* **Solve the camera against the clip, not the rest pose.** Distance solved from a
  hero's standing height puts a backflip off the top of the frame. Anything that
  leaves the ground needs the camera eased back *before* it starts.
* **A pose model reads these avatars unevenly.** MoveNet places shoulders,
  hips, knees and wrists well on them, but elbows badly — smooth sausage arms
  have no crease to find. A hand held against a big head or a mass of hair is
  lost entirely. Measured per avatar by `hero-moves/tools/posecheck.mjs`: a
  clean humanoid hero reads at 0.93, one with a lot of hair at 0.76, a cartoon
  skeleton and a cloud not at all. This matters for anything that tracks an
  *avatar*; a human player in front of a webcam is the case the model was
  trained for.
* The **front is drawn by a child; the back is extrapolated by the pipeline.**
  Frame the front.
* Raw exports are ~5.5 MB, of which ~1.46 MB is a VRM metadata thumbnail that
  nothing renders. `scripts/optimize_vrm.py` takes them to ~1.2 MB with no
  visible loss, and makes the texture survive a strict CSP.

## Reading a 2D tracker — established by confusion matrix, do not re-derive

Measured with `hero-moves/tools/posegate.mjs` on a production avatar, five camera
distances and angles per pose. These are properties of the tracker, not of a
particular vocabulary, and they will hold for the next game too.

* **Out-versus-down on the same arm is not a usable distinction.** An arm hanging
  beside the torso and an arm held horizontally are separated by less than the
  tracker's error once the wrist is near the body. Measured at **0%** — every frame
  read as the other pose. **Up-versus-anything is reliable.** Build asymmetric poses
  by raising an arm, never by lowering one.
* **A wrist resting on a hip is the same point as a wrist hanging beside one.**
  HANDS ON HIPS measured **13%** against ARMS DOWN and is not separable however the
  classifier is tuned.
* **A hand held near the head is lost.** Narrowing ARMS UP from a 62/118 V to 75/105
  moved the hands into the hair and dropped it from 100% to 40%.
* **Elbows are the worst joint on these avatars** — 0.25-0.66 confidence against
  0.6-0.8 for shoulders and wrists, and placed far too close to the shoulder, because
  a smooth sausage arm has no crease to find. Never build a feature on one.

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
