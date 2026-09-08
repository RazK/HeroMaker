# Hero Moves

A party dance game for HeroMaker avatars. One to three players stand side by
side, each picks a hero, and a timeline tells everyone what is coming. Each
hero mirrors its own player. Highest score wins.

The whole design follows from one fact about the asset: **a child draws the
front of the character and the pipeline extrapolates the back.** So the camera
lives in front of the heroes and never leaves, and the choreography lives in
the frontal plane, where a 2D pose model can actually see it.

## What the first version got wrong

It had two characters on stage: one demonstrating the move and one mirroring
the player. Playtested in one sentence: *"am I supposed to imitate the
character, or is the character imitating me?"* Two bodies doing two different
jobs, with only a label to tell them apart, reads as a race condition.

There is now exactly **one role on stage** — every hero belongs to a player and
mirrors that player, always — and the routine is explained by the timeline
instead of by a performance. Nothing on screen is ambiguous about whose it is,
so nothing has to be explained.

## Three players out of a one-person model

MoveNet Lightning finds one body. MoveNet MultiPose finds six, and was measured
at **9.45 MB of weights against Lightning's 4.65** — on a phone-first game
that is the whole download budget again, for a worse result, because at
three-player distance each body already occupies a third of a frame the model
resizes to 192x192 square regardless.

So players stand in **lanes**, and each lane is cropped and inferred
separately, one lane per frame, round robin. That costs one inference per
player and buys three things: no extra download, a subject that fills its crop,
and **player identity for free** — a lane cannot be mistaken for another lane,
so nobody's score is ever handed to the wrong hero, and the same person keeps
the same character for the whole game without anyone being recognised.

Two things about that crop, both measured rather than reasoned:

* **It is square, and it holds one person.** The model input is 192x192 and the
  vocabulary was measured at 100% on square frames with one body filling them. A
  full-height lane strip letterboxes into that square — a quarter of the input
  becomes black bars — and, with players standing shoulder to shoulder, contains
  two or three bodies, which a model that returns exactly one skeleton answers
  with a blend of them. Measured that way: wrists at 0.11-0.6 confidence and not
  one frame the classifier would name.
* **It follows the torso, not the pose.** Cropping the next frame around the
  keypoints the last one found collapses in about a second — a crop that clipped
  an arm reports a narrower body, which fits a narrower window, which clips
  more. Shoulders and hips do not move when an arm goes up, so the window is a
  fixed multiple of them.

The first look at a lane is still wide, because an arm held out is wider than a
third of a frame and cutting at the lane edge does not lose a wrist — MoveNet
*invents* one there, which turns a clean T-pose into a shrug.

## Run it

```bash
npm install
npm run dev          # http://127.0.0.1:5182
npm run build        # dist/, multi-page
```

## Two builds live here

| Page | What it is |
|---|---|
| `index.html` | **Hero Moves** — the webcam party game. One to three players, one hero and one lane each, scored on shape and timing. |
| `reel.html` | **Hero Stunt Reel** — a camera-free prototype. Pick clips, arrange a routine, watch your hero perform it, discover combos. |
| `animlab.html` | Retargeted animation clips playing on any hero, with their sources. |

The reel exists because the market evidence points away from the webcam: the
shipping "webcam drives your avatar" product peaks near a thousand concurrent
users and is declining, the one company that instrumented this exact
configuration measured a phone as 10x worse than a TV for retention and left it,
and the largest camera-free precedent for this asset took 6.7M uploads on four
animation clips and no game at all. See `games/PLAYBOOK.md`.

## Animation

`src/anim/` plays full-body humanoid clips on any hero.

* `.vrma` (VRM Animation 1.0) loads natively — **no retargeting**, even on our
  VRM 0.0 avatars, because the loader handles the version difference itself.
* Everything else — the large CC0 libraries that exist as glTF — goes through
  `retarget.ts`, which is **rotation-only and therefore proportion-blind**. A
  mocap backflip lands correctly on a hero whose head is a third of its height.
* `scripts/optimize_vrma.py` in the repo root strips a clip to the 22 bones we
  map. Measured: 118 KB to 53 KB, identical motion.

## How it fits together

| Piece | What it does |
|---|---|
| `src/pose/tracker.ts` | MoveNet SinglePose Lightning, loaded from memory so it works under a CSP that refuses every kind of fetch |
| `src/pose/solver.ts` | 2D keypoints to VRM bone rotations — the job Kalidokit does for Kalidoface, for a 2D model rather than a 3D one |
| `src/pose/vocab.ts` | The eight calls, and the classifier that names them — what a player is actually scored by |
| `src/pose/moves.ts` | The older continuous scorer, kept for the pose harnesses |
| `src/game/party.ts` | Phase machine: menu, countdown, dancing, paused, results — and per-player scoring |
| `src/game/song.ts` | The routine as a timeline, and what the strip shows |
| `src/stage/` | The set and the front-locked camera |

A call is **one canonical skeleton** and nothing else. That single
representation draws the strip's pictogram, is the shape the classifier is
matched against, and is what the stand-in dancers interpolate between — so the
strip can never show a pose the scorer is not looking for.

## What this borrows from Kalidoface, and what it cannot

`src/pose/solver.ts` does the same job Kalidokit does for Kalidoface: take
tracked landmarks, produce VRM humanoid bone rotations, ease them on. Three
differences are deliberate, and one was a plain omission.

* **Landmarks are filtered before they reach the rig** (`src/pose/smooth.ts`).
  Kalidoface's input is MediaPipe, which smooths inside its own graph; the tfjs
  `pose-detection` wrapper does the same with a one-euro filter. This project
  loads the bare MoveNet graph model to keep the download small and stay
  CSP-safe, which means none of that comes for free — and without it a
  perfectly still player's avatar shakes. That was the omission. Measured with
  `tools/jitter.mjs` on a still subject: wrist jitter down 22-33%.
* **Easing is frame-rate compensated.** Kalidokit's example slerps a fixed
  amount per frame, which is twice as fast at 60fps as at 30. Here the blend is
  solved from the frame's own dt, so the rig behaves the same on every device.
* **2D, not 3D.** Kalidoface uses MediaPipe's 3D world landmarks; MoveNet
  returns image-plane keypoints and cannot tell an arm reaching forward from one
  reaching back. That is why the whole choreography lives in the frontal plane.
* **No face, no fingers.** Kalidoface's best trick is blinking, mouth shapes and
  finger tracking. A HeroMaker avatar has 22 humanoid bones, no fingers and no
  blendshapes, so there is nothing to drive. This is an asset limit, not a
  shortcut.

Worth noting that Kalidokit itself marks `enableLegs` as work in progress —
the reference implementation is as wary of tracked legs as this one is.

## Sitting down

A webcam on a desk sees a torso and two arms; knees are under the table, and a
pose model does not report them missing, it reports a guess at the bottom edge
of the frame. So there is a seated mode, guessed from the camera in the lobby
over a couple of seconds and overridable on the preview itself.

It drops both leg *features* from the classifier and both leg *calls* from the
routine. The second matters as much as the first: STAR and ARMS UP differ only
below the waist, so a seated player asked for one would be judged against a
vocabulary that cannot tell them apart, and would lose either way.

## Scoring is a label, not a percentage

Asking 17 noisy 2D keypoints "how close is this pose to that pose" topped out at
0.59 for a *known-perfect* input, and 0.88 after two rounds of fixing. Asking
"which of these eight deliberately separated poses is this" reads correctly on
every frame, and its ceiling is provable with a one-frame harness rather than
hoped for. So the label decides whether a call counts at all, and only the
distance behind the label decides how well:

    right shape ? 0.62 + 0.38 x (how cleanly)  :  0
    x (0.7 + 0.3 x how promptly)

Wrong shape scores nothing, which is what makes a three-player scoreboard mean
something — a continuous scorer hands a player standing perfectly still most of
the marks for any pose that happens to be near neutral.

The classifier is built to say "I don't know" rather than guess, though, and it
says so more often than it is wrong: a hand lost in hair, a body at an angle, a
hero whose legs are half the length the vocabulary assumes. Scoring those frames
zero charges the classifier's caution to the player, so when there is no
confident label the older continuous scorer answers the easier question — how
close is this to the shape — and its answer is capped below what a named pose
can earn, because it is the weaker instrument.

`tools/lanegate.mjs` measures the first half of that in isolation: it asks the
page which camera frame each lane's answer came from, works out what the feed
was showing at that instant from the same seeded routine, and scores only that.
Sampling rate cannot flatter or damn it — a lane inferred once a minute is
judged on that one answer.

## Harnesses

There is no webcam and no GPU in CI or in a sandbox, so everything is
measurable without either.

```bash
node tools/posegate.mjs                   # confusion matrix for the pose classifier
node tools/posecheck.mjs                  # what a perfect performance scores
node tools/reelfit.mjs                    # does the reel fit at seven viewports
node tools/partyfit.mjs                   # does the party menu fit at seven viewports
node tools/clipframing.mjs out.png        # a clip in the real play framing
node tools/contrast.mjs --phase=results   # fails on text you cannot read
node tools/make-dancers-video.mjs /tmp/party --n=3 --scale=2
node tools/record-party.mjs out.mp4 --players=3 --pause --captions
node tools/make-demo.mjs out.mp4          # the whole walkthrough, desktop + phone
node tools/lanegate.mjs                   # is the right pose read from the right lane
node tools/jitter.mjs                     # how much the skeleton shakes when nobody moves
node tools/trackrate.mjs                  # real inference throughput
```

`make-dancers-video.mjs` renders one to three avatars standing side by side,
dancing a routine generated from a **given seed**, and encodes the result to a
`.y4m`. `record-party.mjs` hands that file to Chromium as the camera and starts
the same seed, so a recording exercises the real pipeline — getUserMedia,
MoveNet per lane, solver, scoring — with no test-only path anywhere in it.

The two clocks are lined up without guessing: the page records when camera
playback began, the feed's timeline is known, and the round is started at the
exact offset where the feed's first beat will land on the game's beat zero.

Using avatars as the stand-in players is not a cheat, but it is not free
either: see `tools/posecheck.mjs` output per avatar, and the note in
`games/PLAYBOOK.md` about which heroes a pose model can and cannot read.

`--timescale` on the recorder runs the game clock slow and speeds the footage
back up by the same factor; the feed is rendered with `--scale` set to its
reciprocal so the dancers slow down with it. It exists because a machine with
no GPU runs MoveNet near 1 fps *per lane*, and a 2.4-second scoring window
would otherwise contain barely a sample. The HUD shows the real measured rate throughout, so a
recording always says what it actually managed.

## The animation lab

`animlab.html` plays real, downloaded, full-body humanoid clips on a HeroMaker
avatar — the thing the nine hand-authored static poses were always a stand-in
for. Nothing in it is hand-animated.

```bash
node tools/fetch-animations.mjs                          # download + trim the clips
node tools/animshots.mjs /tmp/sheet "1.3,8.3,14.6,22.2"  # contact sheet, no video
node tools/make-animlab-video.mjs out.mp4                # 28s, four labelled clips
```

**The format is `.vrma`** — VRM Animation 1.0, a glTF file carrying the
`VRMC_vrm_animation` extension, loaded by `@pixiv/three-vrm-animation`, whose
version tracks `@pixiv/three-vrm` exactly (3.5.5 against 3.5.5). A `.vrma`
names VRM humanoid bones directly, so it binds to our avatars with no
retargeting at all — including the VRM 0.0 axis flip, which
`createVRMAnimationClip` applies itself.

Almost every free animation library, though, ships plain glTF or FBX on some
other rig. `src/anim/retarget.ts` is the bridge. It works because
`@pixiv/three-vrm` exposes a **normalized** humanoid whose rest state is a
T-pose with identity rotations, so a retarget is only ever "express the
source's rotation relative to its own rest, then hand that delta over":

    q_out = R_parentRestWorld · q_track · R_restWorld⁻¹

Three things that are not obvious until they bite:

- **VRM 0.0 needs the yaw conjugated.** `VRMUtils.rotateVRM0` spins
  `vrm.scene`, but the normalized rig stays in the model's own -Z-forward
  frame. Every quaternion needs `x` and `z` negated, and every translation
  likewise. Skip it and the hero performs backwards.
- **The hips translation track is in its parent's frame, not the world's.**
  Quaternius' rig hangs off a `root` node carrying the Z-up→Y-up quarter turn,
  so a straight copy drives the body backwards through the floor instead of
  upwards. Rotate the samples into world space first, then scale by
  `normalizedRestPose.hips.position.y / sourceHipsRestWorldY`.
- **Only the hips carry translation.** Every other bone's offset is the
  avatar's own skeleton, which is why a hero whose legs are half the length of
  the mocap actor's still lands on its feet: a retarget moves rotations only.

Missing bones are dropped rather than faked — our avatars have no fingers, so a
`.vrma` authored with 51 bones binds 22 of them and the hands stay open.

Where the clips came from, both reachable with no login:
`tools/fetch-animations.mjs` records the exact URLs.

| Clip | Source | Licence | Path |
|---|---|---|---|
| Jump | `tk256ailab/vrm-viewer` | MIT | `.vrma`, played natively |
| Dance Charleston, Backflip, Punch Cross | Quaternius Universal Animation Library, via `scottpetrovic/mesh2motion-app` | CC0 | glTF, retargeted |

Mixamo is the obvious fourth source and is *not* usable here: the site answers,
but every download goes through an Adobe login and `api/v1/products` returns
`403 "Api Key is required"` unauthenticated. Should a login ever be available,
`MIXAMO_RIG` in `src/anim/retarget.ts` already maps that rig.

## Backdrops

Six sets to dance in — Theatre, Deep Space, Forest Glade, Big Top, Coral Reef,
Rooftop Sunset. `src/stage/backdrops.ts` names them; `Stage` swaps them:

```ts
stage.setBackdrop('space')     // disposes the old one on the way out
stage.setQuality('lite')       // fewer particles, no rim lights, no shadow — no rebuild
stage.backdropId               // 'space'
BACKDROPS                      // [{ id, name, blurb }, ...] — theatre first, it is the default
```

**Nothing is downloaded and nothing is a bitmap.** Every sky, silhouette,
texture and sprite is painted onto a canvas at boot from code in
`src/stage/kit.ts`. That is not an aesthetic choice: the page runs under a CSP
that refuses `fetch()`, and it already carries a 4.65 MB pose model plus ~1.2 MB
per avatar. **Measured against the same build with the backdrop system removed:
+47.5 KB raw, +15.9 KB gzipped for all six themes plus the lab page** — against
a budget of 1 MB.

### The rules every theme obeys

* **Something dark sits behind the bodies.** The heroes own the middle ~70% of
  the frame and they are the point. Whatever the sky is doing, that band of
  world is a dark tree line, a dark skyline, a ring of spectators or open space —
  plus a soft scrim over it. Checked against Cloudy, who is white, and
  Superstar, who is yellow, at both viewports.
* **The floor is themed but never missing**, and it carries its own painted
  contact shade as well as the real shadow. The game drops shadow maps on a slow
  device (`degraded` in `src/main.ts`); without the painted shade, every hero
  would start floating at exactly the moment the device got slow.
* **The beat is visible.** `update(dt, phase)` gets the position within the
  current musical beat, and every theme spends it: footlights chase, the neon
  floor rim swells, festoon bulbs run, confetti puffs, caustics brighten.

### Three things that were only found by looking

* **A silhouette band tiles, or it is a wall.** Painting a tree line once around
  a cylinder of radius 7 makes each tree forty metres wide. `BandOpts.repeat` is
  solved per band so the tile's world size roughly matches the aspect of the
  canvas it was painted on — the difference between a forest and a green wall.
* **Painted stars arrive as grey squares.** A 1024-wide dome texture stretched
  over a 97 m circumference magnifies one texel to about six screen pixels. Deep
  Space paints no stars at all; every one of them is a point sprite.
* **The contrast scrim was painting a black ring on the floor.** It is a
  cylinder at radius 5.4 and the themed ground runs out to 11, so any alpha at
  its foot lands on the *distant floor*, not behind the bodies. Its gradient now
  starts above the horizon.

### Judging them without playing

`backdrops.html` puts a real avatar in the real play framing, with the game's
renderer settings, and nothing else:

```bash
npm run build && npx vite preview
# backdrops.html?bg=space&a=Cloudy    one hero, one theme
# backdrops.html?a=Cloudy,Superstar   a line of them
# backdrops.html?q=lite               the cheap path
# arrow keys cycle themes and heroes; window.__setBackdrop(id) does it from a harness

node tools/backdropshot.mjs /tmp/shots/bg                   # every theme x 3 heroes, desktop + phone
node tools/backdropshot.mjs /tmp/shots/bg --leak=1 --stats=1 # GPU objects and per-frame cost
```

`--leak=1` cycles all six themes three times and reads the renderer's own object
counts after each pass: steady at 15 geometries and 19 textures, so a player
flicking through the menu leaks nothing. `--stats=1` reports what a theme costs
per frame — **19-31 draw calls, and 0.08-0.28 ms of CPU in the backdrop's own
`update()`** (measured in software rendering, with no GPU, so a real device is
faster). `lite` cuts the particle count to 40%, drops the rim lights, the
shadow map and the flourishes, and takes the draw calls down to 14-20. It never
rebuilds a theme: the game degrades mid-round, on the one device that can least
afford a hitch, so the switch is a draw range and a visibility flag. Textures
are the exception — a theme only gets the smaller ones if it was *built* lite,
which is what `new Stage(id, 'lite')` and `backdrops.html?q=lite` do.
