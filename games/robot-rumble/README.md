# Robot Rumble

A camera-free mini-game starring the player's own hero. Wind-up toy robots
march in from the front of a play-room toward the toy chest at the back; the
hero runs them down with a thumb stick, punches them into confetti, jumps the
bouncy balls that roll across, and ground-pounds a crowd. 75 seconds, a score,
a best score, a victory dance.

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

* The robots enter at the *front* edge (the camera's side) and walk away
  toward the chest at the back. To stop one, the hero stands between it and
  the chest and faces it — which is facing the camera.
* Balloons, crates and gold balloons only appear in the front half of the room.
* Standing still, the hero turns to the nearest target *on the camera's side*,
  or settles three-quarters toward the camera.
* The punch auto-aim breaks ties toward the camera.
* Running straight away from the camera, the body leans up to ~30° back
  toward it (a cross-step), so the worst case shows a cheek, not a full back.

**Measured, not hoped.** `Game.facing` integrates, every frame of play, where
the hero's facing points relative to the camera. A bot plays whole rounds with
real touch input (`tools/arena-record.mjs`); over three full 75 s rounds:

| Hero | Facing the camera's half | Front (within 60°) | Front 3/4 or profile | Back 3/4 | Full back |
|---|---|---|---|---|---|
| Curly Carl (tall human) | **77%** | 60% | 17% | 12% | 11% |
| Panda Pals (wide, round) | **75%** | 64% | 11% | 14% | 11% |
| Cuppy Penguin (blocky) | **74%** | 56% | 18% | 16% | 9% |

The first version (robots killed while still off-screen, toys spawning
anywhere, an idle that faced the last direction run) measured 55%. Every change
in the list above was made against that number.

## Controls

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

Source: Quaternius' **Universal Animation Library, CC0**, as redistributed by
`scottpetrovic/mesh2motion-app` — fetched and trimmed to one clip per file by
`games/hero-moves/tools/fetch-animations.mjs` (~70 KB each). No other assets:
the room, robots, balloons, crates and balls are primitives painted at boot,
and every sound is synthesised (`src/arena/sfx.ts`).

## Rules

* Robot 100, balloon 50, crate 25 a knock and 250 to break (3 knocks or one
  ground pound), ball jumped 50. Gold balloon: +5 seconds.
* Hits within 2.6 s keep a combo; every 5 hits raises the multiplier (max x5).
* A robot that reaches the chest dives in ("Oh no!") and breaks the combo.
  Being bumped by a ball breaks it too. Nothing ends the round early — kids
  always get their 75 seconds and their dance.
* Spawns escalate over the round: robots every 2.3 s down to 0.85 s, two at a
  time after half-time; balls from 12 s.
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
