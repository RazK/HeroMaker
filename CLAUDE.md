# Claude Instructions for HeroMaker

## Git & PR Rules

- **One PR per logical unit.** Even if given a list of tasks, work on them one at a time — separate branch, separate PR per topic (e.g. bug fixes, docs, new features are never mixed).
- Finish and open a PR for the current topic before starting the next one.

## Python / Venv

- **Always use the project venv**, never bare `python` or `python3`.
- Venv lives at `.venv/` in the project root (worktrees have a symlink pointing to main repo `.venv`).
- Run Python scripts as: `.venv/bin/python <script>`
- Run pip as: `.venv/bin/pip`

## Shared tooling

### `scripts/optimize_vrm.py` — shrink a pipeline VRM ~5.5x, losslessly to the eye

Use this before serving, embedding or previewing any avatar the pipeline
produced. Measured over 30 production avatars, **every single one** wastes
**~1.46 MB (21% of the file) on a VRM metadata thumbnail that nothing ever
renders**, and ships its texture as a ~2.5 MB PNG that re-encodes to ~110 KB of
WebP with no visible difference.

```bash
.venv/bin/python scripts/optimize_vrm.py in.vrm out.vrm [--size=1024] [--quality=88]
# typical: 5.5 MB -> 1.2 MB, verified visually identical
```

What it does, all reversible by re-running the pipeline:
- drops the unused VRM meta thumbnail
- re-encodes the avatar texture as WebP at a sane resolution
- packs indices/joints/weights to the smallest glTF **core spec** types — no
  extensions, so every loader still reads the result
- inlines the texture as a `data:` URI, which also makes it load under a strict
  CSP where a `blob:` URL would be refused

### `scripts/optimize_vrma.py` — halve a downloaded animation clip

The pipeline maps 22 humanoid bones. A `.vrma` from the wild animates whatever
its author rigged — typically 51 bones, **30 of them fingers we do not have**.
Every one of those channels is decoded, sampled and interpolated onto joints
that do not exist, and downloaded first.

```bash
.venv/bin/python scripts/optimize_vrma.py in.vrma out.vrma   # 118 KB -> 53 KB, 56% smaller
.venv/bin/python scripts/optimize_vrma.py in.vrma --check    # report, write nothing
```

Measured on the sample pack and verified by playing the result back: identical
motion, 56% fewer bytes. Keyframe values, interpolation and timing are
untouched. It is the dead-thumbnail finding one asset type over.

**If you are working on preview/gallery/thumbnail load times, start here** — the
dead-thumbnail finding is a pipeline bug worth fixing at the source
(`vrm-converter-service/`), which would shrink every avatar for every consumer
at once.

## Games

`games/` holds playable experiences built on the pipeline's output. Read
`games/PLAYBOOK.md` before building one — it records the asset's constraints
(22 bones, no fingers, no blendshapes, wildly varying proportions), the
publishing constraints, what a 2D pose tracker can and cannot read on these
avatars, and the process rules that came out of building them. `games/hero-dash`
is parked; `games/README.md` says why and lists what to reuse from it.

### Two capabilities worth knowing about before you build anything

**Any humanoid animation can be played on any hero.** `games/hero-moves/src/anim/`
loads `.vrma` natively and retargets CC0 glTF mocap (Quaternius, CMU) onto the VRM
humanoid. The transform is rotation-only and therefore **proportion-blind** — a
mocap backflip lands correctly on a hero whose head is a third of its height, and
on a cloud with legs. `animlab.html` demos it. **If you are adding motion to
anything — the gallery, a preview, a loading screen — start here rather than
hand-authoring poses.**

**Pose classification is solved; pose scoring is not.** `src/pose/vocab.ts` names
which of eight poses a person is making, measured at 100% across five camera angles
with `tools/posegate.mjs`. The older `scorePose` answers "how close are these two
poses" and tops out much lower. Prefer the classifier.

Live builds: <https://razk.github.io/HeroMaker/hero-moves/> and the camera-free
prototype at <https://razk.github.io/HeroMaker/hero-moves/reel.html>, published
from `staging` by `.github/workflows/pages.yml`.

## Architecture: Local vs Production

| Service       | Local                              | Production (Railway)     |
|---------------|------------------------------------|--------------------------|
| Backend       | Native Python via `.venv`, port 8000 | Docker container        |
| Frontend      | Native `npm run dev`, port 5173    | Docker container (nginx) |
| VRM Converter | Docker container, port 8001        | Docker container         |

- **`start-dev.sh`** is the single command to start everything locally.
- **`docker-compose.yml`** is for production-like full-stack testing only — not used for daily dev.
- Railway deploys from `backend/Dockerfile`, `frontend/Dockerfile`, `vrm-converter-service/Dockerfile`.
