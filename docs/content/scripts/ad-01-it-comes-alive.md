# Ad 01: "It comes alive!": script

Status: **draft for the PM's review**, then Maya draws the storyboard from it.
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
- **Mom** (optional, shot 5): AI-generated adult.

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

## Gift cut (`ad-gift`, December)

Shots 1–4 the same. Shot 5: Maya hands the printed page to Grandma on the call.
Shot 6: "A gift made from their own drawing." Only if the PM wants a December
gift test (Hanukkah).

## What it costs

- Clips: 3 AI videos (shot 1, shot 4 in two parts, shot 5). The free quota
  gives about two a day; Hugging Face PRO ($9/month) makes all of them today.
- Tom: a day to generate, render and record. Maya: the storyboard (6 frames, two
  sizes).

## Open questions for the PM

1. 15 s, or 10 s without shot 5 (Mom)?
2. Make the gift cut now, for December?
3. Pay $9 for Hugging Face PRO, or wait two days for the free quota?
