# 15 s Reels ad: storyboard v1 (from scratch)

**Brief**
- **What it is:** a paid Meta Reels and Stories ad, 9:16, 15 s. It must work muted.
- **Who it's for:** a parent of a child aged 4–9 who draws, scrolling in the evening.
- **Its one job:** stop the scroll, make the parent feel "that's MY kid's drawing, alive", and get a tap on *Make a hero*.
- **How we measure it:** hook rate, then hold rate, then CTR, then cost per hero started.

**Structure.** Taken from the research (docs/content/AD_PLAYBOOK.md), modelled on PhotoRoom and Pixelcut:
1. The real drawing on a table.
2. A hand holds a phone over it.
3. The hero comes alive next to the drawing.
4. The child's joy.
5. A still end card.

| # | Time | Picture | Caption (one spot, inside the safe zone) |
|---|---|---|---|
| 1 | 0–1.5 s | Violet steps up off the crayon drawing on the table (the hook) | none |
| 2 | 1.5–3.5 | Her hand and crayon on the real drawing | She drew this at breakfast. |
| 3 | 3.5–5.5 | A parent's hand holds the phone over the drawing, showing the **real camera screen** | Snap it. |
| 4 | 5.5–8 | A few minutes later: the **real hero page**, tap Dance | Every line kept. |
| 5 | 8–10 | Her face as she recognises it (the peak) | Her drawing. Her hero. |
| 6 | 10–12.5 | She copies the hero's moves, shown on the **real game screen** | Now she plays it. |
| 7 | 12.5–15 | End card, held still for 2 s: icon, "Your child's drawing, brought to life.", the Make a hero button | none |

**Rules for every frame**
- The app screens in frames 3, 4 and 6 are real staging captures. Frame 4 uses `/hero/26eef3df…`, captured tonight.
- In this storyboard, frame 6's TV is still an AI keyframe; in the cut it will be a real hero-moves capture.
- The AI cast is labelled "Dramatization · AI characters".
- Every caption ends above y 416 (at 360x640) and stays clear of the right 48 px.

**Hook variants to test**
- A: Violet steps off the page (this board).
- B: "He drew 5 legs. It still has 5 legs."
- C: The drawing comes off the fridge.

## The ad's description text (Meta)
PM decision, 25 Nov: option (a). The label goes in the description, and Meta adds its own AI label automatically. The picture stays clean. Raz makes the final call before anything runs.

> Your child's drawing, brought to life. Snap a photo of any drawing and HeroMaker turns it into a 3D hero they can play with. For kids 4–9.
> Dramatization · AI characters. App screens are real.
> Music: "Blue Sky" by Sergmusic (CC0). Sound effects: Stable Audio 3 (Stability AI).

The CTA button is *Make a hero*. The text doesn't use "only", and doesn't say anything personal about the viewer ("Are you a mom…").

## Music and sound (final cut 2)
- **Music:** "Blue Sky" by Sergmusic (Freesound 639933). Licence **CC0 1.0** (public domain): commercial use, no credit required. Checked on https://freesound.org/people/Sergmusic/sounds/639933/ on 25 Nov 2026. We use 0:15–0:30 of the track, so its new melodic layer lands on the reveal at 7 s.
- **Sound effects:**
  - burst / rise / giggle: our own Stable Audio 3 renders (marketing/film/audio/).
  - shutter: synthesised noise.
  - Licence (Gidi, 25 Nov): the Stability Community Licence covers commercial use, ads included, under US$1M revenue, and we own the outputs. **Condition: Raz registers with Stability for free before the ad goes public.**
- **Mix QA:** checked by the audio model on 25 Nov. Every effect is audible at its time, with no clipping and no silent gaps. Mean -18.9 dB, peak -0.8 dB.
