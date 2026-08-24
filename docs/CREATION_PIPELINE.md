# What the creation view shows, stage by stage

The backend runs **five steps**. The creation view shows **three tiles**. This page
explains the mapping, because the two do not line up one-to-one and the difference
has caused confusion.

Source of truth for the steps: `backend/app/config/steps.py`.
Source of truth for the tiles: `buildStages()` in
`frontend/src/components/PipelineProgress.tsx`.

## The five backend steps

| # | `step_name` | Display name | Input | Output | Cost |
|---|---|---|---|---|---|
| 1 | `image_processing` | Image Processing | `original.jpg` | `processed.jpg` | 0 |
| 2 | `openai_render` | AI Rendering | `processed.jpg` | `rendered.png` | 2 |
| 3 | `meshy_3d` | 3D Modeling | `rendered.png` | `model.glb` | 5 |
| 4 | `meshy_rig` | Rigging & Animation | `model.glb` | `rigged.glb` | 2 |
| 5 | `convert_vrm` | VRM Conversion | `rigged.glb` | `avatar.vrm` | 1 |

Total: 10 credits.

## The three tiles

| Tile | Label | Backend steps behind it |
|---|---|---|
| 1 | The Drawing | `image_processing` |
| 2 | AI Rendering | `openai_render` |
| 3 | 3D Hero | `meshy_3d` **and** `meshy_rig` |

`convert_vrm` has no tile. Its output is a download, not a picture, so it lives in
the control bar as **Download VRM**.

### Why 3 and 4 are one tile

`meshy_3d` produces an untextured GLB that is only ever an input to `meshy_rig`.
Shown as its own tile it was a picture indistinguishable from the one beside it.

The previous rule hid `meshy_3d` *once it completed*, which meant the rail had
**four tiles during a run and three afterwards**: the tile you were watching
disappeared at the moment it succeeded, and everything after it renumbered. Now
the two steps are one stage, so the rail is three tiles from the moment a
creation exists until it finishes. Only the third tile's contents change as
modelling hands over to rigging.

## What you see at each point in a run

Creating a new hero, the rail is **three tiles the whole way through**. Nothing
appears or disappears; tiles fill in.

| Point in the run | Tile 1 | Tile 2 | Tile 3 (3D Hero) |
|---|---|---|---|
| Just uploaded | running | pending | pending |
| Rendering | drawing | running | pending |
| Modelling (`meshy_3d`) | drawing | AI render | running |
| Rigging (`meshy_rig`) | drawing | AI render | running, showing the model that modelling produced |
| Finished | drawing | AI render | the rigged hero, as a still captured from the 3D stage |

Tile 3's status is derived from both its steps:

- **failed** if either step failed,
- **processing** if either is running,
- **completed** only when `meshy_rig` is completed,
- **pending** otherwise.

So it never claims to be done while rigging is still to run.

### If rigging is skipped or fails

Tile 3 stays **pending** (skipped) or goes **failed**, and shows the untextured
model that `meshy_3d` did produce. Clicking it opens that model on the stage, and
the stage says why there is no rigged version. The tile is never silently green.

### The borrowed picture

A 3D stage has no picture of its own until its model has been rendered on the big
stage and snapshotted. Until then it borrows the AI render, **desaturated and
darkened with a ▶ chip**, so it reads as "the same character at a stage you have
not opened yet" rather than as a duplicate of tile 2.

Once you open the stage, a still is captured from the live 3D canvas, cropped to
the character, and used from then on.

## Thumbnails

Rail tiles are ~90px wide, so they request `thumb_128_<file>`; the stage paints
`thumb_512_<file>` first and cross-fades to the full-size render. All whitelisted
sizes (128, 256, 512) are generated from a **single** download of the original -
see `backend/app/api/files.py` and `backend/tests/test_thumbnails.py`.
