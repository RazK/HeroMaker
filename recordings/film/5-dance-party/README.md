# Dance party, Violet, true 30 fps (for "Now she plays it")

- `violet-dance-party-30fps.mp4`: 4 s, 910x780 (the stage of an 844x390
  landscape viewport at 2x), 30 fps, real speed. 120 of 120 frames unique.
- Staging, Violet Volt (26eef3df), Play -> Dance party, camera off: her own
  dance on the curtain stage. The panel is outside the crop; the back button
  is hidden for the take (CSS on the page, nothing else changed).
- "Start dancing" needs the camera: with one on, the game goes full screen and
  Violet waits in a T-pose for a player to copy ("Step in!"), so there is no
  routine to film without a person. This is her camera-off dance.
- Recorded with a stepped clock (Playwright page.clock, 1/30 s per frame), so
  it is smooth on a runner with no GPU. `record-dance-party.js` is the recorder.

**Re-recorded 2026-11-26 (real speed).** The first version was captured with the
fake clock installed but not paused: each ~1 s screenshot leaked into page time
(measured 741 ms per frame), so the dance played far too fast. The script now
pauses the clock first; each frame is exactly 1/30 s (measured 34 ms).
