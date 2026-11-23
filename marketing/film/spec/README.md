# Two film frames, measured (Maya, after Raz rejected them on 2026-11-23)

`paint.html` and `end.html` are the spec, at 360x640 (scale x3 for 1080x1920).
Rebuild these two frames to match them exactly.

**"We paint it." (paint.png)**
- No card, no stage inside the frame. The painting is the frame: the cut-out
  painting on the lilac, at most 312 px wide (24 px side margins).
- The caption sits in the top band (cream, 96 px).
- The name tag is 24 px from the left edge and 24 px from the bottom edge.

**End card (end.png)**
- One grid: a 24 px margin, a 128 px picture column, a 20 px gap, then the
  text column.
- Three 128 px rows with 24 px between them, then the button.
- The left edges of the three sentences all sit at x 172.
- **Make a hero is full width, like the app's buttons:** x 24 to 336, centred on the frame, 56 px tall (Raz).
- Every sentence is on one line, the widest ending at x 333 (inside the
  336 px margin).
- The block runs from y 60 to 580, centred vertically: 60 px above and 60 px
  below.

## Family film cut 1 is NOT passed (Raz, 2026-11-23)

Raz: some screens do not look like our brand or our UI. My earlier "send it
straight to the PM" was wrong: nothing leaves without a frame-by-frame gate.
Every second, from `cut1-all-frames.jpg`:

- **0–9 s (live action): ok.**
- **10 s:** a washed-out, half-faded drawing card floats on cream. That is a
  transition frame. Cut it, or make it a clean cut.
- **11–13 s, "We paint it.":** a small hand-made card with the bottom 40% of
  the frame empty. It is not our UI. Use the measured spec (paint.html): the
  painting is the frame, with the name tag 24 px in.
- **14–16 s: ok.**
- **17–26 s, the split:**
  - Maya is a narrow clip in a box, and the lower third of the lilac is
    empty.
  - Violet's face renders ghost-white with a heavy black outline. That is not
    how she looks in the app.
  - Fill the frame: two equal columns down to the caption-safe line.
  - Light Violet as the app does (the warm studio light of the new hero
    page).
- **26 s:** a cross-fade ghost of Violet over the clip. Cut it clean.
- **27–28 s: ok.**
- **29–32 s:** still the old end card: small rows, top-left, a small
  off-centre button. Use end.html: one grid, and a full-width centred button.

**Rule from now on:**
- Any screen of the app in the film is a real recording of staging, or it is
  not in the film. No hand-made UI.
- Maya gates every cut frame by frame, and nothing goes to the PM or Raz
  before that.
