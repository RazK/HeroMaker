# 🦸 Hero Maker Product Requirements Document (PRD)

## 📄 1. Document & Project Overview

| Attribute | Detail |
| :--- | :--- |
| **Project Name** | **Hero Maker** |
| **Document Version** | **3.2 (Template & Fallback Commitment)** |
| **Target Audience** | Children (Ages 6-12) and Art/Tech Festival Attendees |
| **Problem/Opportunity** | The opportunity lies in **creating a profound, magical moment** where a participant's personal imagination is instantly realized in a body-tracking AR experience. It transforms the abstract process of drawing a superhero into a cherished, unforgettable, lived experience. |
| **Project Vision** | To deliver an **extraordinary, world-first experience** at a tech/art festival that is celebrated for seamlessly blending creativity, technology, and childhood dreams into a single, memorable interactive installation. |

---

## 2. Goals & Success Metrics

### 🎯 Primary Goal (Objective)
Deliver a **magical, high-fidelity 3D character experience** where a participant's uniquely *designed* character is converted into a fully rigged, animated character that accurately mimics their pose in real-time, creating a memorable installation moment.

### ✅ Success Metrics (Key Results - KRs)

| Metric | Target | Rationale |
| :--- | :--- | :--- |
| **AR Latency (Pose Update)** | **<150ms** (from participant movement to on-screen 3D model pose update) | Critical for the experience feeling instantaneous and believable. |
| **Body Mimicry Accuracy** | **>90\% visual fidelity** (Minimal visual separation between the participant's body and the 3D character; no joint clipping/floating). | The main indicator of the "magic"—the character must convincingly mirror the pose. |
| **End-to-End Asset Processing Time**| **<60 seconds** (Total time from template image upload to the rigged 3D character being ready for AR session). | Ensures a high throughput of participants at the festival installation. |
| **Character Generation Success** | **>90\%** of uploaded drawings must result in a valid, riggable, humanoid 3D mesh (or a successful Tier 2 texture-map fallback). | Measures the reliability of the entire asset pipeline. |

---

## 3. User Stories & Features

### 3.1. Core Experience & Full Character Magic (Critical Priority)

| Feature ID | User Story | Acceptance Criteria (AC) |
| :--- | :--- | :--- |
| **FEAT-01** | **As a Participant,** I want to draw and color my unique superhero **directly onto a provided humanoid silhouette template**, **so that** the generated 3D character maintains a stable, riggable body shape that perfectly matches my design. | The system must accept and process a full-body template sketch with high color and shape accuracy for 3D generation. |
| **FEAT-02** | **As a Participant,** I want the **full 3D character model** generated from my drawing to mimic my exact body movements (head, limbs, torso) in real time. | The custom 3D model's rig must be successfully driven by the **Inverse Kinematics (IK) solver** using the MediaPipe keypoints, replicating the user's pose without unnatural deformations. |
| **FEAT-03** | **As a Monitor,** I want to receive a clear **visual success indicator** when the 3D character is ready, **so that** I can usher the participant to the AR activation area immediately. | The frontend must be asynchronously notified and display a large, prominent "READY" cue when the final rigged asset URL is available. |

### 3.2. Ancillary Features (Medium Priority)

| Feature ID | User Story | Acceptance Criteria (AC) |
| :--- | :--- | :--- |
| **FEAT-04** | **As a Participant,** I want to be able to instantly download or receive a digital copy (via QR code/email) of the **video clip** of myself as my superhero, **so that** I have a permanent memory of the experience. | The system must save a 10-second video of the AR session and offer a simple, non-login download mechanism. |
| **FEAT-05** | **As a Monitor,** I want a simple control to clear the previous user's data and reset the system instantly, **so that** participant throughput is maximized. | A dedicated "RESET" button must clear the canvas, delete the asset URL, and prepare the system for the next template scan in under 3 seconds. |

---

## 4. Scope, Assumptions, & Constraints

### 🚫 Non-Goals (Out of Scope for Initial Deployment)
* **Custom Animation Sequences:** The system will only handle **live body-mimicry**; it will not play pre-recorded animation loops (e.g., flying, walking cycles).
* **User Accounts:** No user login, profiles, or persistent server-side storage of custom assets.
* **Complex Scene Interaction:** No ability for the character to interact with virtual objects or other participants.

### 💡 Key Assumptions
1.  **Environment Control:** The festival environment will provide **consistent, bright, and shadow-free lighting** to optimize webcam and Computer Vision (CV) performance.
2.  **AI API Feasibility (Structured):** The chosen 2D-to-3D API (Meshy/Tripo) can reliably generate a **riggable, single-piece humanoid mesh** *because* the input drawing is constrained to a fixed template.

### 🛑 Critical Constraints
1.  **Throughput:** The entire process (Scan to AR activation) must be designed to accommodate a high volume of festival attendees.
2.  **Privacy:** **No storage** of any video streams or identifiable biometric data (faces, raw video) is permitted on the installation hardware or cloud servers. All CV processing must occur locally or with immediate data destruction.
3.  **Stability:** The installation must run reliably for **8+ hours per day** without requiring manual restarts or re-calibration.
4.  **Fallback Guarantee:** The system must implement a guaranteed **Tier 2 fallback** (Texture Mapping onto a Pre-Approved Base Mesh) to ensure *every* participant leaves with a successful AR experience, even if 3D generation fails, satisfying the **<60 second** constraint.