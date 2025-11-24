# 🧱 Hero Maker Software Design Document (SDD)

## 1. Introduction & Technical Goals

### 1.1. Technical Goal
The goal is to implement a robust, high-throughput, and low-latency system that orchestrates the $\mathbf{2D \rightarrow 3D \rightarrow Rigging}$ API pipeline and successfully executes real-time $\mathbf{Inverse \ Kinenmatics \ (IK)}$ mapping to drive the custom-generated character using live MediaPipe skeletal data within the $<150$ms latency constraint.

### 1.2. Constraints & Trade-offs (Derived from PRD)
* **Latency Constraint:** End-to-end pose tracking must operate below **150ms**.
* **Asset Time Constraint:** Total 2D $\rightarrow$ 3D $\rightarrow$ Rigging time must be under **60 seconds**.
* **Privacy Constraint:** **No persistent storage** of video or biometric data. Processing must be client-side or use ephemeral cloud resources.
* **Technical Trade-off:** We prioritize **speed and IK stability** over minute artistic detail in the 3D model geometry.


---

## 2. System Architecture & Data Flow

### 2.1. Technology Stack Definition

| Component | Technology | Rationale |
| :--- | :--- | :--- |
| **Frontend Core** | **React / Next.js** | Provides reliable structure and optimization. |
| **AR/Rendering** | **Three.js + GLTFLoader** | Superior control over 3D model rigging and IK implementation. |
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

### 3.2. Real-Time Pose & IK System

* **MediaPipe Execution:** The `MediaPipe Pose Landmarker` instance will run entirely within a **dedicated JavaScript Web Worker**. This is mandatory to prevent the CV computation from blocking the main thread's rendering loop (critical for $<150$ms latency).
* **Data Filtering:** Raw 33-point skeletal data from the Web Worker will be processed on the main thread using an **Exponential Smoothing Filter** to reduce high-frequency jitter and stabilize the depth (Z-coordinate) values before IK is solved.
* **Inverse Kinematics (IK) Solver:**
    * **Implementation:** Will use a highly optimized IK implementation (e.g., FABRIK or a Three.js IK library).
    * **Joint Map Dictionary (`IK_Joint_Map.json`):** This static JSON file is the interface translator. It maps the 33 numerical indices of the MediaPipe skeleton to the human-readable bone names used by the auto-rigged GLB model (assumed to be Mixamo-compatible).

### 3.3. Throughput & Stability

* **Frontend Reset (FEAT-05):** The dedicated "RESET" button will execute three parallel, non-blocking actions: **Dispose Three.js assets, Terminate/Reinitialize Web Worker, and Clear all local storage/session state.**
* **Long-Term Stability (R3):** Implement a scheduled, automated **soft-reset** of the entire installation system (browser/OS) once every eight hours to mitigate cumulative memory leaks and ensure the 8-hour daily stability constraint is met.

---

## 4. Risks & Mitigation

| Risk Category | Risk Description | Mitigation Strategy |
| :--- | :--- | :--- |
| **R1: IK Incompatibility** | The generated 3D model's rig is incompatible with the MediaPipe data, leading to severe visual errors (e.g., arms bending backward). | **Validation Script:** Build a script on the backend to **automatically check the generated GLB's bone names** against the `IK_Joint_Map.json`. If validation fails, immediately trigger the **Tier 2 Fallback** (Texture Mapping). |
| **R2: Processing Time** | Generative APIs are slow or fail, pushing processing time beyond the 60-second limit. | **Tiered Failover (Implemented):** The **50-second hard-switch timer** guarantees transition to the fast, pre-approved **Texture Mapping Fallback (Tier 2)**, ensuring the 60-second user time constraint is never violated. |
| **R3: Installation Stability** | Running the demanding CV and rendering engine for 8+ hours causes memory leaks or crashes. | **Periodic Reset:** Implement a scheduled, automated **soft-reset** of the installation system every 8 hours. |
| **R4: Z-Depth Jitter** | The Z-coordinate (depth) from MediaPipe jitters significantly, making the 3D character appear to float or swim in space. | **Filtering & Anchoring:** Apply an **Exponential Smoothing Filter** to the Z-axis data. Anchor the character's hips/feet to a calculated stable ground plane derived from the video feed. |