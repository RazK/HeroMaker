# GLB Avatar Support — Development Plan

**Purpose of this file:**  
Instructions for an AI coding assistant working on my Mac.  
We move in **very small, testable steps**.  
After each step:

1. AI updates code.
2. AI runs the app / tests.
3. AI tells me **exactly what to do and what to look at** in the UI.
4. **Only if I say “OK / works”**, we `git commit` and move to the next step.

---

## Note on Codebase Choice (Important Context)

The original **Kalidoface-3D** GitHub repo only contains the **built bundle** (`docs/` with minified JS/CSS and an `index.html`) and **no `src/` directory** anywhere in its Git history.  
That means we **cannot safely refactor** its rigging or UI — there is no readable source to modify.

Therefore, for this plan:

- “**The app**” means a **small VRM tracking demo** that we own and can edit, based on the **Kalidokit VRM sample** (Mediapipe Holistic + Kalidokit + Three.js + three-vrm).
- We are **not** modifying the original Kalidoface-3D source (it’s unavailable).  
- Instead, we are building a **new, minimal app** that:
  - Uses the *same tech stack* (Mediapipe + Kalidokit + Three.js + VRM),
  - Adds a pluggable rig abstraction (`AvatarRig`),
  - Adds GLB avatar support (`GlbAvatarRig`),
  - Prepares for a Meshy-based GLB pipeline.

You can name this new repo whatever you want (for example: `avatar-rig-lab`).  
This plan assumes we are working **inside that editable repo**.

---

## Ground Rules

**For the AI (very important):**

- Work on a **single feature branch**, e.g. `feature/glb-avatar-support`.
- **One small logical change per step**, each ending in a commit.
- Before suggesting a commit, always:
  1. Run the relevant commands (at least `npm run dev` or `npm test` if it exists).
  2. Confirm the app builds and starts successfully.
  3. Give me a **“USER TEST” block** with clear manual testing instructions:
     - Which URL to open
     - What buttons / controls to use
     - What I should see / verify
- Wait for my confirmation that the step works before moving on.
- Use **clear, short commit messages**, e.g.:
  - `chore: add GLB plan document`
  - `refactor: introduce AvatarRig interface`
  - `feat: basic GLB loading into scene`
  - `feat: apply kalidokit pose to GLB hips`

When in doubt: **make the step smaller.**

---

## Step 0 – Preconditions (Manual)

**What I (the user) do manually (no AI needed):**

1. Create a **new repo** for this work, for example:

   ```bash
   mkdir avatar-rig-lab
   cd avatar-rig-lab
   git init
   ```

2. Initialize a minimal Vite-based app (Vanilla or Svelte – your choice). For example, with Vite + Vanilla:

   ```bash
   npm create vite@latest .   # choose vanilla or vanilla-ts
   npm install
   ```

3. Install the dependencies we will need:

   ```bash
   npm install three @mediapipe/holistic @mediapipe/camera_utils @mediapipe/drawing_utils
   npm install kalidokit
   npm install three-vrm
   ```

4. (Optional but recommended) Clone the **Kalidokit** repo somewhere else just as a **reference** so we can peek at the VRM sample code:

   ```bash
   cd ..
   git clone https://github.com/yeemachine/kalidokit.git
   ```

   You don’t need to modify that repo; it’s just for reading / copying patterns if useful.

5. Add this `PLAN.md` file to the root of `avatar-rig-lab` so the AI can follow it.

Once this is done, we switch into the new repo and start from **Step 1**.

---

## Step 1 – Add This PLAN.md to the Repo

**Goal:** Put this file in the repo so all later steps are grounded.

**AI tasks:**
1. Ensure `PLAN.md` exists in the project root with the content of this plan.
2. No code changes besides adding this file.

**Commands AI should run:**
- None required beyond ensuring the repo is still clean.

**USER TEST:**
- Open the repo in the editor and verify `PLAN.md` exists and looks correct.

**If OK, then AI asks me to run:**

```bash
git status
git add PLAN.md
git commit -m "chore: add GLB development plan"
```

---

## Step 2 – Create a Minimal VRM Tracking Baseline

**Goal:** Ensure we have a tiny, working VRM-based app before we touch rig abstractions.

**AI tasks:**
1. Set up a **very simple** app entry (e.g. `src/main.ts` or `src/main.js`) that:
   - Creates a Three.js scene, camera, and renderer.
   - Sets up Mediapipe Holistic and Kalidokit to read webcam frames.
   - Loads **one VRM avatar** (either from a local file or remote URL) using `three-vrm`.
   - Applies Kalidokit pose/face to the VRM in the simplest way (it can be borrowed from the Kalidokit VRM sample).
2. Wire this up so `npm run dev` starts the Vite dev server and shows:
   - A canvas with the avatar.
   - Webcam tracking that moves the VRM roughly with my body/face.

**Commands AI should run:**

```bash
npm run dev
```

**USER TEST:**
- Open the app in the browser at the URL Vite prints (e.g. `http://localhost:5173`).
- Confirm:
  - Webcam access prompt appears.
  - The VRM avatar loads and moves roughly with my face/body.

**If OK, then AI asks me to run:**

```bash
git status
git add .
git commit -m "feat: add minimal VRM tracking demo (Mediapipe + Kalidokit + three-vrm)"
```

---

## Step 3 – Create Rig Folder & AvatarRig Interface Skeleton

**Goal:** Prepare structure for VRM/GLB abstraction without changing behavior.

**AI tasks:**
1. Create folder: `src/rig/`
2. Add `src/rig/AvatarRig.ts` with a minimal interface:

```ts
export interface AvatarRig {
  updateFromKalidokit(data: {
    face?: any;
    pose?: any;
    leftHand?: any;
    rightHand?: any;
  }): void;
}
```

3. No usage yet; no logic changes.

**Commands AI should run:**

```bash
npm run dev
```

**USER TEST:**
- Confirm app still runs with no TypeScript or runtime errors.
- No behavior change expected.

**If OK, then AI asks me to run:**

```bash
git status
git add src/rig/AvatarRig.ts
git commit -m "chore: add AvatarRig interface skeleton"
```

---

## Step 4 – Extract Current VRM Logic into VrmAvatarRig (No Behavior Change)

**Goal:** Wrap existing VRM rigging logic inside a `VrmAvatarRig` class, but keep the behavior identical.

**AI tasks:**
1. Find where VRM is currently loaded and animated (Kalidokit results applied to VRM bones/blendshapes).
2. Create `src/rig/VrmAvatarRig.ts` that:
   - Implements `AvatarRig`.
   - Accepts the VRM / related objects in its constructor.
   - Moves the existing bone/blendshape update logic into `updateFromKalidokit(...)`.
3. Adapt existing code:
   - Introduce `let currentAvatarRig: AvatarRig | null = null;`
   - When the VRM model is loaded, instantiate:

     ```ts
     currentAvatarRig = new VrmAvatarRig(vrm /* plus whatever else is needed */);
     ```

   - Wherever Kalidokit outputs were previously applied directly, replace with:

     ```ts
     currentAvatarRig?.updateFromKalidokit({ face, pose, leftHand, rightHand });
     ```

**Commands AI should run:**

```bash
npm run dev
```

**USER TEST:**
- Reload the app.
- Confirm:
  - VRM avatar still appears.
  - Tracking still works as before (no obvious regressions).

**If OK, then AI asks me to run:**

```bash
git status
git add src/rig/VrmAvatarRig.ts src/**  # (only the relevant changed files)
git commit -m "refactor: introduce VrmAvatarRig implementing AvatarRig"
```

---

## Step 5 – Ensure VRM Path Is Stable After Refactor

**Goal:** Sanity check refactor with no new features.

**AI tasks:**
1. Quickly review the diff to ensure:
   - No functional changes besides routing through `currentAvatarRig`.
2. If there are any conditionals/safety checks missing, add them.

**Commands AI should run:**

```bash
npm run dev
```

**USER TEST:**
- Again, verify:
  - No console errors.
  - VRM still reacts to my movements.

**If OK, then AI asks me to run:**

```bash
git commit --allow-empty -m "chore: confirm VrmAvatarRig refactor stable"
```

---

## Step 6 – Add GLB File Acceptance (UI Only, No Loading Yet)

**Goal:** Let the UI accept `.glb` files and show a clear message, but **not** actually load the model yet.

**AI tasks:**
1. Add a basic file input or drag-and-drop area in the UI for avatar files.
2. Extend it so that:
   - It accepts both `.vrm` and `.glb` file extensions.
   - If `.glb` is chosen/dropped:
     - For now, show a simple log or UI message:

       > `GLB support: file received, loading not implemented yet.`

   - VRM path remains unchanged.

**Commands AI should run:**

```bash
npm run dev
```

**USER TEST:**
- In the UI, use the input/drag-drop:
  - Select a `.vrm` file → should behave as before.
  - Select a `.glb` file → should not crash; I should see a clear message that GLB is recognized but not yet loaded.

**If OK, then AI asks me to run:**

```bash
git status
git add src/**  # only the files touched for drop handling / messages
git commit -m "feat: accept GLB files in UI with placeholder message"
```

---

## Step 7 – Implement Basic GLTFLoader and Static GLB Display

**Goal:** Load and display a static GLB avatar in the Three.js scene (no animations yet).

**AI tasks:**
1. Add Three.js `GLTFLoader` import where appropriate:

```ts
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
```

2. On `.glb` selection/drop:
   - Use `GLTFLoader` to load the model into the existing scene.
   - Position it similarly to the VRM avatar (roughly same scale/position).
   - For now, **do not** connect it to `AvatarRig` or Kalidokit.
3. Ensure that loading a GLB **replaces** or clearly co-exists with the VRM avatar (no overlapping confusion).

**Commands AI should run:**

```bash
npm run dev
```

**USER TEST:**
- Select/drag & drop a `.glb` humanoid model.
- Expectation:
  - See the GLB model in the scene.
  - It remains static (no movement).
  - VRM path still works when loading a `.vrm` instead.

**If OK, then AI asks me to run:**

```bash
git status
git add src/**
git commit -m "feat: load and display GLB models in scene (static)"
```

---

## Step 8 – Create GlbAvatarRig and Map Only Hips Rotation

**Goal:** First minimal Kalidokit → GLB bridge: drive only the hips bone.

**AI tasks:**
1. Create `src/rig/GlbAvatarRig.ts`:
   - Implements `AvatarRig`.
   - In the constructor:
     - Accepts a GLB root object (e.g. `THREE.Object3D`).
     - Builds a `boneMap` by traversing and collecting bones by name.
   - In `updateFromKalidokit`:
     - For now, only:
       - Retrieve `pose` data.
       - Apply rotation to a single bone (e.g. `Hips`).
     - Use a hard-coded bone name first (we’ll make it configurable later).
2. When a GLB is loaded:
   - Instantiate:

     ```ts
     currentAvatarRig = new GlbAvatarRig(glbRoot);
     ```

3. Ensure that VRM uses `VrmAvatarRig`, GLB uses `GlbAvatarRig`.

**Commands AI should run:**

```bash
npm run dev
```

**USER TEST:**
- Load a `.glb` humanoid and allow webcam tracking.
- Move my body enough that hips rotation should change.
- Expectation:
  - The GLB might move subtly (only hips), maybe not perfect, but:
  - No crashes.
  - Some visible reaction to my movement (even if weird).

**If OK, then AI asks me to run:**

```bash
git status
git add src/rig/GlbAvatarRig.ts src/**
git commit -m "feat: introduce GlbAvatarRig with basic hips rotation"
```

---

## Step 9 – Add Configurable Bone Map (`glbRigConfig.json`)

**Goal:** Replace hard-coded bone names with a configurable mapping file.

**AI tasks:**
1. Create `src/rig/glbRigConfig.json` with a starting mapping, e.g.:

```json
{
  "hips": "Hips",
  "spine": "Spine",
  "chest": "Chest",
  "neck": "Neck",
  "head": "Head"
}
```

2. Update `GlbAvatarRig`:
   - Import this JSON.
   - Look up bones by `glbRigConfig` values instead of hard-coded strings.
3. Still only apply rotations to hips (and maybe spine if safe), using the config.

**Commands AI should run:**

```bash
npm run dev
```

**USER TEST:**
- Load the same GLB and verify:
  - Behavior is at least as good as before (maybe slightly improved).
  - No errors related to missing bones if names match.

**If OK, then AI asks me to run:**

```bash
git status
git add src/rig/glbRigConfig.json src/rig/GlbAvatarRig.ts
git commit -m "feat: use configurable bone map for GLB rig"
```

---

## Step 10 – Expand GLB Rig: Spine, Head, Arms (Still Minimal)

**Goal:** Make the GLB avatar movement visibly closer to VRM behavior.

**AI tasks:**
1. Extend `glbRigConfig.json` with more entries:

```json
{
  "hips": "Hips",
  "spine": "Spine",
  "chest": "Chest",
  "neck": "Neck",
  "head": "Head",
  "leftUpperArm": "LeftArm",
  "leftLowerArm": "LeftForeArm",
  "rightUpperArm": "RightArm",
  "rightLowerArm": "RightForeArm"
}
```

2. Update `GlbAvatarRig.updateFromKalidokit`:
   - Apply pose rotations to hips, spine, chest, head, upper/lower arms.
   - Use the same conventions as `VrmAvatarRig` as much as possible.

**Commands AI should run:**

```bash
npm run dev
```

**USER TEST:**
- Load a GLB humanoid and compare visually with VRM:
  - Move arms, lean body, etc.
  - GLB should more clearly follow my movements (still not perfect, but obviously animated).

**If OK, then AI asks me to run:**

```bash
git status
git add src/rig/glbRigConfig.json src/rig/GlbAvatarRig.ts
git commit -m "feat: apply kalidokit pose to GLB spine, head and arms"
```

---

## Step 11 – Add Simple UI Indicator for Avatar Type

**Goal:** Make it clear whether the current avatar is VRM or GLB.

**AI tasks:**
1. In the main UI, add a small indicator:
   - `"Avatar: VRM"` or `"Avatar: GLB"` depending on what’s currently loaded.
   - Use minimal styling, no redesign.
2. Wire it so it updates when:
   - A VRM is loaded.
   - A GLB is loaded.

**Commands AI should run:**

```bash
npm run dev
```

**USER TEST:**
- Load a VRM → see `"Avatar: VRM"`.
- Load a GLB → see `"Avatar: GLB"`.
- Confirm tracking still works for both.

**If OK, then AI asks me to run:**

```bash
git status
git add src/**
git commit -m "feat: show current avatar type (VRM/GLB) in UI"
```

---

## Step 12 – Add Basic URL-based GLB Loader Hook (Future Meshy Integration)

**Goal:** Provide a simple function to load GLBs from URL (local or remote), as a future hook for Meshy.

**AI tasks:**
1. Create `src/meshy/meshyHooks.ts` with:

```ts
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type * as THREE from 'three';

export function loadMeshyGlbFromUrl(
  url: string,
  scene: THREE.Scene
): Promise<THREE.Object3D> {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const root = gltf.scene;
        scene.add(root);
        resolve(root);
      },
      undefined,
      reject
    );
  });
}
```

2. (Optional) Add a very simple text input or dev-only UI where I can paste a URL and call this function.
3. When a GLB is loaded via URL:
   - Instantiate `new GlbAvatarRig(root)` and set `currentAvatarRig`.

**Commands AI should run:**

```bash
npm run dev
```

**USER TEST:**
- Paste a valid GLB URL (if I have one).
- Confirm:
  - Model appears.
  - It moves with Kalidokit pose (same as dropped GLB).

**If OK, then AI asks me to run:**

```bash
git status
git add src/meshy/meshyHooks.ts src/**
git commit -m "feat: add URL-based GLB loader hook for future Meshy integration"
```

---

## Step 13 – Document How to Use GLB + Meshy (Draft)

**Goal:** Brief docs for future me on how to use this pipeline.

**AI tasks:**
1. Create `docs/GLB-RIGGING.md`:
   - Short explanation of:
     - `AvatarRig`, `VrmAvatarRig`, `GlbAvatarRig`.
     - `glbRigConfig.json` and how to change bone names.
     - How to drop local `.glb` models.
     - How to use `loadMeshyGlbFromUrl` (if configured).
2. No code changes, just documentation.

**Commands AI should run:**

```bash
# No build needed, but optional:
npm run dev
```

**USER TEST:**
- Open `docs/GLB-RIGGING.md` and see if it’s clear and accurate.

**If OK, then AI asks me to run:**

```bash
git status
git add docs/GLB-RIGGING.md
git commit -m "docs: add GLB rigging and usage guide"
```

---

## After These Steps

At this point, we should have:
- Stable VRM tracking using `VrmAvatarRig`.
- Working GLB tracking using `GlbAvatarRig`.
- A configurable bone map (`glbRigConfig.json`).
- A basic URL loader hook for Meshy.
- A clear Git history of **tiny, testable steps**, each validated manually.

Future work (not part of this plan):
- Better head/eye/face rig for GLB.
- Standardizing on a “Meshy 24-joint” naming convention.
- More robust calibration / scaling for different GLBs.
- Production-ready UI / UX improvements.
