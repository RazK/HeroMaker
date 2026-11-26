# 4 · Violet dancing (hero page, stepped clock, true 30 fps)

`violet-dancing-30fps.mp4`: 10 s of Violet Volt (staging `26eef3df`) dancing on her
hero page, 390x844 @2x, made by `record-stepped.js`.

**Re-recorded 2026-11-26 (real speed).** The 2026-11-25 version was captured with
the fake clock installed but not paused, so each ~1 s screenshot leaked into page
time (measured 741 ms per frame) and the dance played far too fast. The script now
pauses the clock first; each frame is exactly 1/30 s (measured 34 ms).
