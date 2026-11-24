# Camera on staging, v2.0.241 · a58635b (not for merge)

Real Playwright screenshots of https://frontend-staging-7cb8.up.railway.app,
taken 2026-11-24 by Liran, at deviceScaleFactor 1 (1 px = 1 CSS px).

Path: sign up a robot test account -> Make a hero -> Take a photo -> shutter.
The camera is Chromium's fake device fed a still of the robot's crayon
drawing on a brown table (`--use-file-for-fake-video-capture`). One fake
camera, so Flip is hidden. "Use this photo" was not pressed.

- 390x844-capture.png / 390x844-review.png
- 1440x900-capture.png / 1440x900-review.png

## camera-demo.mp4 (17 s, raw, real speed)

The whole camera flow on real staging (v2.0.241 · a58635b), 390x844 @2x,
recorded with Chrome's own screencast; nothing cut or sped up. Sign-up was
done before recording started. Gallery -> Make a hero -> Take a photo ->
camera (fake device: the crayon drawing on a table) -> shutter -> "Looks
good?" -> Retake -> shutter -> review. Step times in steps.json.
