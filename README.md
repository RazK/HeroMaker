# HeroMaker – Real-Time Pose Driven Animation

This branch adds a browser-based performance capture workflow that streams MediaPipe pose landmarks from your webcam into the existing Three.js viewer. You can watch the live feed on the left, debug landmarks & FPS, and see a rigged GLB respond in real time on the right.

## What's Inside
- **Split-pane UI** – Responsive layout with webcam feed + overlay on the left and the original viewer on the right.
- **MediaPipe Pose** – Uses `@mediapipe/tasks-vision@0.10.0` (CDN) to detect 33 landmarks with <30 ms latency on modern laptops.
- **Skeleton overlay** – Landmarks + bone connections rendered over the live feed for debugging.
- **Pose → Rig retargeting** – Landmarks are converted into joint directions and applied to common rig names (Mixamo-style bone labels are supported out of the box).
- **Fallback controls** – You can still play baked GLB animations or the synthetic oscillator when pose tracking is paused.

## Prerequisites
- Node.js 18+ (for the tiny asset server).
- A WebGL2-capable browser (Chrome, Edge, Arc, or Firefox) with camera access.
- A rigged GLB (Mixamo or Meshy exports work best). `Load Default` streams the bundled Orc sample.

## Local Runbook
1. **Start the model server**
   ```bash
   cd backend
   node server.js
   ```
   The server exposes `http://localhost:3000/api/model/example` and streams `assets/3D/examples/Orc/Meshy_Merged_Animations.glb`.

2. **Serve the frontend**
   ```bash
   cd frontend
   npx http-server . -p 4173   # or use VSCode Live Server / `python -m http.server`
   ```
   Navigate to `http://localhost:4173/viewer.html`.

3. **Load a model**
   - Click **Load Default** to pull the Orc sample, or
   - Click **Load File** and select any local `.glb/.gltf` that contains a skinned mesh.

4. **Stream your pose**
   - Click **Start Tracking** for a live webcam feed.
   - Grant camera permission when prompted and keep your upper body within frame; FPS/latency overlay updates every ~0.5 s.
   - **Play Demo Video** loads the bundled yoga clip (see below) and loops it through MediaPipe.
   - **Stream Video URL** accepts any HTTPS MP4/WebM link that allows cross-origin playback (e.g., raw CDN files, S3 objects, GitHub Releases). Paste the URL, press the button, and the left pane will treat it like a webcam feed.
   - Click **Stop Tracking** to release whichever source is active; the UI also auto-pauses if the tab loses focus.

5. **Debugging tips**
   - Toggle **Wireframe** or **Skeleton** from the right-side HUD for rig inspection.
   - Use the **Movement Synthesizer** panel to drive the rig procedurally when no webcam is available (disabled while pose tracking is active).
   - Watch the **Pose ➜ Rig mappings** counter in the left pane to confirm how many bones were matched.

## Extending the Retargeter
- Bone matching uses lowercase substring checks (`mixamorigLeftArm`, `LeftArm`, etc.). You can augment `RETARGET_BONE_CONFIG` inside `frontend/viewer.html` with additional bone names or landmarks.
- Landmark → rig directions live in `frontend/mediapipe_to_meshy.js`; extend this helper if you need extra joints (hands, fingers, props, etc.).
- Landmarks currently leverage MediaPipe world coordinates. If your rig expects a different rest axis, tweak the `axis` vector per config entry.
- For hand/finger animation, add new entries that look at wrist → index/pinky landmarks.

### Bundled Yoga Demo Video
- File: `frontend/media/yoga_flow_demo.mp4` (≈20 MB, 3 min clip).
- Source: [Yoga With Les – Class 10 preview](https://archive.org/details/YogaWithLesClass10-YogaForAbs) (Internet Archive, public/community media).
- Use **Play Demo Video** to route MediaPipe through this clip whenever a webcam isn't available.
- Swap in your own footage by replacing the file (keep the same name) or by editing `DEMO_VIDEO_URL` inside `viewer.html`.
- To mirror the user's suggested YouTube Short (`https://youtube.com/shorts/ZGwEgwLFf_k`), download it locally first (YouTube suppresses direct MP4 playback without credentials). Example:
  ```bash
  pip install --user yt-dlp
  ~/.local/bin/yt-dlp -o frontend/media/yoga_flow_demo.mp4 https://youtube.com/shorts/ZGwEgwLFf_k
  ```
  After the file is in place, reload the frontend and click **Play Demo Video**.

### Remote Video URL Tips
- Only direct video file URLs (MP4/WebM) can be streamed due to browser security—platform pages (YouTube, Vimeo, etc.) usually require downloading the file first.
- The request is made client-side, so the host must permit CORS. If the stream fails, consider proxying the file through the backend or hosting it on an S3 bucket with `Access-Control-Allow-Origin: *`.

## Troubleshooting
| Symptom | Fix |
| --- | --- |
| Pose FPS stays at 0 | Ensure camera permission is granted and no other app is holding the device. |
| Model looks twisted | Confirm the GLB uses Mixamo-style bone names or extend the mapping list. |
| Default model fails to load | Make sure `node backend/server.js` is running and that CORS blockers/extensions are disabled. |
| Webcam laggy | Reduce the browser tab resolution, close other GPU-heavy apps, or switch to `pose_landmarker_lite` (swap the model URL). |

## 3rd-Party Assets
- [Three.js 0.160](https://threejs.org/) (imported via CDN/ESM).
- [MediaPipe Tasks Vision 0.10](https://developers.google.com/mediapipe) for pose detection (WebAssembly runtime streamed from jsDelivr).

No npm dependencies were added; everything runs client-side through ES modules.

## Next Ideas
- Support drag-and-drop GLBs directly onto the viewport.
- Persist simple bone retarget profiles for non-Mixamo rigs.
- Record short pose clips to `.json` for offline debugging or unit tests.

Feel free to open an issue or PR if you experiment with different rigs or landmarks!
