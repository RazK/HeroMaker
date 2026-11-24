# Backlog

Things Raz or the team raised that do **not** fit the running sprint. The PM
triages every new ask into *this sprint* or here, so nothing is lost and we
progress sprint to sprint (`RAZ_RULES.md` → "Protect the running sprint").

Newest first. When an item enters a sprint, move it to `SPRINT_LOG.md`.

## Open

### Teacher: "Add seats" is hidden when a class is full (money-moment friction)
- **From:** Liran + Anat, 2026-11-24, found while recording the teacher not-happy
  flow. When a class fills, the teacher's live board gives no visible way to add
  seats — "Add seats" sits in the `...` menu. A teacher in front of 30 kids will
  not find it.
- **Why it matters:** paying for more seats IS the teacher money moment. Hidden
  friction here loses money at the exact point the class wants to grow.
- **Want:** a visible "Class full → Add seats" affordance on the board itself.
- **Scope:** small. Maya designs the button first (board, phone + desktop), Raz
  approves, then Liran builds. **Next sprint — before the first real paid class
  / Schneider (10 Dec).** Not tonight's demo sprint.

### Studio view: one carousel spine, no chapter cards
- **From:** Raz, 2026-11-23. He dislikes the current hero/studio interface.
- **Want (his vision):** the hero page is one swipeable carousel through the
  creation stages — **drawing → painting → 3D → toy**. The **progress bar and
  the carousel cursor are the same element**: an icon per stage along a path, a
  cursor marking where you are, **green** where a stage is being created. You
  swipe along it. As you move past the drawing it **shrinks into a small
  polaroid in a corner** and stays there through every stage; **tapping that
  polaroid jumps back to step 1** (the drawing / upload view).
- **Kill:** the separate chapter cards / tiles ("Drawing · Painting · 3D hero")
  — they take space and add noise. This also removes the self-hiding
  current-chapter tile that causes the **"chapter cards reshuffle"** bug.
- **Why it matters:** one element does two jobs (progress + navigation); the
  persistent drawing polaroid keeps the "this drawing became this" story alive;
  less on screen, clearer meaning. Serves money moment #1 (the reveal).
- **Absorbs:** the **paywall** becomes one state of this carousel (the "3D
  locked → bring it to life" stop). Paywall Option 2 (corner polaroid) is the
  same direction, so build the paywall as part of this rather than twice. The
  **camera** is step 1 of the same flow.
- **Scope:** the whole hero/studio view (`HeroLive.tsx`, `HeroScreen.tsx`,
  the carousel + stepper). Big. **Next sprint.** Maya designs first (one
  spine, phone + desktop), Raz approves, then build.
- **Gallery view:** Raz is happy with it — no change.

### Design the payment experience (it has never been designed)
- **From:** Raz, 2026-11-23. He has never *seen* a payment screen; none has been
  designed. Payments work under the hood (test-mode checkout, webhook, credits,
  receipts; the robot buys a pack every run) — but the UX is undesigned.
- **Want:** a real, on-brand payment experience as a first-class money moment —
  the **"Bring it to life" → pick a pack → pay → "credits added / done"** flow,
  the return from checkout, the receipt. Not the raw "Buy credits" sheet and a
  bare external page.
- **Why it matters:** this is THE money. It must feel trustworthy and simple.
- **Fits with** the studio-view redesign above (the "Bring it to life" stop
  leads into it). Maya designs; Raz approves; then build. **Next sprint.**
- **Interim:** show Raz the real Buy-credits → checkout → credits-land flow on
  staging (a morning video), so he sees payments function today.
- **Two payment bugs found 2026-11-23 (owner: Gidi), to fix with this:**
  1. The "Pick a pack" sheet hard-codes **"Payments by Lemon Squeezy"**
     (`frontend/src/components/BuyCredits.tsx:115`), but staging (and maybe
     production) sells through **Grow**. The label must follow the real
     provider, or be generic. Visible to the buyer.
  2. A **Grow order's receipt has `order_number = null`**, so a buyer's receipt
     carries no reference to quote. Small backend fix: store the order id on the
     receipt.

### Low-friction / anonymous start — carrots before sticks
- **From:** Raz, 2026-11-23.
- **Problem:** making the first hero sends the user to a form (sign-up /
  details) **before** they see anything. Friction right at the door.
- **Want:** let people start **anonymously** — upload the drawing and see the
  magic (the painting) **first**, with no form. Bring the "bureaucracy"
  (account, details) only when it is really needed — to **save** the hero or to
  **pay**. Carrots before sticks.
- **Why it matters:** aligns with `MONEY_MOMENTS.md` (pay at the peak, not
  before it) and experiment E-006 (pay after the painting). Less upfront
  friction → more people reach the reveal → more paid heroes.
- **Needs:** product + design (Maya) + a make-flow rework. **Depends on** the
  camera and paywall redesigns (both in the current sprint). So: **next
  sprint**, after those land.

### Build the new paywall + camera screens
- After Raz approves Maya's new designs (this sprint produces the designs), the
  build + the full make-flow videos are **next sprint**.
