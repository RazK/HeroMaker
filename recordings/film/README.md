# Film: real app screens on staging (raw, not for merge)

Recorded 2026-11-24 by Liran for Tom to cut. Real staging (v2.0.243 · 49a1d07),
390x844 @2x (780x1688), Chrome's own screencast, real speed, nothing cut or
sped up. Sign-up and TEST-checkout credits were done before recording; no
pay screen is in any clip. Step times are in each folder's steps.json.

- `1-camera/1-camera.mp4` (14 s): gallery -> Make a hero -> Take a photo ->
  camera (fake device: the crayon drawing on a table) -> shutter -> "Looks
  good?" -> Use this photo -> "Make this hero?" with the drawing in.
- `2-making-and-reveal/2-making-and-reveal.mp4` (77 s): "Make this hero?"
  (Pixar) -> Make my hero -> the two questions -> the making screen ->
  "Packing the hero… Almost done" -> the 3D hero, alive and dancing.

Gap: the robot's drawing is in staging's result cache (so no paid AI calls),
so the painting is instant and the "Painting… a few minutes" stage does not
show. Filming that stage needs a new drawing, which calls the paid
providers: Raz's yes first.

## Re-take with Violet Volt's drawing (Tom's continuity ask)

- `1-camera-violet/1-camera-violet.mp4` (14 s): the same camera flow, the
  fake camera fed Violet's drawing (marketing/film/direction/violet-drawing.webp)
  on a table, the whole drawing inside the guide. Staging v2.0.245.
- Clip 2 with Violet is NOT re-taken: her drawing is not in staging's result
  cache (her hero dates from 2026-08-25), so making her again calls the paid
  providers. Waiting on the PM / Raz.

## Violet dancing, true 30 fps (for the "hero animating" shot)

- `4-violet-dancing/violet-dancing-30fps.mp4` (10 s, 780x1688, 30 fps): Violet
  Volt's live staging hero (26eef3df), dancing. 300 of 300 frames unique.
- Live capture of 3D on our runners gets ~3 fps (no GPU). This one steps the
  page clock 1/30 s (Playwright `page.clock`), renders, then screenshots each
  frame: smooth whatever the machine. `record-stepped.js` is the recorder.
- Real speed: 1 s of the hero's own clock = 1 s of video.
