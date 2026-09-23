# Claude Instructions for HeroMaker

## Git & PR Rules

- **One PR per logical unit.** Even if given a list of tasks, work on them one at a time — separate branch, separate PR per topic (e.g. bug fixes, docs, new features are never mixed).
- Finish and open a PR for the current topic before starting the next one.

## Python / Venv

- **Always use the project venv**, never bare `python` or `python3`.
- Venv lives at `.venv/` in the project root (worktrees have a symlink pointing to main repo `.venv`).
- Run Python scripts as: `.venv/bin/python <script>`
- Run pip as: `.venv/bin/pip`

## Shared tooling

### `scripts/optimize_vrm.py` — shrink a pipeline VRM ~5.5x, losslessly to the eye

Use this before serving, embedding or previewing any avatar the pipeline
produced. Measured over 30 production avatars, **every single one** wastes
**~1.46 MB (21% of the file) on a VRM metadata thumbnail that nothing ever
renders**, and ships its texture as a ~2.5 MB PNG that re-encodes to ~110 KB of
WebP with no visible difference.

```bash
.venv/bin/python scripts/optimize_vrm.py in.vrm out.vrm [--size=1024] [--quality=88]
# typical: 5.5 MB -> 1.2 MB, verified visually identical
```

What it does, all reversible by re-running the pipeline:
- drops the unused VRM meta thumbnail
- re-encodes the avatar texture as WebP at a sane resolution
- packs indices/joints/weights to the smallest glTF **core spec** types — no
  extensions, so every loader still reads the result
- inlines the texture as a `data:` URI, which also makes it load under a strict
  CSP where a `blob:` URL would be refused

### `scripts/optimize_vrma.py` — halve a downloaded animation clip

The pipeline maps 22 humanoid bones. A `.vrma` from the wild animates whatever
its author rigged — typically 51 bones, **30 of them fingers we do not have**.
Every one of those channels is decoded, sampled and interpolated onto joints
that do not exist, and downloaded first.

```bash
.venv/bin/python scripts/optimize_vrma.py in.vrma out.vrma   # 118 KB -> 53 KB, 56% smaller
.venv/bin/python scripts/optimize_vrma.py in.vrma --check    # report, write nothing
```

Measured on the sample pack and verified by playing the result back: identical
motion, 56% fewer bytes. Keyframe values, interpolation and timing are
untouched. It is the dead-thumbnail finding one asset type over.

**If you are working on preview/gallery/thumbnail load times, start here** — the
dead-thumbnail finding is a pipeline bug worth fixing at the source
(`vrm-converter-service/`), which would shrink every avatar for every consumer
at once.

## Games

`games/` holds playable experiences built on the pipeline's output. Read
`games/PLAYBOOK.md` before building one — it records the asset's constraints
(22 bones, no fingers, no blendshapes, wildly varying proportions), the
publishing constraints, what a 2D pose tracker can and cannot read on these
avatars, and the process rules that came out of building them. `games/hero-dash`
is parked; `games/README.md` says why and lists what to reuse from it.

### Two capabilities worth knowing about before you build anything

**Any humanoid animation can be played on any hero.** `games/hero-moves/src/anim/`
loads `.vrma` natively and retargets CC0 glTF mocap (Quaternius, CMU) onto the VRM
humanoid. The transform is rotation-only and therefore **proportion-blind** — a
mocap backflip lands correctly on a hero whose head is a third of its height, and
on a cloud with legs. `animlab.html` demos it. **If you are adding motion to
anything — the gallery, a preview, a loading screen — start here rather than
hand-authoring poses.**

**Pose classification is solved; pose scoring is not.** `src/pose/vocab.ts` names
which of eight poses a person is making, measured at 100% across five camera angles
with `tools/posegate.mjs`. The older `scorePose` answers "how close are these two
poses" and tops out much lower. Prefer the classifier.

Live builds: <https://razk.github.io/HeroMaker/hero-moves/> and the camera-free
prototype at <https://razk.github.io/HeroMaker/hero-moves/reel.html>, published
from `staging` by `.github/workflows/pages.yml`.

## Architecture: Local vs Production

| Service       | Local                              | Production (Railway)     |
|---------------|------------------------------------|--------------------------|
| Backend       | Native Python via `.venv`, port 8000 | Docker container        |
| Frontend      | Native `npm run dev`, port 5173    | Docker container (nginx) |
| VRM Converter | Docker container, port 8001        | Docker container         |

- **`start-dev.sh`** is the single command to start everything locally.
- **`docker-compose.yml`** is for production-like full-stack testing only — not used for daily dev.
- Railway deploys from `backend/Dockerfile`, `frontend/Dockerfile`, `vrm-converter-service/Dockerfile`.

## Payments: what is proven, and the trap that hid a bug

**Verified end to end on 2026-09-22** against the real Lemon Squeezy store, in
test mode, on the staging backend: `checkout -> card -> order #4757371 (paid,
$15.00) -> webhook -> 0 to 100 credits -> receipt`. The webhook security model
holds under real HTTP (forged, unsigned and mid-flight-tampered bodies are all
rejected 401; the same order delivered five times credits once). The money path
works.

**The trap:** `backend/scripts/demo_purchase.py` does NOT run the pipeline.
`make_hero` re-implements step execution and performs its own refund, so its
transcript can assert behaviour the product does not have. That is exactly how
"the failed step's credits refunded" passed review while no production code
path had ever called `ledger.refund_credits`. Real cost: a genuine Meshy
failure took 5 credits from a paying user and kept them.

So: **a proof script or test must drive the real code path.** If you are
asserting something about the pipeline, call `pipeline.execute_step`. See
`backend/tests/test_step_refunds.py`, which does, and which goes red if you
revert either refund call site.

**Credits are charged before the provider is called**, so every way a step can
end badly needs a compensating refund. There are two such paths, and the second
is easy to miss:
- the provider error caught by `execute_step`'s `except Exception`
- a timeout, where `task_manager` cancels the task and `CancelledError`
  inherits from `BaseException` — it never reaches that handler

Both call `credits.refund_last_step_charge()`, which is keyed on the spend row
(`refund:tx:<id>`), not on `creation+step`. Spends are deliberately not
idempotent, so a retried step really does cost again; keying on creation+step
would refund the first failure and silently swallow every later one. A user
cancellation deliberately keeps its charge.

**Known blocker, unrelated to any of the above:** the Meshy account is on the
free plan, which Meshy has discontinued (`NoMorePendingTasks`). No hero can
complete on any environment until that is upgraded.

### Buying credits: the API is done, the UI is not (deliberate)

The backend can take money today. The frontend has no way to spend it — PR #25
changed zero files under `frontend/`. **This is a known, accepted gap, not an
oversight to re-report.** The UI is planned as separate work.

If you are the agent building it, everything you need already exists and is
verified against the live store:

```
GET  /api/payments/packs      what is on sale (no margin data leaks to the customer)
POST /api/payments/checkout   {"pack": "<slug>"} -> {"checkout_url": ...}; send the user there
POST /api/payments/webhook    Lemon Squeezy only. Credits are granted HERE, nowhere else.
GET  /api/payments/receipts   the signed-in user's own purchases
```

Rules for that UI:

- Send the buyer to `checkout_url` and nothing else. **The browser must never
  tell the backend a payment happened** — only the signed webhook grants
  credits, and that is the whole security model. On return from checkout, just
  re-read the balance; the webhook usually lands within a second or two.
- Render only the packs `GET /packs` returns. A pack missing its Lemon Squeezy
  variant is omitted on purpose: a price with no working button is worse than
  no price.
- `checkout` answers **503** when the store is unconfigured and **502** when
  Lemon Squeezy refuses. Both are ours, not the customer's — show "payments are
  unavailable right now", not a validation error.
- `price_display` currently renders four decimals (`"$5.0000"`); `packs.py`
  omits the `places=2` that the receipts endpoint passes. Fix it there, not in
  the UI.
- `/packs` lists packs whenever the *variant ids* are set, even if
  `LEMONSQUEEZY_API_KEY` is missing — so a half-configured deployment can show
  a Buy button that 503s. Worth tightening in `packs.get_packs` before launch.
