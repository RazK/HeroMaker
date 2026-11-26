# 6 · Violet, real product footage (stepped clock, true 30 fps)

Violet Volt (staging hero `26eef3df`), recorded on staging 2026-11-26 for the
real-footage reel. No paid calls: every clip uses the existing hero.

| folder | size | what | length |
|---|---|---|---|
| 1-arrival | 390x844 @2x | the page's own intro: drawing → painting (1.0 s) → 3D Violet (2.0 s), then 3 s live | 5.0 s |
| 2-move-wave / flip / punch | 390x844 @2x | 0.5 s still, then the tap (frame 15), 4 s of the move | 4.5 s each |
| 3-tab-drawing / painting | 390x844 @2x | 0.5 s on the 3D hero, then the tab tapped (frame 15): that picture full size in the card, 3 s | 3.5 s each |
| 4-robot-rumble | 844x390 @2x | Robot Rumble with Violet, no camera, no player input | 6.0 s |

Each `steps.json` gives the frame and time of every event (a tap, a slide change).
Header included in the portrait clips, for cropping.

**How:** `record-violet-real.js`. Playwright's fake clock is installed, the page
loads in wall time, then the clock is **paused** and each frame advances it by
exactly 1/30 s (measured: 34 ms of page time and 2 animation frames per captured
frame). The arrival pauses the clock at once, so the intro waits on the drawing
while the page loads and then plays at its real 1 s per picture. On a real phone
the drawing stays up for as long as the 3D takes to download (~7 s on 4G).

**Earlier clips are NOT real speed:** `4-violet-dancing` and `5-dance-party`
(2026-11-25) were captured with the clock installed but not paused, so each
frame carried ~0.7-1 s of wall time into page time and the motion plays far
too fast. Re-recorded versions replace them (see their folders).
