# Content (Tom)

**Who owns what (Raz, 2026-11-23).** Tom owns the story: strategy, scripts,
storyboard, shots, keyframes, sightlines, crops, the clips and every cut.
Maya (design) reviews only: the brand, the fonts, the crops per format, the
5-point gate and the sightlines; she answers "passes" or "fix X", and passes
approved frames to Raz. The PM decides money, order and what runs.

What exists, where it lives, how to re-make it.

## "It comes alive!": Maya moves, Violet Volt copies her (in progress)

1. **Child clip**: an AI-generated child (never a real one), FaceTime look, full body.
   First frame from `gpt-image-2`, motion from Wan 2.2 image-to-video (Hugging Face
   Space `prithivMLmods/Wan2.2-Fast`, free; needs an HF token for quota).
2. **Motion**: `games/hero-moves/tools/mimic/extract_pose.py` runs MediaPipe Pose
   (heavy) on the clip and writes 3D landmarks per frame.
3. **Hero**: `games/hero-moves/mimic.html` (`src/mimic.ts`) aims each of the hero's
   bones along the child's matching body segment (proportion-blind), pins the
   feet to the floor, lights her with `look.ts` on the Toy Box cream.
   `tools/mimic/render.mjs` steps it to PNGs, one per video frame.
4. ffmpeg puts the two side by side (phone / desktop cuts, WebM + MP4, poster).

```bash
python tools/mimic/extract_pose.py clip.mp4 pose_landmarker_heavy.task pose.json
npx vite --port 5182 &   # games/hero-moves
node tools/mimic/render.mjs Violet_Volt.vrm pose.json frames/
```
Violet Volt: the featured staging hero (by Maya, 6), `opt_avatar.vrm`.

### Landing cut (approved direction, 2026-11-23)
One transparent animated WebP: Violet full size, Maya in a rounded video-call
window in the lower right, both in one file so they never drift apart.
Shadow scaled down (`"shadow":0.6`) so nothing cuts off at the frame edge.

### Polaroid: the drawing draws itself
`scripts/content/draw_on.py drawing.png frames/` splits the crayon colours and
reveals them stroke by stroke, then holds. ~160 KB as animated WebP.

### Ad (9:16 and 4:5)
`marketing/ad/ad.html`, recorded by `games/hero-moves/tools/ad-record.mjs
<assetsDir> out.mp4 --w=1080 --h=1920` (or `--h=1350`): the drawing draws itself,
the painting joins it, the call, the end card with Make a hero.

### Notes
- Maya (the artist on the polaroid) is not a real child; the AI girl plays her.
- Hugging Face free ZeroGPU quota: about two 5 s clips a day. PRO is $9/month.
- `tools/mimic` repairs the pose model's left/right swap on a turn (tested).

## Family film first cut (Sprint 1, due Tue 25 Nov on razk.github.io)

`marketing/film/film.html` lays out a timeline of segments from a cut list
(`marketing/film/cut.family-first.json`): `still` (a keyframe with a slow
push-in), `seq` (a clip's frames), `screen` (the real app, recorded from
staging, on a card, header cropped off), `split` (Violet on top, Maya under, one
move, per Maya's look rules) and `end`. `games/hero-moves/tools/film-record.mjs
<assetsDir> out.mp4` records it frame by frame, 9:16 by default.

The assets folder holds `cut.json`, `kf/` (keyframe PNGs), `screen/` (frames of
Violet's staging hero page at 16 fps), `end/` (drawing, painting cut-out,
Violet), and the clips' frame folders. The first cut uses stills where the clip
is not made yet; each night's free-quota clips replace them: F5 (the split)
first, then F4 (the gasp) and F6 (Mom).
