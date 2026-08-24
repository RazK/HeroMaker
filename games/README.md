# games/

Playable experiences built on top of the HeroMaker pipeline's rigged VRM output.

| Game | Status | Why |
|---|---|---|
| [`hero-dash/`](./hero-dash) | **Parked** — complete and playable, not the direction | An endless runner. The chase camera shows the back of the avatar almost all the time, and the back is the part the pipeline invents. See below. |

## Why Hero Dash is parked

It works, it is fun, and it is finished — the reason it is not the direction has
nothing to do with its quality.

A HeroMaker avatar is generated from a drawing a kid made of the **front** of a
character: the face, the emblem on the chest, the colours they chose. The back
is the pipeline's own extrapolation. An endless runner puts the camera behind
the player, so the thing on screen for almost the whole run is the half of the
model nobody drew. It is a showcase that hides the thing being showcased.

This was flagged as a risk in [`hero-dash/BRIEF.md`](./hero-dash/BRIEF.md) and
then mitigated — front-facing pose gates, a camera that swings around during
Hero Time — rather than treated as disqualifying. Mitigation was the wrong call:
if the genre points the camera the wrong way by default, no amount of set
dressing fixes the ratio.

**The rule this leaves behind: the player must be looking at the avatar's face
for most of the play time. Validate that with a screenshot before building
anything else.**

## What to reuse rather than rewrite

Hero Dash is kept because most of it is not about running:

| Piece | What it does |
|---|---|
| `scripts/optimize_vrm.py` | 5.5 MB pipeline VRM → ~1.2 MB, no visible loss. Also makes the texture load under a strict CSP. |
| `hero-dash/src/avatar/loader.ts` | Loads a VRM from a URL or an inlined `data:` URI, grounds it, adds a drawn outline, and dodges the CSP traps. |
| `hero-dash/src/avatar/rig.ts`, `poses.ts`, `animator.ts` | Rotation-only procedural animation on the normalized humanoid rig — the reason one pose library reads correctly on a superhero, a bear, a star and a cloud. The axis conventions are documented at the top of `poses.ts` and were expensive to work out. |
| `hero-dash/src/core/heroCam.ts` | Webcam body tracking with no downloaded model: learns the empty room, then reads the player's silhouette. Works offline and inside the artifact sandbox. |
| `hero-dash/tools/*.mjs` | The harnesses: headless play bot, per-state showcase capture, artifact-CSP server, throttled load test, layout fit checker, control-mirroring check, synthetic webcam video. |

Read `hero-dash/README.md` before starting a new game here — the sections on
publishing under the Artifact CSP and on testing layout at real viewport heights
are hard-won and apply to anything published the same way.
