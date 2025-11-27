# 🧱 Hero Maker Software Design Document (SDD)

## 1. Introduction & Technical Goals

### 1.1. Technical Goal
The goal is to implement a robust, high-throughput, and low-latency system that orchestrates the $\mathbf{2D \rightarrow 3D \rightarrow Rigging}$ API pipeline and successfully executes real-time pose mapping to drive the custom-generated character using live MediaPipe skeletal data within the $<150$ms latency constraint.

### 1.2. Implementation Strategy
**Phased Implementation with Derisking:** Start with core technical challenge (Phase 1), then expand to full system (Phase 2), then polish for production (Phase 3). See `ROADMAP.md` for detailed PR-by-PR implementation plan.

### 1.3. Constraints & Trade-offs (Derived from PRD)
* **Latency Constraint:** End-to-end pose tracking must operate below **150ms**.
* **Asset Time Constraint:** Total 2D $\rightarrow$ 3D $\rightarrow$ Rigging time must be under **60 seconds**.
* **Privacy Constraint:** **No persistent storage** of video or biometric data. Processing must be client-side or use ephemeral cloud resources.
* **Technical Trade-off:** We prioritize **speed and pose tracking stability** over minute artistic detail in the 3D model geometry.


---

## 2. System Architecture & Data Flow

### 2.1. Technology Stack Definition

| Component | Technology | Rationale |
| :--- | :--- | :--- |
| **Frontend Core** | **Vanilla HTML/JavaScript** (Current), **React / Next.js** (Future consideration) | Current implementation uses vanilla HTML. Migration to React/Next.js may be considered in Phase 2 or 3. |
| **AR/Rendering** | **Three.js + GLTFLoader** | Superior control over 3D model rigging and pose mapping. |
| **Body Tracking (CV)** | **MediaPipe Pose Landmarker** | Most stable, high-performance, browser-based 33-point 3D skeletal estimation. |
| **Backend Orchestration**| **Node.js Serverless** (e.g., AWS Lambda, GCP Functions) | Handles external API keys, rate limits, and asynchronous polling. |
| **Generative AI** | **Meshy AI** (Primary), **Tripo AI** (Fallback) | Executes the 2D $\rightarrow$ 3D Mesh Generation & Auto-Rigging tasks. |
| **Asynchronous Communication** | **WebSockets** (or dedicated polling service) | Push notification to frontend when the asset pipeline completes. |

### 2.2. Data Flow: The Critical 60-Second Asset Pipeline (BE)
This sequence must adhere strictly to the time budgets:

| Step | Component | Input/Output Format | Time Budget | Critical Action |
| :--- | :--- | :--- | :--- | :--- |
| **T1: Scan & Upload** | Frontend $\rightarrow$ Backend API | PNG/JPG (template) | $<3$s | Backend validates image integrity and initiates the 3D process. |
| **T2: 2D $\rightarrow$ 3D Mesh** | Meshy AI API | Input: PNG/JPG. Output: GLB URI | **$<40$s** | Generate unique 3D humanoid mesh (made reliable by the template constraint). |
| **T3: Auto-Rigging** | Meshy AI API | Input: Generated GLB. Output: Rigged GLB URI | **$<10$s** | Apply a Mixamo-compatible skeleton. |
| **T4: Storage & Delivery** | Cloud Storage (AWS S3) | Rigged GLB | $<5$s | Store asset temporarily, generate a signed, ephemeral URL. |
| **T5: Notification** | Backend $\rightarrow$ Frontend (WebSocket) | JSON (Asset URL) | $<1$s | Push notification to the waiting frontend to begin AR activation. |

---

## 3. Detailed Component Design

### 3.1. Asset Generation & Fallback Strategy

* **Template Constraint:** The backend relies on the frontend to enforce the **fixed humanoid template** input to guide the generative AI to maintain a riggable structure.
* **Failover Logic (Critical Mitigation):** The backend will implement a **50-second hard-switch timer** to guarantee the transition to the reliable Tier 2 fallback.
    * If **Tier 1 (Full 3D Character)** is not completed (rigged GLB received) within 50 seconds, the backend immediately **abandons the task** and initiates **Tier 2**.
* **Tier 2 (Fallback) Implementation:** This ensures guaranteed success within the 60s window:
    1.  The backend generates only the **textures** (e.g., diffuse maps) from the child's drawing via an image processing or texture-generation API.
    2.  The backend sends the texture map URL along with a signal to the frontend instructing it to load the locally-cached **`base_superhero_rig.glb`** and apply the custom texture map.

### 3.2. Real-Time Pose Mapping System

* **MediaPipe Execution:** The `MediaPipe Pose Landmarker` instance will run entirely within a **dedicated JavaScript Web Worker**. This is mandatory to prevent the CV computation from blocking the main thread's rendering loop (critical for $<150$ms latency).
* **Data Filtering:** Raw 33-point skeletal data from the Web Worker will be processed on the main thread using an **Exponential Smoothing Filter** to reduce high-frequency jitter and stabilize the depth (Z-coordinate) values before pose mapping.
* **Pose to Bone Mapping:**
    * **Implementation:** MediaPipe landmarks are converted to bone rotations using direction-based calculations.
    * **Bone Mapping:** The system maps MediaPipe landmark indices to the bone names used by the auto-rigged GLB model (assumed to be Mixamo-compatible).

### 3.3. Throughput & Stability

* **Frontend Reset (FEAT-05):** The dedicated "RESET" button will execute three parallel, non-blocking actions: **Dispose Three.js assets, Terminate/Reinitialize Web Worker, and Clear all local storage/session state.**
* **Long-Term Stability (R3):** Implement a scheduled, automated **soft-reset** of the entire installation system (browser/OS) once every eight hours to mitigate cumulative memory leaks and ensure the 8-hour daily stability constraint is met.

---

## 4. Risks & Mitigation

| Risk Category | Risk Description | Mitigation Strategy |
| :--- | :--- | :--- |
| **R1: Bone Mapping Incompatibility** | The generated 3D model's rig is incompatible with the MediaPipe data, leading to severe visual errors (e.g., arms bending backward). | **Validation Script:** Build a script on the backend to **automatically check the generated GLB's bone names** against expected bone structure. If validation fails, immediately trigger the **Tier 2 Fallback** (Texture Mapping). |
| **R2: Processing Time** | Generative APIs are slow or fail, pushing processing time beyond the 60-second limit. | **Tiered Failover (Implemented):** The **50-second hard-switch timer** guarantees transition to the fast, pre-approved **Texture Mapping Fallback (Tier 2)**, ensuring the 60-second user time constraint is never violated. |
| **R3: Installation Stability** | Running the demanding CV and rendering engine for 8+ hours causes memory leaks or crashes. | **Periodic Reset:** Implement a scheduled, automated **soft-reset** of the installation system every 8 hours. |
| **R4: Z-Depth Jitter** | The Z-coordinate (depth) from MediaPipe jitters significantly, making the 3D character appear to float or swim in space. | **Filtering & Anchoring:** Apply an **Exponential Smoothing Filter** to the Z-axis data. Anchor the character's hips/feet to a calculated stable ground plane derived from the video feed. |

---

## 5. Phased Implementation Technical Details

### 5.1. Phase 1: Core Animation (Derisking Focus)

**Technical Priority:** Validate pose mapping system before building full pipeline.

**Key Components:**
- MediaPipe Pose Landmarker integration
- Pose to bone rotation conversion (critical path)
- Real-time bone animation system
- Performance optimization (<150ms latency)

**Risk Mitigation:**
- Build pose conversion first (highest risk)
- Continuous performance profiling
- Extensive testing with various GLB models

**See ROADMAP.md PR-1 through PR-17 for implementation details.**

### 5.2. Phase 2: Character Creation Flow

**Technical Priority:** Backend asset pipeline integration.

**Key Components:**
- Backend API (Node.js serverless)
- Meshy AI integration
- Tier 2 fallback implementation
- WebSocket notifications
- Frontend-backend communication

**Risk Mitigation:**
- Mock backend first, then integrate
- 50-second fallback timer (guaranteed success)
- Extensive error handling

**See ROADMAP.md PR-18 through PR-23 for implementation details.**

### 5.3. Phase 3: Production Readiness

**Technical Priority:** Stability, performance, deployment.

**Key Components:**
- Video recording/capture
- Memory leak fixes
- 8-hour stability testing
- Production deployment configuration

**See ROADMAP.md PR-24 through PR-28 for implementation details.**

---

## 6. Testing Strategy (Lightweight)

### 6.1. Testing Philosophy

**Simple & Pragmatic:** Light automated tests for critical calculation logic. Manual interactive testing for UI/UX validation.

**Test Approach:**
- **Unit Tests:** Only for critical math (pose conversion calculations)
- **Manual Testing:** Interactive validation before PR merge
- **Performance:** Simple manual timing checks

### 6.2. Critical Validations

**Performance Checks (Manual):**
- **<150ms Latency:** Visual/manual timing check with DevTools
- **<60s Processing:** Manual timing of full flow
- **<3s Reset:** Manual timing check

**Functional Validation:**
- Manual testing of all user stories (FEAT-01 through FEAT-05)
- Pose conversion accuracy validated with pose comparison tool (PR-7b)
- Tier 2 fallback tested manually (simulate slow API)

**See ROADMAP.md "Testing Strategy" section for details.**