# Robot Rumble

A camera-free mini-game starring the player's own hero. Wind-up toy robots
and springy mushrooms come into a walled play-room and head for the toy chest
at the back; the hero runs them down with a thumb stick and bops them, knocks
bouncy balls and wobbly crates about, jumps the balls that roll across, and
ground-pounds a crowd of them — while other children's heroes cheer from the
stands. 75 seconds, a score, a best score, a victory dance.

## Nothing you hit is another child's hero

The first version had other children's heroes walk in as rivals to bop. Raz,
from a classroom: *"I got comments about hitting the other kids' drawings,
which is bad. Characters from the class should be cheering from the sides of
the arena, but inside the arena I shouldn't be hitting characters from other
kids."* So:

* **Every target is a generated toy** (`src/arena/things.ts`): tin robots,
  mushrooms that hop toward the chest and squash flat with a boing, bouncy
  star balls that boing in place until a punch sends them flying, wobbly star
  crates, balloons. Primitives and canvas paint, a draw call or two each,
  nothing downloaded. `TOY_KINDS` is the whole vocabulary of things the game
  can hold, and `isToy` (no skinned mesh, no VRM) is checked when a thing is
  added and again on every hit, which throws rather than score a non-toy.
* **Other heroes are the crowd** (`src/arena/crowd.ts`), in their own group
  behind the court and never in `Game.things`, the only list the punch, the
  auto-aim and the ground pound read. They are an audience in a grandstand:
  two stepped rows of the room's toy blocks between the H E R O letter blocks
  and the back wall (one merged mesh, one draw call), with the E and R blocks
  as the front row — an arc of six seats across the back of the court, all
  in a portrait phone's shot, none beside the court. (A first version stood
  two of them on plates outside the side walls; Raz: "strained outside the
  boundaries".) They face the camera's side so the front the child drew
  shows. Each loops two cheers out of step with its neighbours
  (`Jumping_Jacks`, `Victory_Fist_Pump`, `Greeting`, `Dance_Simple`,
  `Dance_Charleston`) and jumps with its arms up (`Victory` plus a hop) when
  the player scores; a crate, a combo step or a smash brings everyone up, and
  so does the end of the round.
* **Their drawings hang on the wall** (`src/arena/pinboard.ts`): each fan's
  original drawing (`thumb_original.jpg`, the backend's small thumbnail) as
  the app's polaroid — white card, drawing contained, the child's first name
  and age, a slight tilt, a coloured pushpin — on its fan's side. Raz: "hang
  the original drawings on the wall, with pins maybe". A portrait screen sees
  the wall narrow but tall, so they hang in a band above the fans' heads,
  clear of the combo pill in the middle; a landscape screen sees the whole
  wall but only ~2.2 m of it, so they hang either side of the grandstand. The
  board re-hangs itself when the camera's shape flips. They load after the
  crowd, while the round is already playable, and a drawing that does not
  arrive is simply not hung. Decor: not in `Game.things`, never hittable.
* **Proved, not promised.** `window.__arena.audit()` reports that every live
  target is a toy, that no fan and no drawing is in the game's tree or in a
  target, that every fan is in the stands (on a letter block, or on a
  grandstand row within the court's width), that every drawing hangs on the
  back wall, and that the detector says "not a toy" when shown a
  real hero. `tools/arena-crowdcheck.mjs` plays a round with full stands and
  checks it every half second; the staging robot checks it in its game step.

**Who is in the stands.** A class hero (made in a class session) is cheered
by its classmates: the class's own finished heroes from
`GET /api/classes/<id>/stage`, which only the class's teacher can read — and
the teacher is who opens a class hero's game. The game learns the hero is a
class hero from its public page (`in_class`), and finds which of the
teacher's classes holds it (or takes `?class=<id>`). Every seat the class
cannot fill, and every other player, gets Editors' choice
(`GET /api/creations/?featured_only=true`). A class hero can never be starred
(the API refuses), so a class's children only ever meet their own classmates
or Editors' choice — never another class's child. With no API (GitHub Pages)
the stands use the sample heroes; with nothing at all they stay empty and the
game plays the same. The player's own hero is never in the stands.

At most six fans (`?crowd=N` caps it, `0` for none), each an `opt_avatar.vrm`
with no drawn outline, loaded one after another behind the player's hero. A
fan updates only its humanoid (no spring bones), and a fan outside the camera
is neither drawn nor animated.

**The code is not in this folder.** It is a page of the `games/hero-moves`
build — `games/hero-moves/arena.html` and `games/hero-moves/src/arena/` —
because that build is what `devops/scripts/bundle-game.sh` copies into the
app at `/play/`, and it already holds everything the game reuses: the VRM
loader, the rotation-only retargeter, the CC0 clips, the Toy Box parts. A new
build would have meant a second bundle step, a second copy of three.js and a
second download of every clip. The app opens it at
`/play/arena.html?vrm=<opt_avatar.vrm>&name=<hero>`, exactly like Dance party.

## Which game — the decision

The brief: no camera, a few on-screen keys, the hero fights, moves, hits
things and scores, using several of the rig's animations — and above all it
must *showcase the hero in 3D*, front preferred over back. That last point is
the one Hero Dash failed (`games/README.md`): a chase camera shows the half of
the model the child never drew. So each candidate was scored first on **what
the camera sees for most of the round**, then on the rest.

| Format | What the camera sees | Animations used meaningfully | Any proportions? | Controls | Verdict |
|---|---|---|---|---|---|
| **Side-scroller** (Mario) | Profile, ~100% of the time: one cheek, never the face | Run, jump, stomp; punches read poorly side-on | Yes (capsule) | 3 keys | No: a profile is barely better than a back |
| **Endless runner** (Hero Dash) | The back, ~90% | Run, jump, slide | Yes | Swipes | Already tried and parked for exactly this |
| **One-tap flyer** (Flappy Bird) | Profile, and the hero is a sprite-sized icon | One (fly) | Yes | 1 tap | Too little of the rig and of the hero |
| **Slingshot** (Angry Birds) | Tumbling ballistic body; a ragdoll, not a rig | Launch, tumble | Poorly — a cloud does not tumble like a bird | Drag | Wastes the rig |
| **Lane brawler** (One Finger Death Punch in 3D) | Front, if enemies come from the sides | Punch, kick, combos | Yes | 2 buttons | Good face, but the hero never moves — "moves around" is in the brief |
| **3/4-front arena** (Brawl Stars-lite) | Front and three-quarter, if the arena is built for it | Run, idle, 3-hit punch combo, jump, ground pound, hurt, victory, dance | Yes (capsule collisions) | Stick + 2 buttons | **Chosen** |

An arena on its own does not guarantee the face: run up the screen and you
see the back. So the arena is built so that **the work comes toward the
camera**:

* Robots and mushrooms enter at the *front* edge (the camera's side) and walk
  away toward the chest at the back, so the hero meets them face to face.
* Balloons, crates and gold balloons only appear in the front half of the room.
* Standing still, the hero turns to the nearest target *on the camera's side*,
  or settles three-quarters toward the camera.
* The punch auto-aim breaks ties toward the camera.
* Turned away from the camera, the body leans back toward it — up to ~40°
  running, ~17° standing or punching (a cross-step) — so the worst case shows
  a cheek, not a full back.

**Measured, not hoped.** `Game.facing` integrates, every frame of play, where
the hero's facing points relative to the camera. A bot plays whole rounds with
real touch input (`tools/arena-record.mjs`); over three full 75 s rounds:

| Hero | Facing the camera's half | Front (within 60°) | Front 3/4 or profile | Back 3/4 | Full back |
|---|---|---|---|---|---|
| Curly Carl (tall human) | **68%** | 44% | 24% | 28% | 4% |
| Panda Pals (wide, round) | **69%** | 43% | 26% | 29% | 3% |
| Cuppy Penguin (blocky) | **67%** | 43% | 24% | 30% | 4% |

That was measured with rival heroes in the room (since replaced by
mushrooms, which enter and walk the same way): a 9 m walled room, spawns
spread wall to wall. The small first room with robots only measured 74-81% facing the
camera's half, but 5-11% full back; the bigger room sends the hero running
sideways and diagonally more, which moved time from "front" into "back
three-quarter" (a profile turned slightly away, face still partly visible)
while the full back view fell to 3-4%. The very first version measured 55%.

## The room

A bounded toy room, not a floor that runs off into the fog: a papered back
wall with a grape skirting board, low toy-block walls down both sides, and a
foam mat of one-metre tiles in plate colours. The camera follows the hero most
of the way, so the tiles visibly slide underneath when it runs, and stops
short of the walls so they come into view at the room's edges. Spawns land
more often on the far side of the room from the hero (`Game.awayX`), so a
round is running wall to wall, not standing in one spot.

## Controls

All three controls sit on one centre line in the app's bottom bar (cream,
hairline), one diameter (104px; 92px under 380px wide), in the app's button
language: Jump a secondary (white, ink outline, 6px depth), Punch the primary
(grape, 6px depth), the stick a secondary ring with a grape thumb. Score and
time are the app's credits pill (`.tb-credits`), twice, at the end of the
header; the combo is a third one, centred under it.

| | Phone | Desktop |
|---|---|---|
| Run | Left thumb stick — floats to wherever the thumb lands in the lower-left (the bar or the stage above it), dead zone, full speed at 70% throw | Arrows / WASD |
| Punch | Big grape button — a 3-hit combo (left jab, right jab, cross) when tapped in rhythm; auto-aims at the nearest target in reach | J or F |
| Jump | White button — hop the bouncy balls (+50 "Nice jump!"), pop balloons in the air | K or Space |
| Ground pound | Punch while in the air — shockwave smashes everything within 2.3 m | Jump, then J |

**The stick explains itself.** Kids read a plain "circle in a circle" as a
button (Raz, from a classroom), so the ring carries four chevrons (drag this
way), the knob is a raised thumb pad (grape, its depth under it, a soft
shadow, two grip rings) that sinks when held, and until the player first
moves the knob drifts side to side under a pointing hand with "Drag to move".
The first move dismisses the hint for good (`localStorage`, guarded; a private
window shows it again next visit). `tools/arena-stick.mjs` checks all of that
and photographs it.

Pointer events with one capture per finger: the stick and a button work at
the same time. `touch-action: none` everywhere, the document never scrolls,
haptics through `navigator.vibrate` where it exists.

## Animations

All rotation-only retargeted by `src/anim/retarget.ts`, so they land the same
on a 1.7 m human, a panda wider than it is tall and a penguin made of cubes.
Run and punches are split into upper and lower body, so the hero punches on
the run without its legs freezing.

| Move | Clip | Used for |
|---|---|---|
| Idle | `Fighting_Idle` | standing, blended with the run by speed |
| Run | `Run_Anime` | moving; cadence follows the stick |
| Punch 1 / 2 / 3 | `Fighting_Left_Jab`, `Fighting_Right_Jab`, `Punch_Cross` | the combo |
| Jump | `Jump_2` | the tuck in the air and the landing crouch, timed to a physics arc |
| Ground pound | `Attack_Ground_Pound` | jump + punch |
| Hurt | `Hit_Knockback` | bumped by a ball: "Bonk!", a short knock-down, combo lost |
| Victory | `Victory` | the round ends |
| Dance | `Dance_Charleston` | the end card, until the player chooses |
| Crowd cheers | `Jumping_Jacks`, `Victory_Fist_Pump`, `Greeting`, `Dance_Simple`, `Dance_Charleston` | the fans in the stands, two loops each, out of step |
| Crowd burst | `Victory` | a fan jumps with its arms up when the player scores |

## The chooser's posters

The app's "Pick a game" sheet shows each game behind a poster, not a
screenshot: key art rendered offline from a real gallery hero — Violet Volt
(by Maya, 6), the girl from the HeroMaker logo. `poster.html` stages her at the
best frame of a real clip, with a low camera, a hard rim light, a blurred far
layer and a vignette. The two share that craft and nothing else, because the
first pair (same sun, same rays, near-identical pose) looked like one game:

| | Robot Rumble | Dance party |
|---|---|---|
| Colour | `--tb-rumble` tangerine to `--tb-red` rays | `--tb-dance` magenta on `--tb-dance-deep` night |
| World | comic impact burst, arena ring and ropes, robots marching in | spotlight beams, disco ball, lit LED floor |
| Pose | `Punch_Cross` t=0.5, side-on, mid-air: a wide diagonal | `Victory` t=0.8: one arm to the sky, knee up, tall |

No sun on either: the sun belongs to the hero page. The card footer takes the
same token, so the two differ even at thumbnail size.

```bash
node tools/make-posters.mjs /path/Violet_Volt.vrm out/ rumble dance
.venv/bin/python games/hero-moves/tools/posters-webp.py out/   # -> frontend/public/games/*.webp, 1x and @2x
```

Source: Quaternius' **Universal Animation Library, CC0**, as redistributed by
`scottpetrovic/mesh2motion-app` — fetched and trimmed to one clip per file by
`games/hero-moves/tools/fetch-animations.mjs` (~70 KB each). No other assets:
the room, robots, balloons, crates and balls are primitives painted at boot,
and every sound is synthesised (`src/arena/sfx.ts`).

## Rules

* Mushroom 150, robot 100, bouncy ball 75, balloon 50, crate 25 a knock and 250 to break (3 knocks or one
  ground pound), ball jumped 50. Gold balloon: +5 seconds.
* Hits within 2.6 s keep a combo; every 5 hits raises the multiplier (max x5).
* A robot or mushroom that reaches the chest dives in ("Oh no!") and breaks the combo.
  Being bumped by a ball breaks it too. Nothing ends the round early — kids
  always get their 75 seconds and their dance.
* Spawns escalate over the round: robots every 1.7 s down to 0.8 s, often two
  at a time after the first third; balls from 12 s.
* Best score: `localStorage`, guarded; a private window keeps it for the visit.

## Performance

The player's skinned VRM (plus its drawn outline), up to six fans in the
stands (no outline, humanoid only, culled when out of shot), the room, and
every toy as one merged vertex-coloured mesh with a painted blob shadow; all
particles in one `Points` call; the grandstand one merged mesh; each pinned
drawing one card (a 192x236 canvas) and every pin head one instanced call; no
shadow maps. Clips are parsed once per page and bound per hero.

Measured with `tools/arena-perf.mjs` at **4x CPU throttling** (DevTools'
mid-tier phone), Crayon Kid as the player and five sample heroes as the
gallery. *Before* is the rival-hero build (up to three rivals in the room),
*after* is this one (five fans):

| | Viewport | Draw calls | Triangles | JS per frame (4x) | SwiftShader fps |
|---|---|---|---|---|---|
| Before (rivals) | 390x844 | 52-55 | ~187k | 14.5-15.9 ms | 1.7 |
| After (crowd of 5, 2-3 in shot) | 390x844 | 50-57 | 130-164k | 13.3-14.5 ms | 1.5-2.1 |
| After (crowd capped at 4) | 390x844 | 51 | ~130k | 14.1 ms | 3.4 |
| Before (rivals) | 844x390 | 73 | ~193k | 16.3 ms | 2.9 |
| After (all 5 in shot) | 844x390 | 80 | ~230k | 14.8 ms | 2.2 |

The JavaScript per frame is the same or a little lower than with rivals: a
fan has no path-finding, no spring bones and no updates out of shot. In
portrait fewer triangles reach the GPU, because the camera sees two or three
fans at a time; in landscape all five are in shot and it is ~20% more than
with rivals. This sandbox has no GPU (SwiftShader renders every frame on the
CPU, so its fps is a floor dominated by rasterising, not a phone), so
**phone frame rate is still unmeasured on a real device**. If a device
averages under ~40 fps for two seconds of play, the page drops its pixel
ratio once. Levers if phones struggle: `?crowd=4`, or decimated fan meshes.

## Harnesses

```bash
cd games/hero-moves && npm run build && npx vite preview --port 4188 --strictPort &
node tools/arena-shots.mjs out/ --heroes=/path/A.vrm --fans=/path/B.vrm,/path/C.vrm --vp=390x844,844x390   # start / play / end
node tools/arena-record.mjs plan.json out/      # bot-played footage, frame-stepped, with real touches
node tools/arena-perf.mjs --hero=/path/A.vrm --fans=/path/B.vrm,/path/C.vrm --throttle=4   # real-time fps, CPU per frame, draw calls
node tools/arena-crowdcheck.mjs                 # nothing hittable is a hero; who is in the stands, per player
node tools/arena-stick.mjs out/                 # the stick's hint, float and dismissal, checked and photographed
```

`?manual=1` stops the page's own loop so a harness steps it exactly 1/30 s a
frame: smooth footage from a machine that renders at 8 fps. `?sample=Superstar`
plays one of the shipped sample heroes without the app.
