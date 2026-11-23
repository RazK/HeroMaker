# Ad 01: "It comes alive!": script

Status: **approved by the PM (2026-11-23)**; Maya's storyboard in `docs/content/ad-storyboard.md`.
**Runs nothing until the PM says payments are Live on production** (Grow). Make the creative now.
Owner: Tom (Content). Storyboard: Maya (Design). Go: PM, then Raz.

## Why this ad

| | |
|---|---|
| Money moment | 1 (the reveal) and 2 (the child's reaction), `docs/product/MONEY_MOMENTS.md` |
| Number it moves | ad door → first visit → `make_started` (H-001, E-002) |
| Door | `ad-family` (Instagram / Facebook); a gift cut for `ad-gift` (below) |
| Promise | "You draw it. We paint it. It comes alive!": the same words as the landing, the first screen and the share page |
| Formats | 9:16 (Stories, Reels) and 4:5 (feed). 15 s. Works with the sound off. |

## Cast

- **Maya**, about 7: an AI-generated girl, never a real child. Same face, yellow
  t-shirt and pigtails in every shot. She is the artist on the landing's polaroid
  ("Maya, 7").
- **Violet Volt**: Maya's drawing, our real painting and our real 3D hero. Her
  motion comes from Maya's clip (`games/hero-moves/tools/mimic`), so she does
  exactly what Maya does.
- **Mom** (shot 5): AI-generated adult. Her reaction is money moment 2.

**Honesty rule (PM):** Maya and Mom are AI-generated and acted. Nothing in the
ad or its post caption may say or suggest they are a real customer (no "real
reaction", no "Maya's story"). The painting and the hero shown are what the
product really makes.

## Shots

| # | Time | What we see | Text on screen | Made with |
|---|---|---|---|---|
| 1 | 0.0–3.0 | Kitchen table, a phone propped across it. Maya colours the last bit of her drawing, puts the crayon down, lifts the page and turns it to the camera, proud. | You draw it. | AI video from `child/drawing.png` (Wan 2.2) |
| 2 | 3.0–4.5 | Match cut: the page she holds becomes the gallery polaroid on the cream, the same size and place. | You draw it. | page → polaroid (`draw_on.py` last frame) |
| 3 | 4.5–6.0 | The polaroid steps into the landing's row; a wavy grape arrow travels; the painting's cut-out pops in beside it. | We paint it. | landing assets, the arrow from `Landing.tsx` |
| 4 | 6.0–12.0 | A video call. Violet fills the stage. Maya, at home, in a rounded call window with its own place. She looks curious, is surprised (hands to cheeks), strikes a hero pose (fist up, hand on hip), then laughs and turns a slow 360. Violet does each move with her, at the same moment. | It comes alive! | AI video (2 clips) + mimic render |
| 5 | 12.0–13.5 | The call window grows: Maya laughs; Mom leans into the frame behind her, amazed. | (none) | AI video, last frame of shot 4 |
| 6 | 13.5–15.0 | End card: the landing's row (drawing → painting → Violet) and Make a hero. | Make a hero | landing assets |

Shots 2–4 and 6 follow Maya's grid and beats (`docs/content/ad-storyboard.md`,
"Maya's notes"): one caption slot, the call window bottom-left in 9:16 and
side by side in 4:5, the sentences once on the end card.

Rules for every shot (`docs/design/PRINCIPLES.md`): one element moves, never a
copy (#18); nothing overlaps (#11); no half-empty frames (#9, #26); the painting
is its cut-out, never a beige box; the caption in one place and one size (#7);
each sentence said once (#13).

## Cuts

- **15 s** (shots 1–6), 9:16 and 4:5.
- **6 s bumper** from shots 4 and 6, for later. No extra clips.
- **Gift cut: parked.** Ads cannot run before payments are Live, so a December
  gift test would land after Hanukkah (4 Dec). Revisit for next season: shots
  1–4 the same, Maya hands the page to Grandma on the call, "A gift made from
  their own drawing."

## What it costs

- Clips: 3 AI videos (shot 1, shot 4 in two parts, shot 5). The free quota
  gives about two a day; Hugging Face PRO ($9/month) makes all of them today.
- Tom: a day to generate, render and record. Maya: the storyboard (6 frames, two
  sizes).

## Decided (PM, 2026-11-23)

1. 15 s with Mom, plus the 6 s bumper.
2. No gift cut now (parked above).
3. No Hugging Face PRO: nothing can run for days, so the free quota (about
   two clips a day) costs nothing. Clips: shot 1, shot 4 (two parts), shot 5.
