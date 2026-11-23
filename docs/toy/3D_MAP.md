# The 3D code, in one page (Nir, 2026-11-23)

## Providers

- **Meshy is the only 3D generator** (`backend/app/services/meshy.py`, api.meshy.ai).
  - The pipeline calls image-to-3d with `pose_mode=t-pose`, `should_texture`,
    `should_remesh`, and no `ai_model` or `target_polycount`, so Meshy's defaults
    decide quality (`pipeline.py` `MESHY_3D_PARAMS`).
  - It then calls rigging on the image-to-3d task id, which gives `rigged.glb` and
    `walking.glb`.
  - 429 `NoMorePendingTasks` waits for a free slot; 402 means out of credits.
  - Remesh, retexture, animations and the `wait_for_task` helpers are dead code.
  - Requests and downloads have no HTTP timeout.
- **Hi3D** (`hi3d.py`, api.hitem3d.ai) only splits a character for the toy:
  - `model=character`, part a-f (6 down to 2 parts), joint ball, pin, dovetail or none, GLB.
  - It takes our own `model.glb` at any age, for $0.40 per split.
- **Meshy Auto Split** (`/openapi/v1/print/split`) only works within 3 days of
  making a hero, because Meshy then deletes the task. That is why the toy uses Hi3D.
- **There is no Tripo or Rodin client.** A Tripo model can only come in through
  the admin "install file" route (`api/admin.py`).

## Pipeline (`backend/app/config/steps.py`)

`image_processing` → `openai_render` → `meshy_3d` (model.glb) → `meshy_rig`
(rigged.glb, walking.glb) → `convert_vrm` (avatar.vrm, in Blender in
`vrm-converter-service/`, which maps 16 required and 6 optional bones = the "22
bones"). Credits are charged before each step and refunded on failure.

## The toy

- `print_split.py` holds the state in `print_split.json`, next to `split.glb` and
  `split.3mf`.
- `glb_to_3mf.py` makes the 3MF: geometry only, 120 mm tall.
- `parts_colours.py` removes Hi3D's flat label colours.
- `action_figure.py` is always Hi3D, 6 parts with ball joints, and sold for 5 credits
  only when `ACTION_FIGURE_FOR_SALE` is on.
- The frontend's `PartsViewer.tsx` and `partsSpread.ts` pull the parts apart along
  their joints.

## What I checked on a real split (Ruby Red, staging)

- 6 parts.
- Ball-to-socket gap is about 0.25 mm at the shoulders and hips, and about 0.7 mm at
  the neck.
- The parts are not closed solids. They are many open, overlapping shells, so they
  need repair before printing. As a 3MF, PrusaSlicer warned about an empty layer in
  one leg. As separate STLs, all six slice cleanly: 66 g, 9.6 h at 0.12 mm.

## Risks worth fixing

- Meshy has no timeouts.
- Step timeouts are not enforced in full-pipeline runs.
- The VRM converter blocks its event loop and never fails loudly.
- An expired Hi3D result URL (1 h) is unhandled.
- A GET of a toy can write files (the colour repair).
- The Hi3D failure text says "Meshy".
