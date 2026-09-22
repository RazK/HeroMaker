# Anonymised copies of the `needs-consent/` photos

Eight images, same filenames and same pixel dimensions as the originals in
`../needs-consent/`, JPEG quality 85, all under 600 KB. The originals were not
modified.

**51 faces treated in total.**

## Method

Faces were located by eye (no detector is installed and none was added), then
treated with Pillow:

- **Heavy mosaic** — block size ≈ 1/8 of each face's width, so every face gets
  about 8×8 blocks regardless of how large it is in frame. Blocks are softened
  by a small blur (~16% of a block) so they read as a deliberate stylised
  treatment rather than a forensic redaction.
- **Feathered elliptical mask** — the treatment is composited through a blurred
  ellipse covering hairline-to-chin and ear-to-ear, so it blends into the
  surrounding photo instead of sitting there as a hard rectangle. No eye-bars.

The mosaic is applied by downsampling and resampling with NEAREST: the original
pixels are discarded, not merely smoothed, so the result is **irreversible** —
no amount of sharpening recovers a face. Every output was re-read at full
resolution (and at 2–4× zoom on small or background faces) and confirmed
unidentifiable before being accepted.

## ⚠️ One line that matters

**Anonymising reduces the privacy risk; it does not create permission.** These
are still photographs of identifiable people taken at a real event, and the
product owner still decides whether any of them may be published.

## Per-image record

### `kids-watching-hero-dance.jpg` — 5 faces, mosaic
Two boys, the adult beside them, and two people further back in the hall.
**Does it still work for "Game section, emotion"? No.** The entire value of this
frame is three delighted faces lit by the screen. With all three mosaicked the
emotion is gone and what remains is three blanked heads facing a monitor. Use
`kid-reaching-for-pizza-hero.jpg` or `two-girls-playing-together.jpg` instead —
they get the same joy from body language, with no faces at all.

### `group-kids-holding-drawings.jpg` — 11 faces, mosaic
Seven foreground faces (kids and two team members) plus four people at the right
edge.
**Does it still work for "Social-proof hero"? Partly, and not as a hero.** The
countable claim survives: you can still see eight children each holding up their
own drawing, and the drawings themselves are untouched and legible. But eleven
mosaic patches at close range is a lot of visible redaction on one image, and at
hero size it reads as "these children had to be hidden" — the wrong note for a
children's product. Usable small, or in a wide crop, not above the fold.

### `group-with-hero-gallery-screen.jpg` — 10 faces, mosaic
The same group, wider.
**Does it still work for "Social proof, wide"? Yes — the best of the group
shots.** Because it is wider, the faces are small, the mosaic blocks are
correspondingly small, and the eye goes to the gallery of finished 3D heroes
filling the right third of the frame. The "ten people, one table, a screen full
of their heroes" reading is intact. This is the group shot to use if a group
shot is needed.

### `families-at-the-heromaker-booth.jpg` — 18 faces, mosaic
Seven at the booth (including one child in the foreground) and eleven passers-by
in the atrium behind.
**Does it still work for "We took it to real events"? No.** A busy public hall
means a lot of incidental faces, and treating them honestly leaves eighteen
patches scattered across the frame. The documentary feel is exactly what breaks:
the more real the crowd, the more redaction it needs. Shelve it, or re-crop
tightly to the table and the laptop and re-treat just that crop.

### `pipeline-four-stages-laptop.jpg` — 2 faces, mosaic
The team member leaning over the laptop, plus one person seated in the
background.
**Does it still work for "How-it-works, with a person"? Half.** The subject —
all four pipeline stages of the bear on screen — is untouched and perfectly
readable. But his face fills the top of the frame, so the mosaic is large and
pulls focus. **Recommended fix: crop the top ~15% off** (below his chin). You
keep the hands, the posture and the whole screen, lose the face entirely, and
need no treatment at all.

### `kid-dancing-with-bear-hero.jpg` — 1 face, mosaic
The grinning adult at the left. The child was already shot from behind.
**Does it still work for "Then they dance with it"? Yes.** Best outcome in the
set. The energy is all in the boy's flung-out arms and the bear mirroring him;
one small treated face at the left edge costs nothing.

### `parent-and-toddler-drawing.jpg` — 1 face, mosaic
The father, looking down. The child's face was already turned away.
**Does it still work for "Testimonial, emotional"? Yes, mostly.** The warmth
here lives in the posture — the two heads bent over the same sheet of paper, the
hands sharing the pencils — and that is untouched. The mosaic is noticeable
because he is close to the camera, but the photo still says what it needs to say.

### `workshop-adults-drawing-warm.jpg` — 3 faces, mosaic
All three adults at the table, each looking down at their drawing.
**Does it still work for "Press / secondary audience"? Yes.** The faces are
small, downturned and in dim tungsten light, so the mosaic is quiet. The subject
is the lamp-lit table full of pastels and drawings, and that is entirely intact.

## Honest summary

Anonymisation is nearly free on photos whose subject is the *work* (the table,
the screen, the drawings, the gesture) and it is ruinous on photos whose subject
is a *face*. Of the eight: three survive cleanly
(`kid-dancing-with-bear-hero`, `workshop-adults-drawing-warm`,
`parent-and-toddler-drawing`), two survive with caveats
(`group-with-hero-gallery-screen`, `pipeline-four-stages-laptop` — better
cropped), and three do not (`kids-watching-hero-dance`,
`group-kids-holding-drawings` as a hero, `families-at-the-heromaker-booth`).

For the **social-proof slot**, the strongest option is not any of these: it is
`../wall-grid-of-kids-drawings.jpg`, which delivers "look how many kids did
this" with ~25 drawings and zero faces. If a photo of actual people is required,
use the anonymised `group-with-hero-gallery-screen.jpg` rather than the tighter
`group-kids-holding-drawings.jpg`.
