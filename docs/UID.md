# 🎨 Hero Maker User Interface Design Document (UID)

## 📄 1. Document & Overview

| Attribute | Detail |
| :--- | :--- |
| **Document Name** | **User Interface Design Document (UID)** |
| **Document Version** | **1.0 (Progressive Design)** |
| **Target Audience** | Children (Ages 6-12) and Festival Attendees (per PRD) |
| **Design Philosophy** | **Progressive Enhancement** - Start with core, evolve gracefully |
| **Core Focus** | MediaPipe tracking to Meshy rig animation (Phase 1 foundation) |
| **Visual Style** | **Modern, Clean, Simple, Bright** - Inspired by [Needle.tools](https://needle.tools/?room=lightmaps) |
| **Key Constraints** | <60s asset processing, <150ms pose latency, No persistent storage (per PRD/SDD) |
| **Note on PRD/SDD** | All three documents (PRD, SDD, UID) are now aligned on phased implementation approach. See ROADMAP.md for detailed PR-by-PR implementation plan. |

---

## 2. Complete User Journey (Full Vision)

### 2.1. End-to-End Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    SPLASH SCREEN                             │
│              (App loads, branding)                           │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                    GALLERY VIEW                              │
│  [Previous Drawings] [3D Characters Dancing] [Create New]   │
│  (Grid of thumbnails with animated previews)                │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│              CREATE NEW CHARACTER FLOW                       │
│                                                               │
│  Step 1: Upload/Scan Drawing                                 │
│  ┌─────────────────────┐                                   │
│  │ [Camera] [Upload]    │ → Drawing preview                 │
│  └─────────────────────┘                                   │
│                          ↓                                   │
│  Step 2: Generate 3D Character (Enhance with AI optional)   │
│  ┌─────────────────────────────────────┐                     │
│  │ Progress: Image→3D→Remesh→Texture→ │                     │
│  │           Rig→Animate               │                     │
│  │ [Asset progression visualization]    │                     │
│  └─────────────────────────────────────┘                     │
│                          ↓                                   │
│  Step 4: Live Animation (Current Phase 1)                    │
│  ┌─────────────────────────────────────┐                   │
│  │ 3D Character + Animation Controls     │                   │
│  └─────────────────────────────────────┘                     │
└─────────────────────────────────────────────────────────────┘
```

### 2.2. Progressive Implementation Strategy

**Phase 1 (Current):** Core animation interface
- Start with main view (3D character + animation controls)
- Focus on MediaPipe → Meshy rig conversion
- Simple character selection (server API or local dev)

**Phase 2:** Gallery and creation flow
- Add splash screen
- Add gallery view
- Add creation flow steps 1-3
- Integrate with existing animation interface

**Phase 3:** Polish and advanced features
- Screen recording
- Sharing features
- Enhanced gallery interactions

---

## 3. Main View Structure (Core Foundation)

### 3.1. Layout Philosophy

**The main view is the foundation** - it will evolve from simple to complex:

```
Phase 1 (Current):
┌─────────────────────────────────────────┐
│  [Character Selector] [Dev Mode]       │
├─────────────────────────────────────────┤
│                                         │
│         3D CHARACTER VIEWER             │
│         (70-80% of screen)              │
│                                         │
├─────────────────────────────────────────┤
│  [Animation Source Tabs]                │
│  [Tab Content Area]                      │
├─────────────────────────────────────────┤
│  [Global Controls]                       │
└─────────────────────────────────────────┘

Phase 2+ (With Gallery):
┌─────────────────────────────────────────┐
│  [Back to Gallery] [Character Name]      │
├─────────────────────────────────────────┤
│  [Same structure as Phase 1]            │
│  (Gallery button replaces character     │
│   selector, but same layout)             │
└─────────────────────────────────────────┘
```

**Key Design Decision:** Main view structure stays consistent, only navigation changes.

### 3.2. View States

| State | Description | When Shown |
| :--- | :--- | :--- |
| **Splash** | App loading, branding | App startup (Phase 2) |
| **Gallery** | Previous characters grid | After splash, or from main view (Phase 2) |
| **Creation Flow** | Step-by-step character creation | From "Create New" button (Phase 2) |
| **Main View** | 3D character + animation | After character selection/creation |

---

## 4. Phase 1: Core Animation Interface

### 4.1. Character Selection (Phase 1)

**Simple Implementation:**
- **Modal/Dialog:** Character selection overlay
- **Content:** Grid of character thumbnails from server API
- **Dev Mode:** Local GLB upload option
- **Action:** Select → Load into main view

**Future Evolution (Phase 2):**
- Character selector becomes "Back to Gallery" button
- Gallery shows created characters
- Selection happens in gallery, opens main view

### 4.2. Animation Source Tabs

**Four Tabs (as specified):**
1. **GLB Animation** - Playback of animations in GLB
2. **Synthetic Animation** - Keyframe-based animation
3. **Manual Pose** - Static pose control
4. **Video Tracking** - MediaPipe pose tracking

**Tab Structure:**
- Clean tab bar below 3D viewer
- Each tab has its own content area
- Tab content adapts to tab type
- Global controls always visible

### 4.3. 3D Viewer

**Primary Focus:**
- Takes 70-80% of screen space
- Centered, prominent
- Clean background (dark for contrast)
- Skeleton toggleable (both 3D model and MediaPipe overlay)

**"READY" Indicator (FEAT-03):**
- **Location:** Overlay on 3D viewer (large, prominent)
- **Trigger:** When character asset is ready (backend notification)
- **Visual:** Large "READY" text with animation/glow
- **Purpose:** Clear signal for monitor to usher participant to AR area
- **Duration:** Stays visible until user starts animation or dismisses

**Fullscreen Mode:**
- Toolbars collapse
- Viewer expands to fill screen
- Controls accessible via hover/keyboard

---

## 5. Phase 2: Gallery & Creation Flow

### 5.1. Splash Screen

**Design:**
- **Duration:** 1-2 seconds
- **Content:** Logo, app name, loading indicator
- **Transition:** Smooth fade to gallery or main view

**Behavior:**
- Show on app load
- Skip if user has been here before (optional)
- Fast transition to next view

### 5.2. Gallery View

**Layout:**
```
┌─────────────────────────────────────────┐
│  [App Logo] [Create New Character]      │
├─────────────────────────────────────────┤
│                                         │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐          │
│  │    │ │    │ │    │ │    │          │
│  │ 🎨 │ │ 🦸 │ │ 🦸 │ │ 🎨 │          │
│  │    │ │    │ │    │ │    │          │
│  └────┘ └────┘ └────┘ └────┘          │
│  Drawing 3D Char 3D Char Drawing        │
│                                         │
│  ┌────┐ ┌────┐                         │
│  │    │ │    │                         │
│  │ 🦸 │ │ 🎨 │                         │
│  │    │ │    │                         │
│  └────┘ └────┘                         │
│  3D Char Drawing                        │
│                                         │
└─────────────────────────────────────────┘
```

**Features:**
- **Grid Layout:** Responsive grid of character cards
- **Card Content:**
  - Thumbnail: Drawing (if in progress) or 3D character preview
  - Animation: 3D characters "dancing" (looping animation)
  - Status: "In Progress" or "Ready"
- **Interaction:**
  - Click card → Opens main view with that character
  - Hover → Preview animation
  - "Create New" button → Starts creation flow

**Card States:**
- **In Progress:** Shows drawing, progress indicator
- **Ready:** Shows 3D character, animated preview
- **Empty:** "Create New" placeholder card

**Note:** Gallery is session-only (no persistent storage per PRD). Characters are not saved between sessions.

### 5.3. Creation Flow

#### Step 1: Upload/Scan Drawing

**Interface:**
```
┌─────────────────────────────────────────┐
│  [← Back] Step 1: Draw Your Superhero    │
├─────────────────────────────────────────┤
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  [Fixed Humanoid Template]        │ │
│  │  (Draw directly on template)     │ │
│  └───────────────────────────────────┘ │
│                                         │
│         ┌───────────────┐              │
│         │               │              │
│         │  [📷 Camera]  │              │
│         │  [📁 Upload]   │              │
│         │               │              │
│         └───────────────┘              │
│                                         │
│  Draw on template or scan your drawing  │
│                                         │
└─────────────────────────────────────────┘
```

**Features:**
- **Template Constraint (Critical):** Fixed humanoid silhouette template must be used (per PRD FEAT-01)
- Large upload area with template overlay
- Camera button (opens device camera for scanning)
- File upload button (for pre-drawn template)
- Drag-and-drop support
- Preview of uploaded/scanned template drawing
- Template validation (ensures humanoid structure maintained)
- "Next" button (enabled after valid template upload)

#### Step 2: Enhance with AI (Optional - Future Phase)

**Note:** This step is not in the current PRD/SDD scope. It may be added in future phases as an optional enhancement step. For now, Step 1 flows directly to Step 3 (3D Generation).

**If implemented:**
- Side-by-side comparison
- "Enhance" button (calls AI API)
- "Skip" option (use original)
- Loading state during enhancement
- "Next" proceeds to 3D generation

#### Step 3: Generate 3D Character

**Interface:**
```
┌─────────────────────────────────────────┐
│  [← Back] Step 3: Creating Your Hero     │
├─────────────────────────────────────────┤
│                                         │
│        3D Character Preview             │
│        (Updates as steps complete)      │
│                                         │
├─────────────────────────────────────────┤
│  Progress:                              │
│  ✅ Image to 3D (<40s)                   │
│  ✅ Remeshing                            │
│  ✅ Texturing                            │
│  🔄 Rigging... (<10s remaining)          │
│  ⏳ Storage & Delivery                   │
│                                         │
│  [Progress Bar: 60%]                    │
│  [Time Remaining: 25s]                  │
│                                         │
│  ⚠️ If generation takes >50s, fallback   │
│     to texture mapping (Tier 2)         │
└─────────────────────────────────────────┘
```

**Features:**
- **Progressive Asset Display:** Show each step's result
- **Progress Indicator:** Clear progress through steps
- **Time Estimates:** Show remaining time for current step
- **3D Preview:** Updates as each step completes
- **Time Budget Display:** Shows time remaining (must complete in <60s per PRD)
- **Tier 2 Fallback Indicator:** Shows if fallback will be used (per SDD 3.1)
- **"READY" Indicator (FEAT-03):** Large, prominent "READY" cue when character is ready
- **Auto-advance:** Moves to main view when complete

**Asset Progression (per SDD 2.2):**
1. **T1: Scan & Upload** (<3s) - Template validation
2. **T2: Image to 3D** (<40s) - Meshy AI generates mesh
3. **T3: Auto-Rigging** (<10s) - Meshy applies Mixamo-compatible skeleton
4. **T4: Storage & Delivery** (<5s) - Temporary cloud storage, signed URL
5. **T5: Notification** (<1s) - Backend notification to frontend

**Tier 2 Fallback (Critical - per SDD 3.1):**
- **50-second hard-switch timer:** If Tier 1 not complete in 50s, automatically switch to Tier 2
- **Tier 2 Process:** Generate texture map only, apply to pre-approved `base_superhero_rig.glb`
- **UI Update:** Show "Using fallback mode" indicator
- **Guarantee:** Every participant gets a working character within 60s

---

## 6. Navigation & Flow Control

### 6.1. Navigation Structure

**Phase 1 (Simple):**
```
Character Selector → Main View
```

**Phase 2 (Complete):**
```
Splash → Gallery ↔ Main View
         ↓
    Creation Flow → Main View
```

### 6.2. Back Navigation

- **Gallery → Main View:** "Back to Gallery" button
- **Creation Flow:** "← Back" button in each step
- **Main View → Gallery:** Top bar button (Phase 2)

### 6.3. State Persistence

- **Gallery:** Remembers scroll position
- **Creation Flow:** Can go back to previous steps
- **Main View:** Remembers tab selection, animation state

---

## 7. Component Specifications

### 7.1. Character Card (Gallery)

**Structure:**
```
┌─────────────────┐
│  [Thumbnail]    │
│  (Animated if   │
│   3D character) │
├─────────────────┤
│ Character Name  │
│ Status Badge    │
└─────────────────┘
```

**States:**
- **In Progress:** Drawing thumbnail, "Creating..." badge
- **Ready:** 3D character preview (animated), "Ready" badge
- **Empty:** "Create New" placeholder

### 7.2. Progress Stepper (Creation Flow)

**Visual:**
```
Step 1 ─── Step 2 ─── Step 3 ─── Step 4
  ✅         ✅         🔄         ⏳
Upload    Enhance   Generate   Animate
```

**Features:**
- Shows current step
- Completed steps: Checkmark
- Current step: Spinner/indicator
- Future steps: Grayed out

### 7.3. Asset Progression Viewer

**Layout:**
- **Left:** List of steps with status
- **Right:** 3D preview (updates as steps complete)
- **Visual:** Each step shows its output when complete

---

## 8. Visual Design

### 8.1. Color Palette (Bright & Modern)

| Element | Color | Usage |
| :--- | :--- | :--- |
| **Background** | White (#ffffff) or Light Gray (#f8f9fa) | Main backgrounds |
| **3D Viewer BG** | Dark Gray (#1a1a1a) | 3D scene contrast |
| **Primary** | Bright Blue (#3b82f6) | Primary actions, active states |
| **Secondary** | Gray (#6b7280) | Secondary elements |
| **Success** | Green (#10b981) | Completed steps, success |
| **Warning** | Yellow (#f59e0b) | In progress, warnings |
| **Error** | Red (#ef4444) | Errors |
| **Text Primary** | Dark Gray (#111827) | Main text |
| **Text Secondary** | Medium Gray (#6b7280) | Secondary text |
| **Borders** | Light Gray (#e5e7eb) | Subtle dividers |

### 8.2. Typography

- **Font:** System fonts (San Francisco, Segoe UI, Roboto)
- **Headers:** 24-32px, Semi-bold
- **Body:** 14-16px, Regular
- **Labels:** 12-14px, Regular
- **Small:** 11-12px, Regular

### 8.3. Spacing

- **Container:** 24px padding
- **Sections:** 32px gaps
- **Elements:** 16px gaps
- **Tight:** 8px gaps
- **Border Radius:** 8-12px
- **Shadows:** Subtle (0 2px 8px rgba(0,0,0,0.08))

---

## 9. Animation Source Tabs (Detailed)

### 9.1. Tab 1: GLB Animation

**Controls:**
- Animation selector (dropdown)
- Timeline scrubber
- Loop toggle
- Speed control (0.5x - 2x)
- Compact horizontal layout

### 9.2. Tab 2: Synthetic Animation

**Controls:**
- Bone sliders (X, Y, Z per bone)
- Keyframe timeline
- Add/delete keyframe buttons
- Playback controls

**Unified with Manual:**
- Same bone slider component
- Timeline only in Synthetic mode
- Manual = Synthetic with no keyframes

### 9.3. Tab 3: Manual Pose

**Controls:**
- Bone sliders only (no timeline)
- Per-bone reset buttons
- Optional preset poses (T-pose, A-pose)

**Layout:**
- Scrollable list of bone groups
- Clean, organized by body part (optional)

### 9.4. Tab 4: Video Tracking

**Layout:**
- **Wider than other tabs** (video needs space)
- **Split:** Video preview + controls

**Video Preview:**
- Larger size (400px+ width)
- MediaPipe overlay (toggleable)
- Aspect ratio maintained
- Playback controls

**Tracking Controls:**
- Start/Stop tracking button
- Video source selector
- Tracking status indicator
- Skeleton overlay toggle

---

## 10. Global Controls

### 10.1. Play/Pause

- **Location:** Bottom bar, always visible
- **Behavior:** Controls current animation source
- **States:** Play (▶) or Pause (⏸)
- **Disabled:** In Manual pose tab (no animation)

### 10.2. Skeleton Toggle

- **Location:** Bottom bar
- **Behavior:** Toggles both 3D model skeleton AND MediaPipe overlay
- **Synchronized:** One toggle controls both

### 10.3. Reset (FEAT-05)

- **Location:** Top bar, prominent position
- **Behavior:** 
  - **Dedicated RESET button** (per PRD FEAT-05)
  - Clears canvas, deletes asset URL, clears all local/session state
  - Prepares system for next participant in <3s
- **Purpose:** Maximize throughput at festival installation
- **Visual:** Large, clearly labeled "RESET" button

---

## 11. Progressive Implementation Plan

### Phase 1: Core Animation (Current Focus)

**Goal:** MediaPipe → Meshy rig conversion interface

**Features:**
1. Main view with 3D viewer
2. Character selection (simple, server API + dev local)
3. Four animation source tabs
4. Video tracking tab with MediaPipe
5. Global play/pause and skeleton toggle

**UI Structure:**
- Simple, focused on animation
- Character selector as modal/overlay
- No gallery, no creation flow yet
- Foundation for future phases

### Phase 2: Gallery & Creation Flow

**Goal:** Complete character creation journey

**Features:**
1. Splash screen
2. Gallery view with character cards
3. Creation flow (upload → enhance → generate)
4. Asset progression visualization
5. Navigation between gallery and main view

**Integration:**
- Gallery replaces simple character selector
- Creation flow feeds into main view
- Main view structure unchanged (progressive enhancement)

### Phase 3: Advanced Features

**Goal:** Polish and sharing

**Features:**
1. **Video Download (FEAT-04):** 10-second video clip of AR session
   - Download button or QR code
   - No login required
   - Simple, non-login download mechanism
2. Screen recording (future enhancement)
3. Share functionality
4. Enhanced gallery interactions
5. Character editing/management

**Note:** Gallery view (Phase 2) is for current session only - no persistent storage per PRD constraint (no user accounts).

---

## 12. Performance & Constraints (from PRD/SDD)

### 12.1. Performance Requirements

| Constraint | Target | UI Impact |
| :--- | :--- | :--- |
| **Pose Latency** | **<150ms** | UI must show real-time updates without noticeable lag |
| **Asset Processing** | **<60s total** | Progress indicators must show clear time remaining |
| **Reset Time** | **<3s** | Reset button must provide immediate visual feedback |

### 12.2. User Experience Constraints

**No Persistent Storage (per PRD):**
- Gallery view is session-only (not persisted between sessions)
- Video clips are temporary (download only, not stored)
- No user accounts or login required
- Clear indication to users that data is session-only

---

## 13. Technical Architecture for Evolution

### 13.1. View Management

**Structure:**
```javascript
// Views are separate, composable
- SplashView (Phase 2)
- GalleryView (Phase 2)
- CreationFlowView (Phase 2)
- MainView (Phase 1 - core)
  - CharacterViewer
  - AnimationTabs
  - GlobalControls
```

**Navigation:**
- Router or view manager
- State management for current view
- Smooth transitions between views

### 13.2. Component Reusability

**Shared Components:**
- Character card (used in gallery and selector)
- Bone sliders (used in Manual and Synthetic)
- 3D viewer (used in main view and creation flow)
- Progress indicators (used in creation flow)

### 13.3. State Management

**Global State:**
- Current view
- Selected character
- Animation source state
- Creation flow progress

**Local State:**
- Tab-specific data
- UI interactions
- Temporary selections

---

## 14. Character Selection Evolution

### Phase 1: Simple Selector

**Implementation:**
- Modal/dialog overlay
- Grid of thumbnails from API
- Dev mode: Local upload
- Select → Load main view

### Phase 2: Gallery Integration

**Evolution:**
- Character selector becomes gallery view
- Gallery shows created characters
- Click character → Main view
- "Create New" → Creation flow

**Backward Compatibility:**
- API character selection still works
- Dev mode still available
- Gallery is enhancement, not replacement

---

## 15. Creation Flow Details

### 15.1. Step 1: Upload/Scan

**Interface:**
- Large upload area (drag-and-drop)
- Camera button (device camera)
- File picker button
- Preview of uploaded image
- Validation (file type, size)
- "Next" button

**Error Handling:**
- Invalid file type: Clear message
- File too large: Size limit message
- Camera unavailable: Fallback to upload

### 15.2. Step 2: Enhance (Optional - Future)

**Interface:**
- Side-by-side comparison
- Original on left, enhanced on right
- "Enhance" button (calls AI API)
- Loading state during processing
- "Skip" option (use original)
- "Previous" and "Next" buttons

**AI Integration:**
- Calls OpenAI/Sora API
- Shows progress during enhancement
- Error handling with retry option
- Preview before proceeding

### 15.3. Step 3: Generate 3D

**Interface:**
- **Left Panel:** Progress steps list
- **Right Panel:** 3D preview (updates progressively)
- **Progress Bar:** Overall completion
- **Time Estimates:** Per step

**Meshy API Integration:**
- Step 1: Image to 3D → Show mesh
- Step 2: Remeshing → Show improved mesh
- Step 3: Texturing → Show textured model
- Step 4: Rigging → Show rigged skeleton
- Step 5: Animation → Show animated character

**Visualization:**
- Each step updates the 3D preview
- Progress indicator shows current step
- Completed steps show checkmarks
- Auto-advance to main view when done

---

## 16. Future Features (Phase 3+)

### 16.1. Screen Recording

**Location:** Main view, top bar
**Features:**
- Record button (start/stop)
- Recording indicator
- Save recording
- Share functionality

### 16.2. Character Management

**Features:**
- Edit character name
- Delete character
- Duplicate character
- Export character

### 16.3. Enhanced Gallery

**Features:**
- Search/filter characters
- Sort options
- Categories/tags
- Bulk actions

---

## 17. Success Criteria (from PRD)

| Metric | Target | Rationale | Phase |
| :--- | :--- | :--- | :--- |
| **AR Latency (Pose Update)** | **<150ms** | Critical for experience feeling instantaneous (PRD) | Phase 1 |
| **Body Mimicry Accuracy** | **>90% visual fidelity** | Main indicator of "magic" - no joint clipping/floating (PRD) | Phase 1 |
| **End-to-End Asset Processing** | **<60s** | Ensures high throughput at festival (PRD) | Phase 2 |
| **Character Generation Success** | **>90%** | Reliability of asset pipeline (PRD) | Phase 2 |
| **Reset Time** | **<3s** | Maximize participant throughput (PRD FEAT-05) | Phase 1 |
| **Tab Switch Time** | <100ms | UI responsiveness | Phase 1 |
| **User Clarity** | <5s to understand | Intuitive for children (ages 6-12) | All phases |

---

## 17. Open Questions

1. **Gallery Layout:**
   - How many characters expected?
   - Grid size preferences?
   - Search needed?

2. **Creation Flow:**
   - Can users skip enhance step? (Note: Enhance step is optional/future)
   - Can they go back and re-enhance?
   - What if 3D generation fails? (Answer: Tier 2 fallback per SDD - texture mapping)

3. **Navigation:**
   - Breadcrumbs or back buttons?
   - Can users jump between steps?
   - Save progress between sessions? (Note: No persistent storage per PRD - session only)

4. **Character Cards:**
   - What info shown? (name, date, status?)
   - Animation preview length?
   - Click behavior?

5. **Asset Progression:**
   - Show all steps or just current?
   - Can users download intermediate assets?
   - Preview quality vs. final quality?

---

**Document Status:** Draft v1.0 (Progressive Design)  
**Last Updated:** [Current Date]  
**Next Review:** After Phase 1 implementation
