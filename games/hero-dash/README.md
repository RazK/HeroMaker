# Hero Dash

An endless runner starring the rigged VRM avatars that the HeroMaker pipeline
generates from kids' drawings. Standalone — it does not touch the HeroMaker
frontend or backend at runtime.

Design rationale and scope decisions live in [BRIEF.md](./BRIEF.md).

```
npm install
npm run dev        # http://127.0.0.1:5180
npm run build      # dist/ — normal multi-file build
npm run build:single   # dist/index.html — one self-contained file, no external assets
```

## How it plays

Three lanes, speed ramping from 9.5 to 23 m/s. Collect stars, dodge crayon
blocks, jump the low ones, slide under the limbo bars, and hit the purple
**pose gates** — walls with a star-shaped hole that only let you through if
your hero is in the star pose. Stars and clean gates fill the Hero Power meter;
a full meter triggers **Hero Time**: the hero takes off in a flying pose, the
camera swings around to the front, and everything is magnetised for ~6 s.
Three crashes ends the run.

| Action | Keyboard | Touch | Hero Cam |
|---|---|---|---|
| Change lane | ← → / A D | swipe ←/→ | step left/right |
| Jump | ↑ / W / Space | swipe ↑ | jump |
| Slide | ↓ / S | swipe ↓ | crouch |
| Star pose | Shift / E | tap | arms and legs wide |

## Hero Cam

Optional webcam mode. It does **not** download a pose model — it learns the
empty room, then tracks the player's silhouette against it and reads position,
height and width. That keeps the whole game one self-contained file and means
the mode still works in sandboxes that block external requests.

Calibration is two steps: step out of shot for ~2.5 s, then step back in and
hold still for ~1.3 s. **RE-CENTER** restarts it.

## Avatars

Six real creations from the production gallery are baked into the build. The
pipeline's VRMs are ~5.5 MB each, which is too heavy to ship six of; each is
run through the optimizer first:

```
../../.venv/bin/python tools/optimize_vrm.py in.vrm out.opt.vrm [--size=1024] [--quality=88]
```

It drops the unused VRM meta thumbnail, re-encodes the avatar texture as WebP,
and packs indices/joints/weights down to the smallest types the glTF core spec
allows — no extensions, so any loader still reads the result. Typical result is
5.5 MB → ~1.1 MB with no visible difference.

To add an avatar: optimize it into `public/avatars/<Id>.opt.vrm`, add an entry
to `src/game/roster.ts`, then regenerate the picker thumbnails.

## Animation

Every pose is procedural — there is not a single animation asset in the repo.
Poses are authored in `src/avatar/poses.ts` as per-bone euler rotations on
three-vrm's *normalized* humanoid rig, which is why the same run cycle reads
correctly on a superhero, a bear, a skeleton, a cloud and a five-pointed star
even though their proportions have nothing in common. The axis conventions are
documented at the top of that file — read them before editing a pose.

## Dev tools

| Page / script | What it does |
|---|---|
| `lab.html?a=Crayon_Kid&v=side` | Contact sheet of every animation state. `v` is `front`, `side` or `back`. |
| `thumbs.html` | Renders the picker thumbnails. |
| `tools/shot.mjs URL OUT [waitMs]` | Screenshot one page. |
| `tools/play.mjs URL OUTDIR` | Boots the game, plays a full run with a bot, screenshots as it goes. |
| `tools/showcase.mjs URL OUTDIR` | Same, but captures one shot per gameplay state. |
| `tools/make-thumbs.mjs URL OUTDIR` | Saves the thumbnails from `thumbs.html`. |
| `tools/camtest.mjs URL VIDEO.y4m OUT` | Drives Hero Cam against a synthetic player clip. |
| `tools/pack-artifact.mjs IN OUT` | Strips the document wrapper for publishing as an Artifact, and validates the result. |
| `tools/csp-server.mjs FILE [port]` | Serves the packed page behind an Artifact-like CSP. |
| `tools/make_test_video.py OUT.y4m` | Generates that clip: stands, steps, jumps, crouches, poses. |

The harnesses run headless on SwiftShader at roughly 10 fps, so they set
`TIME_SCALE` to advance game time faster than wall clock. The simulation steps
at a fixed 60 Hz internally, so this changes nothing about collision behaviour.

```bash
npm run build && npx vite preview
PW_EXE=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1) \
  TIME_SCALE=2 node tools/showcase.mjs http://127.0.0.1:5181/ /tmp/shots
```

## Publishing as an Artifact

**Always test through `tools/csp-server.mjs` before publishing.** A published
artifact runs under a strict CSP, and a plain static server does not reproduce
it — the page loads fine locally and then fails in the sandbox. Two rules fall
out of that policy, and both are already handled:

- `connect-src` refuses `fetch()` to `data:`, so `avatar/loader.ts` decodes
  inlined avatars itself and calls `GLTFLoader.parse()` rather than letting the
  loader touch the network.
- `img-src` may refuse `blob:`, which is how GLTFLoader normally serves
  textures packed in a bufferView. `optimize_vrm.py` therefore writes the
  texture as a `data:` URI on the image, and the loader hides
  `createImageBitmap` during load so three falls back to `<img>` instead of
  `fetch()`-ing a blob.

```bash
npm run build:single
node tools/pack-artifact.mjs dist/index.html dist/hero-dash.artifact.html
node tools/csp-server.mjs dist/hero-dash.artifact.html 5197
PW_EXE=... TIME_SCALE=3 node tools/play.mjs http://127.0.0.1:5197/ /tmp/shots
```

## Hall of Fame

Local scores are kept in `localStorage`. When the game is running as a
published Artifact it can also post to a board shared by everyone who opens the
page: that rewrites the page's embedded JSON and republishes it, so it is
behind an explicit button rather than firing on every death.
