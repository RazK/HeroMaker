# Robot Rumble

A camera-free mini-game starring the player's own hero. Other children's
heroes from the gallery — and wind-up toy robots — come into a walled
play-room and head for the toy chest at the back; the hero runs them down with
a thumb stick and bops them, jumps the bouncy balls that roll across, and
ground-pounds a crowd. 75 seconds, a score, a best score, a victory dance.

## Rival heroes: tag, not a fight

The characters you bop are real Editors' choice heroes
(`GET /api/creations/?featured_only=true`, their `opt_avatar.vrm`, the same
loader as the player's), so every round is a parade of what the gallery has
made. They are other children's creations, so a bop is a game of tag: the
rival tumbles onto its bottom (`Hit_Knockback`), sees stars turned toward the
camera (`Dizzy`, three cartoon stars round its head), waves (`Greeting`) and
runs off (`Run_Anime`) — never breaking, never "dying". Its name pops up
small: "Bopped Panda Pals!". The player's own hero is never a rival. Up to
four load in the background after the player's hero; until they arrive (or
with no gallery, on GitHub Pages) the wind-up robots carry the round alone,
and they stay in as fillers between rivals. Two rivals on screen at a time,
three after the first half. `src/arena/rivals.ts`.

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

* Rivals and robots enter at the *front* edge (the camera's side) and walk
  away toward the chest at the back, so the hero meets them face to face; a
  bopped rival turns to the camera to see stars and wave.
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

That is the current game: a 9 m walled room, spawns spread wall to wall, and
rival heroes. The small first room with robots only measured 74-81% facing the
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
| Run | Left thumb stick — re-centres where the thumb lands, dead zone, full speed at 70% throw | Arrows / WASD |
| Punch | Big grape button — a 3-hit combo (left jab, right jab, cross) when tapped in rhythm; auto-aims at the nearest target in reach | J or F |
| Jump | White button — hop the bouncy balls (+50 "Nice jump!"), pop balloons in the air | K or Space |
| Ground pound | Punch while in the air — shockwave smashes everything within 2.3 m | Jump, then J |

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
| Rival walk / dizzy / wave | `Walk`, `Dizzy`, `Greeting` | a rival hero waddles in; after a bop it sees stars and waves goodbye |

## The chooser's posters

The app's "Pick a game" sheet shows each game behind a poster, not a
screenshot: key art rendered offline from a real gallery hero — Violet Volt
(by Maya, 6), the girl from the HeroMaker logo. `poster.html` stages her at the
best frame of a real clip (Robot Rumble: a flying cross punch with wind-up
robots tumbling out of it; Dance party: a dance move under two spotlights with
music notes), a low three-quarter-front camera, a hard warm rim light, brand
rays and the app's sun behind her, a blurred far layer and a vignette. Both
share the composition so they read as a set; the card itself carries the
title in the display face.

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

* Rival hero bopped 150, robot 100, balloon 50, crate 25 a knock and 250 to break (3 knocks or one
  ground pound), ball jumped 50. Gold balloon: +5 seconds.
* Hits within 2.6 s keep a combo; every 5 hits raises the multiplier (max x5).
* A robot that reaches the chest dives in ("Oh no!") and breaks the combo.
  Being bumped by a ball breaks it too. Nothing ends the round early — kids
  always get their 75 seconds and their dance.
* Spawns escalate over the round: robots every 1.7 s down to 0.8 s, often two
  at a time after the first third; balls from 12 s.
* Best score: `localStorage`, guarded; a private window keeps it for the visit.

## Performance

One skinned VRM (plus its drawn outline), the room, and every toy as one
merged vertex-coloured mesh with a painted blob shadow; all particles in one
`Points` call; no shadow maps. Measured with `tools/arena-perf.mjs`:

* **26-28 draw calls, ~64k triangles** with the panda (the heaviest of the
  three), **1.6-1.9 ms of JavaScript per frame** — a tenth of a 60 fps budget.
* This sandbox has no GPU; in software rendering (SwiftShader) the page runs
  at 6-8 fps at 390x844, which is the rasteriser, not the game. Not measured on
  a phone yet.
* If a device averages under ~40 fps for two seconds of play, the page drops
  its pixel ratio once.

## Harnesses

```bash
cd games/hero-moves && npm run build && npx vite preview --port 4188 --strictPort &
node tools/arena-shots.mjs out/ --heroes=/path/A.vrm,/path/B.vrm --vp=390x844,844x390   # start / play / end
node tools/arena-record.mjs plan.json out/      # bot-played footage, frame-stepped, with real touches
node tools/arena-perf.mjs --hero=/path/A.vrm    # real-time fps, CPU per frame, draw calls
```

`?manual=1` stops the page's own loop so a harness steps it exactly 1/30 s a
frame: smooth footage from a machine that renders at 8 fps. `?sample=Superstar`
plays one of the shipped sample heroes without the app.
