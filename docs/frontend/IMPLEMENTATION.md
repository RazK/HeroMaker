# Frontend Implementation Guide

Complete guide to implementing HeroMaker's 3D user interface, from setup to deployment.

---

## Prerequisites

- Modern web browser (Chrome, Firefox, Safari, Edge)
- Basic HTML/CSS/JavaScript knowledge
- Node.js (optional, for build tools later)

---

## Quick Setup

### 1. Create Frontend Directory Structure

```bash
cd /Users/razkarl/projects/HeroMaker
mkdir -p frontend/{css,js/{core,scenes,components,utils},assets}
```

### 2. Set Up Basic HTML

Create `frontend/index.html` with Three.js and basic structure.

### 3. Mock API Client

Create `frontend/js/api.js` with mock API responses. See API Integration sections below for API requirements.

---

## Testing Your First Scene

```bash
# Serve frontend (simple HTTP server)
cd frontend
python -m http.server 8001
# Or: npx serve .

# Open in browser
open http://localhost:8001
```

---

## Key Concepts

- **Three Scenes**: Lobby (browse), Studio (create), Stage (view)
- **Smooth Transitions**: Camera interpolation between scenes
- **Backdrop Blur UI**: Modern glass morphism effects for overlays
- **API Polling**: Poll every 2 seconds for progress updates
- **File System Truth**: Task status inferred from file existence

---

## Essential Reading Order

1. **This document** - Complete 3D UI design and implementation guide (20 min)
2. **[API_REFERENCE.md](../shared/API_REFERENCE.md)** - All available endpoints (15 min)
3. **[USER_JOURNEYS.md](./USER_JOURNEYS.md)** - User flows and interactions (10 min)

---

# Frontend UI Design

Complete design and implementation guide for HeroMaker's 3D user interface, featuring three interconnected scenes with smooth camera transitions.

**Related Documentation:**
- [API_REFERENCE.md](../shared/API_REFERENCE.md) - Complete API endpoint documentation
- [USER_JOURNEYS.md](./USER_JOURNEYS.md) - User flows and interactions
- [TASK_CONFIGURATION.md](../backend/TASK_CONFIGURATION.md) - Task definitions

---

## Overview

Implement three interconnected 3D scenes with smooth camera transitions, creating an immersive experience similar to Needle.tools. Each scene represents a different application state: **Lobby** (browse characters), **Studio** (pipeline progress), and **Stage** (view completed VRM).

---

## Design Patterns from Needle.tools

Based on analysis of Needle.tools implementation, the following patterns should be incorporated:

### UI Overlay System

- **Backdrop Blur Effects**: Content blocks use `backdrop-filter: blur(40px) saturate(1.4)` for modern glass morphism effect
- **Floating Content Blocks**: UI elements positioned absolutely over 3D scene with semi-transparent backgrounds
- **Color Themes per Scene**: Each scene has a distinct color theme defined via CSS variables (e.g., `--scene-color: #FEAD8B`)
- **Smooth Opacity Transitions**: Use `transition: opacity .3s ease-in-out` for scene fades
- **Content Block Styling**: Rounded corners (40px), subtle borders (`outline: 1px solid #ffffff2b`), soft shadows

### Scene Color Themes

- **Lobby**: Warm, inviting colors (e.g., `#FEAD8B` or `#13a3f3` blue)
- **Studio**: Dark, focused colors (e.g., `#1a1a1a` or `#40393b`)
- **Stage**: Theatre-inspired colors (e.g., `#0a0a0a` with warm accents)

### Transition System

- **Fade Duration**: 0.3s for opacity transitions
- **Easing**: `ease-in-out` for smooth feel
- **Content Block Animation**: Blocks fade in/out with scene transitions
- **Pointer Events**: Use `pointer-events: none` on wrapper, `pointer-events: auto` on interactive elements

---

## Scene 1: Lobby

### Design

- Circular/spiral arrangement of character pedestals
- Central focal point with ambient lighting
- Dark, reflective floor surface
- High ceiling with soft ambient light
- Each character on pedestal with slow rotation
- Subtle glow/halo around characters
- Floating nameplates above characters

### Camera System

- Orbital camera around center (10-15 units distance)
- Slightly elevated view (15° angle)
- Smooth orbit on mouse drag/touch
- Scroll to zoom
- Click character: smooth focus transition

### Lighting

- Soft directional light from above
- Point lights near each character
- Low-intensity ambient fill
- Cool tones (blues/cyans) with warm accents

### Interactions

- Hover: character scales up, glow intensifies
- Click character: transition to Stage scene
- "Make A New Hero" button: floating CTA with glow
- Click CTA: transition to Studio scene

### API Integration

**Required API Calls:**

1. **GET /api/characters** - Fetch completed characters for gallery display
   - Query params: `limit`, `offset` (for pagination)
   - Returns: Array of character objects with thumbnails, names, creation dates
   - Used: On scene load, refresh gallery
   - See [API_REFERENCE.md](../shared/API_REFERENCE.md#get-apicharacters) for full details

2. **POST /api/creations** - Create new creation (triggered by "Make A New Hero" button)
   - Request: Empty body `{}`
   - Returns: Creation object with `id`, `status`, `current_task`, `tasks` array
   - Used: When user clicks "Make A New Hero" button
   - See [API_REFERENCE.md](../shared/API_REFERENCE.md#post-apicreations) for full details

3. **GET /api/auth/me** - Get current user (optional, for V2 uses debug user)
   - Returns: User object with `id`, `email`, `username`
   - Used: On app initialization
   - See [API_REFERENCE.md](../shared/API_REFERENCE.md#get-apiauthme) for full details

4. **GET /api/files/{file_path}** - Serve character thumbnails
   - Path: `/api/files/permanent/debug/{creation_id}/rendered.png`
   - Returns: Image file (PNG/JPEG)
   - Used: Display character thumbnails on pedestals
   - See [API_REFERENCE.md](../shared/API_REFERENCE.md#get-apifilesfile_path) for full details

**API Call Flow:**
1. On load: `GET /api/auth/me` → `GET /api/characters?limit=20`
2. On "Make A New Hero": `POST /api/creations` → Navigate to Studio scene with creation_id
3. On character click: Navigate to Stage scene with character_id

### Implementation Files

- `frontend/js/scenes/LobbyScene.js` - Main scene class
- `frontend/js/components/CharacterPedestal.js` - Individual character display
- `frontend/js/components/OrbitalControls.js` - Camera controls

---

## Scene 2: Studio

### Design

- Central workspace/platform
- 3D pipeline path/road extending forward
- 11 task milestones as 3D markers
- Current task highlighted with effects
- Dark studio environment, focused lighting

### Pipeline Visualization

- 3D road/path with milestones
- Completed: glowing, checkmark, lit path
- Current: pulsing glow, animated indicator
- Pending: dim, unlit path ahead
- 3D progress bar showing overall completion

### Workspace Area

- Central platform for current step preview
- Step 1 (image_capture): Camera feed on screen/plane
- Steps 2-3 (image_processing, chatgpt_render): Image previews on screens
- Steps 4-9 (meshy tasks): GLB models on platform
- Step 10 (convert_vrm): Final VRM character on platform

### Camera System

- Elevated view looking down (~30°)
- 8-10 units from center
- Limited pan/zoom (focused view)
- Auto-focus on current task
- Smooth movement when tasks complete

### Lighting

- Spotlight on current task
- Low ambient (dark studio feel)
- Colored accent lights per task type
- Path lighting increases with progress

### Interactions

- Click task markers: show details
- Character name: editable 3D text or UI overlay
- Progress indicators: 3D progress bars
- Controls: pause/resume, retry (future)

### API Integration

**Required API Calls:**

1. **GET /api/creations/{creation_id}** - Get creation status with full task list
   - Returns: Creation object with `status`, `current_task`, `character_name`, `tasks` array
   - Used: Initial load, periodic polling (every 2 seconds) for progress updates
   - See [API_REFERENCE.md](../shared/API_REFERENCE.md#get-apicreationscreation_id) for full details

2. **GET /api/creations/{creation_id}/progress** - Get detailed progress metrics
   - Returns: `overall_progress`, `current_task_progress`, `completed_tasks`, `processing_task`, `pending_tasks`
   - Used: Update progress bars and task status indicators
   - See [API_REFERENCE.md](../shared/API_REFERENCE.md#get-apicreationscreation_idprogress) for full details

3. **POST /api/creations/{creation_id}/tasks/{task_name}** - Execute/trigger a task
   - Path params: `creation_id`, `task_name` (e.g., "image_capture", "chatgpt_render")
   - Request: For `image_capture` - `multipart/form-data` with `file` field (webcam capture or file upload)
   - Returns: Task status and `file_url` if output file created
   - Used: 
     - Trigger `image_capture` task with webcam/file upload
     - Auto-trigger next task when previous completes
   - See [API_REFERENCE.md](../shared/API_REFERENCE.md#post-apicreationscreation_idtaskstask_name) for full details

4. **PATCH /api/creations/{creation_id}** - Update character name
   - Request: `{ "character_name": "New Name" }`
   - Returns: Updated creation object
   - Used: When user edits character name in UI
   - See [API_REFERENCE.md](../shared/API_REFERENCE.md#patch-apicreationscreation_id) for full details

5. **GET /api/files/{file_path}** - Serve task output files for preview
   - Path examples:
     - `/api/files/temp/debug/{creation_id}/scanned.jpg` (image_processing output)
     - `/api/files/temp/debug/{creation_id}/rendered.png` (chatgpt_render output)
     - `/api/files/temp/debug/{creation_id}/model.glb` (meshy_3d output)
   - Returns: Binary file (image, GLB, etc.)
   - Used: Display previews of completed tasks in workspace area
   - See [API_REFERENCE.md](../shared/API_REFERENCE.md#get-apifilesfile_path) for full details

6. **POST /api/creations/{creation_id}/tasks/{task_name}/retry** - Retry failed task
   - Returns: Task status reset to "processing"
   - Used: When user clicks retry button on failed task
   - See [API_REFERENCE.md](../shared/API_REFERENCE.md#post-apicreationscreation_idtaskstask_nameretry) for full details

**API Call Flow:**
1. On scene load: `GET /api/creations/{creation_id}` → Display current state
2. Polling loop (every 2s): `GET /api/creations/{creation_id}/progress` → Update UI
3. On webcam capture: `POST /api/creations/{creation_id}/tasks/image_capture` (with file) → Auto-trigger next task
4. On task completion: Auto-trigger next task via `POST /api/creations/{creation_id}/tasks/{next_task_name}`
5. On name edit: `PATCH /api/creations/{creation_id}` → Update character name
6. On file preview: `GET /api/files/{file_path}` → Display in workspace

**Polling Strategy:**
- Poll `GET /api/creations/{creation_id}/progress` every 2 seconds while `status === "processing"`
- Stop polling when `status === "completed"` or `status === "failed"`
- Show loading states during API calls

### Implementation Files

- `frontend/js/scenes/StudioScene.js` - Main scene class
- `frontend/js/components/PipelineRoad.js` - 3D pipeline visualization
- `frontend/js/components/TaskMilestone.js` - Individual task marker
- `frontend/js/components/WorkspacePreview.js` - Current step preview

---

## Scene 3: Stage

### Design

- Central stage/platform for VRM character
- Elevated platform (theatre stage)
- Background with depth
- Optional: subtle audience seating or gallery walls
- Sidebar area for pipeline history

### Stage Area

- Central platform with VRM character
- Soft spotlight on character
- Optional rotating base (slow rotation)
- Webcam feed: small preview window

### Pipeline History

- 3D timeline or carousel on side
- Thumbnails of each step
- Clickable to view details
- Smooth scroll/rotation

### Camera System

- Front-facing, slightly elevated (~20°)
- 5-7 units from character
- Orbital around character (mouse/touch)
- Adjustable zoom
- Optional auto-rotate
- Character-centered focus

### Lighting

- Main spotlight on character (theatre-style)
- Rim backlight for separation
- Low ambient (dark theatre feel)
- Subtle colored accent lights

### Interactions

- Character: full VRM with webcam tracking
- Pipeline history: click to view step details
- Character name: displayed prominently
- Back button: return to Lobby
- Controls: toggle webcam, rotate, zoom

### API Integration

**Required API Calls:**

1. **GET /api/characters/{character_id}** - Get character details for display
   - Returns: Character object with `character_name`, `vrm_url`, `task_history` array
   - Used: On scene load to get character data and pipeline history
   - See [API_REFERENCE.md](../shared/API_REFERENCE.md#get-apicharacterscharacter_id) for full details

2. **GET /api/files/{file_path}** - Serve VRM file and pipeline history files
   - Path examples:
     - `/api/files/permanent/debug/{creation_id}/{creation_id}.vrm` (VRM file)
     - `/api/files/permanent/debug/{creation_id}/scanned.jpg` (pipeline history)
     - `/api/files/permanent/debug/{creation_id}/rendered.png` (pipeline history)
   - Returns: Binary files (VRM, images)
   - Used: 
     - Load VRM character for display
     - Display pipeline history thumbnails
   - See [API_REFERENCE.md](../shared/API_REFERENCE.md#get-apifilesfile_path) for full details

**API Call Flow:**
1. On scene load: `GET /api/characters/{character_id}` → Get character data
2. Load VRM: `GET /api/files/permanent/debug/{creation_id}/{creation_id}.vrm` → Display character
3. Load history: `GET /api/files/{file_path}` for each task in `task_history` → Display thumbnails

### Implementation Files

- `frontend/js/scenes/StageScene.js` - Main scene class
- `frontend/js/components/VRMStage.js` - Stage and character display
- `frontend/js/components/PipelineHistory.js` - Sidebar history display
- `frontend/js/vrm-viewer.js` - Extracted VRM viewer module

---

## Scene Transitions

### Transition System

- Smooth camera interpolation (1-2 second duration)
- Ease-in-out easing (cubic or exponential)
- Curved camera paths (not linear)
- Scene fade out/in (0.3s each)
- Optional crossfade for smoother feel
- Object animations during transition

### Specific Transitions

1. **Lobby → Studio**: Camera pulls back, rotates, moves into studio
   - Trigger: User clicks "Make A New Hero" button
   - Data: Pass `creation_id` from `POST /api/creations` response

2. **Lobby → Stage**: Camera moves toward character, zooms in, focuses
   - Trigger: User clicks character in gallery
   - Data: Pass `character_id` from character object

3. **Studio → Stage**: Camera pulls back, rotates, moves to stage
   - Trigger: Creation completes (`status === "completed"`)
   - Data: Use current `creation_id`

4. **Stage → Lobby**: Camera pulls back, rotates, moves to lobby view
   - Trigger: User clicks "Back to Gallery" button
   - Data: None required

5. **Studio → Lobby**: Camera pulls back, rotates to lobby
   - Trigger: User clicks "Back" or cancels creation
   - Data: None required

### Implementation Files

- `frontend/js/core/SceneManager.js` - Manages scene transitions
- `frontend/js/core/CameraController.js` - Handles camera animations
- `frontend/js/utils/Transitions.js` - Transition utilities

---

## Technical Architecture

### Core Systems

- **Scene Manager**: Orchestrates scene switching and lifecycle
- **Camera Controller**: Handles all camera movements and animations
- **Renderer**: Three.js WebGL renderer setup
- **Asset Loader**: Loads 3D models, textures, VRM files
- **State Manager**: Tracks current scene and app state
- **API Client**: Handles all API calls (with mock mode for development)

### File Structure

```
frontend/
├── index.html
├── css/
│   ├── main.css                  # Base styles, CSS variables
│   ├── scenes.css                # Scene-specific styles
│   └── ui-overlays.css           # Backdrop blur, content blocks
├── js/
│   ├── app.js                    # Main app entry
│   ├── core/
│   │   ├── SceneManager.js       # Scene orchestration
│   │   ├── CameraController.js   # Camera system
│   │   └── Renderer.js           # Three.js setup
│   ├── scenes/
│   │   ├── LobbyScene.js         # Lobby scene
│   │   ├── StudioScene.js       # Studio scene
│   │   └── StageScene.js        # Stage scene
│   ├── components/
│   │   ├── CharacterPedestal.js
│   │   ├── PipelineRoad.js
│   │   ├── TaskMilestone.js
│   │   ├── WorkspacePreview.js
│   │   ├── VRMStage.js
│   │   ├── PipelineHistory.js
│   │   └── ContentBlock.js       # Floating UI blocks with backdrop blur
│   ├── vrm-viewer.js             # VRM viewer module
│   ├── api.js                    # API client (with mock mode)
│   └── utils/
│       ├── Transitions.js
│       └── Helpers.js
└── assets/
    └── (textures, models if needed)
```

---

## Implementation Steps

### Phase 1: Foundation (Steps 1-3)

1. Set up Three.js renderer and basic scene structure
2. Create SceneManager class for scene orchestration
3. Implement CameraController with smooth interpolation

### Phase 2: Lobby Scene (Steps 4-7)

4. Build LobbyScene with environment (floor, walls, lighting)
5. Create CharacterPedestal component for character displays
6. Implement orbital camera controls for lobby navigation
7. Add character hover/click interactions

### Phase 3: Studio Scene (Steps 8-12)

8. Build StudioScene with studio environment
9. Create PipelineRoad component (3D path visualization)
10. Implement TaskMilestone components for each task
11. Build WorkspacePreview for current step display
12. Add task status visualization and progress indicators

### Phase 4: Stage Scene (Steps 13-16)

13. Build StageScene with theatre environment
14. Create VRMStage component for character display
15. Extract and integrate VRM viewer module
16. Build PipelineHistory sidebar component

### Phase 5: Transitions (Steps 17-19)

17. Implement smooth camera transitions between scenes
18. Add scene fade in/out effects
19. Create transition animations for objects

### Phase 6: Integration (Steps 20-23)

20. Connect scenes to API (mock initially, then real API)
21. Implement backdrop blur UI overlays with glass morphism effects
22. Add floating content blocks with scene-specific color themes
23. Implement state management for scene switching

### Phase 7: Polish (Steps 24-26)

24. Add particle effects and atmospheric elements
25. Optimize performance (LOD, culling, etc.)
26. Add mobile touch controls and responsive adjustments

---

## API Requirements Summary

This section ensures all required API endpoints are documented. For complete API specifications, see [API_REFERENCE.md](../shared/API_REFERENCE.md).

### Authentication
- `GET /api/auth/me` - Get current user

### Creation Management
- `POST /api/creations` - Create new creation
- `GET /api/creations/{creation_id}` - Get creation status
- `GET /api/creations` - List creations (optional, for user's creations list)
- `PATCH /api/creations/{creation_id}` - Update character name
- `DELETE /api/creations/{creation_id}` - Delete creation (optional, for future features)

### Task Execution
- `POST /api/creations/{creation_id}/tasks/{task_name}` - Execute task (with file upload for image_capture)
- `GET /api/creations/{creation_id}/tasks/{task_name}` - Get task status (optional, for detailed task info)
- `POST /api/creations/{creation_id}/tasks/{task_name}/retry` - Retry failed task

### Progress Tracking
- `GET /api/creations/{creation_id}/progress` - Get detailed progress metrics

### File Serving
- `GET /api/files/{file_path}` - Serve all file types (images, GLB, VRM)

### Gallery/Characters
- `GET /api/characters` - List completed characters for gallery
- `GET /api/characters/{character_id}` - Get character details for Stage scene

---

## Reference Documentation

- [API_REFERENCE.md](../shared/API_REFERENCE.md) - Complete API endpoint documentation
- [USER_JOURNEYS.md](./USER_JOURNEYS.md) - User flows showing frontend-backend interactions
- [TASK_CONFIGURATION.md](../backend/TASK_CONFIGURATION.md) - Task definitions and file mappings
- [ARCHITECTURE.md](../shared/ARCHITECTURE.md) - High-level system architecture
- [SETUP.md](../backend/SETUP.md) - Backend error handling patterns

## Design Inspiration

The UI design is inspired by Needle.tools:
- Backdrop blur effects for modern glass morphism
- Smooth camera transitions between scenes
- Floating content blocks over 3D environment
- Scene-specific color themes

## Need Help?

- See [USER_JOURNEYS.md](./USER_JOURNEYS.md) for detailed frontend-backend interactions
- Check [ARCHITECTURE.md](../shared/ARCHITECTURE.md) for system overview
