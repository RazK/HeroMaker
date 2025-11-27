# 🗺️ Hero Maker Implementation Roadmap

## 📄 Document Overview

| Attribute | Detail |
| :--- | :--- |
| **Document Name** | **Implementation Roadmap** |
| **Document Version** | **1.0** |
| **Strategy** | **Phased Implementation with Derisking** - Start with core, expand progressively |
| **Core Focus** | MediaPipe → Meshy rig conversion (Phase 1 foundation) |

---

## 🎯 Implementation Strategy

**Philosophy:** Derisk incrementally - build debugging tools first, validate with controlled data (single frame → static poses → yoga poses), then integrate MediaPipe conversion. Only move to live video after static and video testing succeed.

**Progression:**
1. **Meshy Model Tools** - View and manipulate models manually
2. **Controlled Testing** - Single frame → Static poses → Yoga poses
3. **MediaPipe Integration** - Static images → Video files → Live webcam
4. **Full System** - Character creation flow → Production polish

**Phases:**
1. **Phase 1:** Core animation interface (derisking with debugging tools and controlled testing)
2. **Phase 2:** Character creation flow (expand to full journey)
3. **Phase 3:** Polish and advanced features (production readiness)

---

## 📦 Phase 1: Core Animation (Derisking Phase)

**Goal:** Prove the core technical capability - MediaPipe pose tracking driving a 3D character in real-time.

**Strategy:** Build debugging tools first, test with controlled data, then integrate MediaPipe conversion.

**Success Criteria:**
- ✅ Meshy model viewing and manipulation tools working
- ✅ Controlled pose testing successful (single frame → static poses → yoga poses)
- ✅ MediaPipe landmarks successfully converted to bone rotations
- ✅ 3D character animates in real-time with <150ms latency
- ✅ Multiple animation source options working (GLB, Synthetic, Manual, Video)
- ✅ Stable, performant pose tracking

**PRs (Pull Requests):**

### PR-1: Core 3D Viewer Setup
- **Scope:** Basic Three.js scene with GLB loader
- **Deliverables:**
  - 3D viewer component
  - GLB model loading (Meshy models)
  - Camera controls (orbit, pan, zoom)
  - Basic lighting
  - Skeleton visualization toggle
- **Dependencies:** None
- **Risk:** Low

### PR-2: Meshy Model Debugging Tools
- **Scope:** Tools to view and manipulate Meshy models for debugging
- **Deliverables:**
  - Bone hierarchy inspector (list all bones)
  - Bone selection/highlighting
  - Bone rotation controls (manual sliders per bone)
  - Reset to T-pose / A-pose
  - Bone direction visualization (show bone axes)
  - Export current pose state
- **Dependencies:** PR-1
- **Risk:** Low
- **Rationale:** Need debugging tools before attempting MediaPipe conversion

### PR-3: Controlled Pose Testing - Single Frame
- **Scope:** Test bone manipulation with static image/pose
- **Deliverables:**
  - Load single image (person standing still)
  - Manual pose editor interface
  - Save/load pose presets
  - Compare pose side-by-side (image vs 3D model)
- **Dependencies:** PR-2
- **Risk:** Low
- **Rationale:** Validate bone manipulation works before adding MediaPipe complexity

### PR-4: Controlled Pose Testing - Static Poses
- **Scope:** Test with controlled static poses
- **Deliverables:**
  - Load multiple static pose images
  - Pose library (T-pose, A-pose, standing, arms up, etc.)
  - Manual pose matching tool
  - Pose comparison metrics
- **Dependencies:** PR-3
- **Risk:** Low
- **Rationale:** Build confidence with known, controlled poses

### PR-5: Controlled Pose Testing - Yoga Poses
- **Scope:** Test with more complex but still controlled poses
- **Deliverables:**
  - Load yoga pose images/videos
  - Frame-by-frame pose matching
  - Pose playback from video frames
  - Validation that complex poses work
- **Dependencies:** PR-4
- **Risk:** Medium
- **Rationale:** Test with more complex poses before live video

### PR-6: MediaPipe Integration (Static)
- **Scope:** MediaPipe Pose Landmarker setup for static images
- **Deliverables:**
  - MediaPipe initialization
  - Single image pose detection
  - Pose landmark extraction from images
  - Landmark visualization overlay
  - Export landmarks to JSON
- **Dependencies:** PR-5
- **Risk:** Medium (MediaPipe setup complexity)
- **Rationale:** Start with static images before video

### PR-7: Pose to Bone Conversion (Static Testing)
- **Scope:** Convert MediaPipe landmarks to bone rotations (static images first)
- **Deliverables:**
  - `mediapipe_to_meshy.js` module
  - Bone direction calculations
  - Rotation computation
  - Bone mapping logic
  - Test with static pose images
  - Visual comparison (MediaPipe pose vs 3D model pose)
- **Dependencies:** PR-6
- **Risk:** **High** (Core technical challenge - but now we have debugging tools!)
- **Rationale:** Test conversion with controlled static poses first

### PR-7b: Pose Comparison Tool (3D → MediaPipe Feedback Loop)
- **Scope:** Render 3D character pose as image, feed to MediaPipe, compare with source
- **Deliverables:**
  - 3D character render-to-image (from current camera view)
  - Feed rendered image to MediaPipe
  - Extract MediaPipe landmarks from rendered 3D character
  - Compare landmarks: Source (original person) vs Result (3D character)
  - Visual diff visualization:
    - Side-by-side MediaPipe overlays
    - Landmark distance metrics
    - Heatmap showing differences
    - Numerical accuracy scores
  - Real-time comparison during pose tracking
- **Dependencies:** PR-7
- **Risk:** Low (adds validation, doesn't change core logic)
- **Rationale:** **Critical debugging tool** - visualizes conversion accuracy, helps identify which bones/poses need adjustment

### PR-8: MediaPipe Video Integration
- **Scope:** MediaPipe Pose Landmarker for video files
- **Deliverables:**
  - Video file loading
  - Frame-by-frame pose detection
  - Pose landmark extraction from video
  - Video playback with pose overlay
  - Frame scrubbing
- **Dependencies:** PR-7
- **Risk:** Medium
- **Rationale:** Test with video files before live webcam

### PR-9: Pose to Bone Conversion (Video Testing)
- **Scope:** Convert MediaPipe landmarks to bone rotations for video
- **Deliverables:**
  - Apply conversion to video frames
  - Real-time bone animation from video
  - Performance optimization
  - Frame-by-frame validation
  - Pose comparison tool integration (from PR-7b)
- **Dependencies:** PR-8, PR-7b
- **Risk:** Medium
- **Rationale:** Validate video conversion works before live stream, with comparison feedback

### PR-10: MediaPipe Live Video Integration
- **Scope:** MediaPipe Pose Landmarker for live webcam
- **Deliverables:**
  - Webcam capture
  - Real-time pose landmark extraction
  - Live pose overlay visualization
  - Performance monitoring
- **Dependencies:** PR-9
- **Risk:** Medium
- **Rationale:** Only after static and video testing successful

### PR-11: Bone Animation System (Live)
- **Scope:** Apply rotations to 3D model bones in real-time from live video
- **Deliverables:**
  - Real-time bone rotation application
  - Smoothing/interpolation (LERP)
  - Performance optimization (<150ms latency)
  - Jitter reduction
- **Dependencies:** PR-10
- **Risk:** Medium (Performance critical)
- **Rationale:** Now we have validated everything works, optimize for live performance

### PR-12: Animation Source Tabs - Video Tracking
- **Scope:** Video tracking tab with MediaPipe (live webcam)
- **Deliverables:**
  - Video tracking tab UI
  - Live video preview with MediaPipe overlay
  - Start/stop controls
  - Real-time pose tracking
  - Performance metrics display
  - Pose comparison visualization (toggleable)
    - Side-by-side: Source person vs 3D character
    - MediaPipe overlays on both
    - Real-time accuracy metrics
- **Dependencies:** PR-11, PR-7b
- **Risk:** Low (all components validated)

### PR-13: Animation Source Tabs - GLB Animation
- **Scope:** Playback of animations embedded in GLB
- **Deliverables:**
  - GLB animation tab
  - Animation selector
  - Timeline scrubber
  - Play/pause/loop controls
- **Dependencies:** PR-1
- **Risk:** Low

### PR-14: Animation Source Tabs - Manual Pose
- **Scope:** Manual bone control via sliders
- **Deliverables:**
  - Manual pose tab
  - Bone sliders (X, Y, Z per bone)
  - Reset controls
  - Preset poses (optional)
- **Dependencies:** PR-1, PR-4
- **Risk:** Low

### PR-15: Animation Source Tabs - Synthetic Animation
- **Scope:** Keyframe-based animation creation
- **Deliverables:**
  - Synthetic animation tab
  - Keyframe timeline
  - Bone sliders (shared with Manual)
  - Playback controls
- **Dependencies:** PR-7
- **Risk:** Low

### PR-16: Global Controls & Polish
- **Scope:** Global play/pause, skeleton toggle, reset
- **Deliverables:**
  - Global play/pause button
  - Skeleton toggle (3D model + MediaPipe overlay)
  - Reset button (FEAT-05)
  - UI polish and styling
- **Dependencies:** All previous PRs
- **Risk:** Low

### PR-17: Character Selection (Simple)
- **Scope:** Basic character loading
- **Deliverables:**
  - Character selector modal
  - Server API integration (list characters)
  - Dev mode (local GLB upload)
  - Character loading into viewer
- **Dependencies:** PR-1
- **Risk:** Low

**Phase 1 Complete When:**
- All PR-1 through PR-17 merged
- Meshy model debugging tools functional
- Controlled pose testing successful (single frame → static → yoga)
- MediaPipe conversion validated with static and video
- Live video tracking working
- Core animation working end-to-end
- <150ms latency feels good (manual validation)
- All animation source tabs functional
- Manually tested and working

---

## 📦 Phase 2: Character Creation Flow

**Goal:** Complete the user journey from drawing to animated character.

**Success Criteria:**
- ✅ Full creation flow (upload → generate → animate)
- ✅ Gallery view for session characters
- ✅ Asset progression visualization
- ✅ <60s processing time maintained

**PRs (Pull Requests):**

### PR-18: Splash Screen
- **Scope:** App initialization and branding
- **Deliverables:**
  - Splash screen component
  - Loading states
  - Smooth transitions
- **Dependencies:** None
- **Risk:** Low

### PR-19: Gallery View
- **Scope:** Grid of character cards
- **Deliverables:**
  - Gallery layout
  - Character cards (thumbnails)
  - Animated previews (3D characters)
  - "Create New" button
  - Session-only storage (no persistence)
- **Dependencies:** PR-11
- **Risk:** Low

### PR-20: Creation Flow - Step 1 (Upload/Scan)
- **Scope:** Template upload interface
- **Deliverables:**
  - Upload interface with template overlay
  - Camera capture
  - File upload
  - Drag-and-drop
  - Template validation
  - Preview display
- **Dependencies:** PR-12
- **Risk:** Low

### PR-21: Creation Flow - Step 3 (Generate 3D)
- **Scope:** 3D generation with progress tracking
- **Deliverables:**
  - Progress stepper UI
  - Asset progression visualization
  - Time remaining display
  - Backend API integration (Meshy)
  - Tier 2 fallback handling
  - "READY" indicator (FEAT-03)
- **Dependencies:** PR-13
- **Risk:** **High** (Backend integration, API reliability)

### PR-22: Backend - Asset Pipeline
- **Scope:** Server-side 3D generation orchestration
- **Deliverables:**
  - Image upload endpoint
  - Meshy API integration
  - 50-second fallback timer
  - Tier 2 texture mapping
  - WebSocket notifications
  - Temporary storage (ephemeral URLs)
- **Dependencies:** PR-14 (frontend)
- **Risk:** **High** (Critical path, API dependencies)

### PR-23: Navigation & Flow Integration
- **Scope:** Connect all views together
- **Deliverables:**
  - View routing/navigation
  - Gallery → Creation Flow → Main View
  - Back navigation
  - State management
- **Dependencies:** PR-12, PR-13, PR-14, PR-10
- **Risk:** Medium

**Phase 2 Complete When:**
- All PR-18 through PR-23 merged
- Full creation flow working end-to-end
- <60s processing time achieved (manual validation)
- Gallery and navigation functional
- Manually tested and working

---

## 📦 Phase 3: Polish & Advanced Features

**Goal:** Production readiness and enhanced features.

**Success Criteria:**
- ✅ Video download feature (FEAT-04)
- ✅ Screen recording capability
- ✅ Enhanced stability and performance
- ✅ Production-ready deployment

**PRs (Pull Requests):**

### PR-24: Video Download (FEAT-04)
- **Scope:** 10-second video clip download
- **Deliverables:**
  - Video recording during AR session
  - Download button/QR code
  - No-login download mechanism
  - Temporary video storage
- **Dependencies:** PR-5 (video tracking)
- **Risk:** Medium

### PR-25: Screen Recording
- **Scope:** Screen capture functionality
- **Deliverables:**
  - Screen recording controls
  - Recording indicator
  - Save/share functionality
- **Dependencies:** PR-17
- **Risk:** Low

### PR-26: Performance Optimization
- **Scope:** Stability and performance improvements
- **Deliverables:**
  - Memory leak fixes
  - Performance profiling
  - 8-hour stability testing
  - Automated soft-reset (R3)
- **Dependencies:** All previous PRs
- **Risk:** Medium

### PR-27: Enhanced Gallery Features
- **Scope:** Gallery improvements
- **Deliverables:**
  - Search/filter (if needed)
  - Better animations
  - Character management
- **Dependencies:** PR-12
- **Risk:** Low

### PR-28: Production Deployment
- **Scope:** Production readiness
- **Deliverables:**
  - Deployment configuration
  - Environment setup
  - Monitoring/logging
  - Error handling
  - Documentation
- **Dependencies:** All previous PRs
- **Risk:** Medium

**Phase 3 Complete When:**
- All PR-24 through PR-28 merged
- Production deployment successful
- All features working in production environment
- Manually tested and working

---

## 🎯 Derisking Strategy

### Critical Path (Highest Risk)

**Phase 1 Focus:**
1. **PR-2 (Meshy Model Debugging Tools)** - Foundation for everything
   - **Derisking:** Build debugging tools first - can't debug without them
   - **Validation:** Can manually manipulate bones correctly
   - **Fallback:** None - this is essential

2. **PR-3 through PR-5 (Controlled Pose Testing)** - Validate approach incrementally
   - **Derisking:** Test with known, controlled poses before MediaPipe
   - **Validation:** Manual pose matching works correctly
   - **Fallback:** If manual doesn't work, MediaPipe won't either

3. **PR-7 (Pose to Bone Conversion - Static)** - Core technical challenge
   - **Derisking:** Test with static images first, validate conversion logic
   - **Validation:** Static pose conversion matches manual manipulation
   - **Fallback:** If static fails, video/live will fail - need to fix approach

4. **PR-7b (Pose Comparison Tool)** - Critical validation tool
   - **Derisking:** Visual feedback loop - see exactly where conversion differs
   - **Validation:** Compare source vs result MediaPipe landmarks
   - **Benefit:** Identifies which bones/poses need adjustment, quantifies accuracy

4. **PR-11 (Bone Animation System - Live)** - Performance critical
   - **Derisking:** Optimize only after conversion is validated
   - **Validation:** <150ms latency requirement
   - **Fallback:** Reduce smoothing, simplify calculations

**Phase 2 Focus:**
1. **PR-15 (Backend Asset Pipeline)** - External API dependency
   - **Derisking:** Mock API first, then integrate
   - **Validation:** <60s processing time
   - **Fallback:** Tier 2 texture mapping (already planned)

### Risk Mitigation

- **Technical Risks:** Start with core (Phase 1) to validate approach
- **API Risks:** Implement fallback strategy (Tier 2) early
- **Performance Risks:** Continuous profiling, optimize as we go
- **Integration Risks:** Build incrementally, test each PR thoroughly

---

## 📊 PR Dependencies Graph

```
Phase 1:
PR-1 (3D Viewer)
  └─> PR-2 (Meshy Debug Tools) ⚠️ FOUNDATION
        └─> PR-3 (Single Frame Testing)
              └─> PR-4 (Static Poses)
                    └─> PR-5 (Yoga Poses)
                          └─> PR-6 (MediaPipe Static)
                                └─> PR-7 (Pose Conversion Static) ⚠️ CRITICAL
                                      └─> PR-7b (Pose Comparison Tool) 🔍 VALIDATION
                                            └─> PR-8 (MediaPipe Video)
                                                  └─> PR-9 (Pose Conversion Video)
                                                        └─> PR-10 (MediaPipe Live)
                                                              └─> PR-11 (Bone Animation Live)
                                                                    └─> PR-12 (Video Tab)
PR-1 ──> PR-13 (GLB Tab)
PR-2 ──> PR-14 (Manual Tab)
  └─> PR-15 (Synthetic Tab)
PR-1 ──> PR-17 (Character Select)
All ──> PR-16 (Global Controls)

Phase 2:
PR-18 (Splash)
  └─> PR-19 (Gallery)
        ├─> PR-20 (Upload)
        │     └─> PR-21 (Generate 3D)
        │           └─> PR-22 (Backend) ⚠️ CRITICAL
        └─> PR-23 (Navigation)

Phase 3:
PR-24 (Video Download)
  └─> PR-25 (Screen Recording)
PR-26 (Performance)
PR-27 (Gallery Enhancements)
PR-28 (Production)
```

---

## ✅ Definition of Done (Per PR)

Each PR must include:
- ✅ Working feature (no broken functionality)
- ✅ Manually tested by you (interactive validation)
- ✅ Basic unit tests for critical logic (if applicable)
- ✅ No console errors
- ✅ Performance feels good (manual check for critical PRs)

---

## 🧪 Testing Strategy (Lightweight)

### Testing Philosophy

**Simple & Pragmatic:** Light automated tests for critical logic, manual testing for UI/UX. You'll validate interactively before merging PRs.

**Test Approach:**
- **Unit Tests:** Only for critical calculation logic (pose conversion, bone math)
- **Manual Testing:** You test UI/UX interactively before PR merge
- **Performance Checks:** Simple manual timing for latency requirements

### Testing Tools (Minimal)

| Test Type | Tool | When to Use |
| :--- | :--- | :--- |
| **Unit Tests** | **Jest** or **Vitest** | Only for core math/calculations (pose conversion logic) |
| **Manual Testing** | Browser + DevTools | All UI features, interactions, visual validation |

### Critical Tests Only

**PR-7: Pose to Bone Conversion**
- **Unit Tests:** Basic conversion logic tests
  - Test known good poses
  - Test edge cases (missing landmarks)
- **Manual:** You test with various poses interactively

**PR-11: Bone Animation System (Live)**
- **Manual Performance Check:** Use browser DevTools to measure latency
  - Verify <150ms visually/with console timing
  - Test with webcam input

**PR-21/22: Backend Pipeline**
- **Manual:** Test full flow, verify <60s processing time

### Test Data (Minimal)

**Just need:**
- A few test pose images (T-pose, standing, arms up)
- One test GLB model
- One test video file

**Location:** `frontend/test-data/` (simple folder)

### No CI/CD Required

- Run tests locally before committing
- You validate manually before merging
- Keep it simple

---

## 📋 Simple Testing Checklist

### Before Merging Any PR:
- ✅ Manual testing: Feature works as expected
- ✅ No console errors
- ✅ Basic unit tests pass (if applicable)
- ✅ Performance feels good (manual check)

### Phase Completion:
- ✅ All PRs manually tested and working
- ✅ <150ms latency feels good (Phase 1)
- ✅ <60s processing time validated (Phase 2)

---

## 📅 Timeline Estimates (Rough)

**Phase 1:** 6-8 weeks
- PR-1 through PR-17
- Focus on derisking: debugging tools → controlled testing → MediaPipe conversion
- Incremental validation at each step

**Phase 2:** 3-4 weeks
- PR-18 through PR-23
- Backend integration is critical path

**Phase 3:** 2-3 weeks
- PR-24 through PR-28
- Polish and production readiness

**Total:** ~11-15 weeks (more time in Phase 1 for proper derisking)

---

**Document Status:** Draft v1.0  
**Last Updated:** [Current Date]  
**Next Review:** After Phase 1 completion

