# Real-product footage reel (for the ad redo, 26 Nov)

This reel uses real staging footage only. There are no AI people and no mock-ups. Its job is to let us cut fast once Raz picks the direction.

## reel-v0 (32.5 s)

> **Warning (26 Nov, 08:00, Liran):** clips 3 and 4 are **not real speed**. Playwright's clock leaked into page time, about 741 ms per frame instead of 33, so the motion plays many times too fast. Don't use them. Liran is re-recording with the clock paused, and v1 replaces them.

| # | Clip | Source | Quality |
|---|---|---|---|
| 1 | Camera → Violet's drawing goes in | Liran, 1-camera-violet (real speed) | Smooth (2D UI) |
| 2 | Making screen → 0% → 100% → 3D alive | Liran, 2-making-and-reveal | The UI is smooth, but the 3D is a live capture (choppy) and the drawing is the **robot test drawing**, not Violet |
| 3 | Violet's hero page, dancing | Liran, 4-violet-dancing | **True 30 fps** |
| 4 | Dance party game | Liran, 5-dance-party | **True 30 fps** |

Music: "Blue Sky" by Sergmusic, CC0.

## reel-v2 (55.3 s): v1 plus the corrected clips
Adds 6 · Tap Dance and 10 · Dance party, both re-recorded by Liran at real speed with the clock paused (commit c89cab6). All clips are real speed.

## reel-v1 (46.3 s), only real speed and verified
| # | Clip | Source |
|---|---|---|
| 1 | Camera → Violet's drawing goes in | 1-camera-violet (Chrome screencast, real speed) |
| 2 | Making screen → 0% → 100% → 3D | 2-making-and-reveal (screencast, real speed; **robot test drawing**, live 3D slightly choppy) |
| 3 | Violet's hero page: drawing → painting → 3D | 6-violet-real/1-arrival (true 30 fps, clock paused, 34 ms/frame) |
| 4 | Tap Flip | 6-violet-real/2-move-flip (true 30 fps) |
| 5 | Tap Wave | 6-violet-real/2-move-wave (true 30 fps) |
| 6 | The original drawing, full size | 6-violet-real/3-tab-drawing (true 30 fps) |
| 7 | The painting | 6-violet-real/3-tab-painting (true 30 fps) |
| 8 | Robot Rumble lobby (Violet in a playroom, drawings on the wall) | 6-violet-real/4-robot-rumble (true 30 fps) |

v1 drops v0's dancing and Dance party clips (too fast). They come back once Liran re-records them.

## Was "coming next" (now in v1)
- Violet's hero page arriving: drawing → painting → 3D.
- Wave, Flip and Punch.
- The Drawing / Painting tabs.
- Robot Rumble.

## Gap that needs Raz's yes
The "Painting… a few minutes" making stage with **Violet's** drawing. Making her again calls the paid providers (one generation).
