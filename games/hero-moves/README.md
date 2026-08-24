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
