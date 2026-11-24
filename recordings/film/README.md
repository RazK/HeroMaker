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
