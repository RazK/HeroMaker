# Hero Moves

A dance game for HeroMaker avatars. Your hero shows you a move, you copy it
with your webcam, and your hero copies you back.

The whole design follows from one fact about the asset: **a child draws the
front of the character and the pipeline extrapolates the back.** So the camera
lives in front of the hero and never leaves, and the choreography lives in the
frontal plane, where a 2D pose model can actually see it.

## Run it

```bash
npm install
npm run dev          # http://127.0.0.1:5182
npm run build        # dist/, multi-page
```

## How it fits together

| Piece | What it does |
|---|---|
| `src/pose/tracker.ts` | MoveNet SinglePose Lightning, loaded from memory so it works under a CSP that refuses every kind of fetch |
| `src/pose/solver.ts` | 2D keypoints to VRM bone rotations — the job Kalidokit does for Kalidoface, for a 2D model rather than a 3D one |
| `src/pose/moves.ts` | The move vocabulary, and the scorer |
| `src/game/game.ts` | Phase machine: countdown, coach, copy, grade, results |
| `src/stage/` | The set and the front-locked camera |

A move is **one canonical skeleton** and nothing else. That single
representation poses the coach through the solver, is the target the score is
measured against, and is what the test dancer interpolates between — so the
coach can never demonstrate a pose the scorer is not looking for.

## Harnesses

There is no webcam and no GPU in CI or in a sandbox, so everything is
measurable without either.

```bash
node tools/posecheck.mjs                  # what a perfect performance scores
node tools/contrast.mjs --phase=coach     # fails on text you cannot read
node tools/make-dancer-video.mjs /tmp/d   # render a stand-in performer
node tools/record-demo.mjs out.mp4 --video=/tmp/d/dancer.y4m --captions
node tools/trackrate.mjs                  # real inference throughput
```

`make-dancer-video.mjs` renders an avatar performing the game's own schedule
and encodes it to a `.y4m`. `record-demo.mjs` hands that file to Chromium as
the camera, so a recording exercises the real pipeline — getUserMedia, MoveNet,
solver, scoring — with no test-only path anywhere in it. Using an avatar as the
stand-in player is not a cheat, but it is not free either: see
`tools/posecheck.mjs` output per avatar, and the note in `games/PLAYBOOK.md`
about which heroes a pose model can and cannot read.

`--timescale` on the recorder runs the game clock slow and speeds the footage
back up by the same factor. It exists because a machine with no GPU runs
MoveNet near 1 fps, and a 2.4-second scoring window would otherwise contain
barely a sample. The HUD shows the real measured rate throughout, so a
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
