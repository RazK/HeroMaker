# Content (Reel)

What exists, where it lives, how to re-make it.

## "It comes alive!" clip: a child moves, Violet Volt copies her (in progress)

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
