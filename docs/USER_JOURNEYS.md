# User Journeys and System Interactions

This document demonstrates how frontend, backend, and database interact during user journeys.

---

## Journey 1: Making A New Hero - Complete Flow

### Step 1: User clicks "Make A New Hero"

**Frontend:**
- User clicks button in Browse state
- Frontend calls: `POST /api/creations`

**Backend:**
- Receives request
- Gets current user (debug user for V2)
- Creates new creation record in database

**Database:**
```sql
INSERT INTO creations (id, user_id, status, current_task, created_at)
VALUES ('abc-123', 'debug-user-uuid', 'pending', 'webcam_scan', NOW());
```

**Backend Response:**
```json
{
  "id": "abc-123",
  "status": "pending",
  "current_task": "webcam_scan",
  "character_name": null,
  "user_id": "debug-user-uuid",
  "created_at": "2024-01-01T10:00:00Z",
  "tasks": [
    {"name": "webcam_scan", "status": "pending", "output_file": "scan.jpg"},
    {"name": "image_processing", "status": "pending", "output_file": "scanned.jpg"},
    // ... all tasks
  ]
}
```

**Frontend:**
- Receives creation response
- Transitions to Create state
- Shows roadmap with first task (webcam_scan) highlighted
- Displays webcam capture interface

---

### Step 2: User captures webcam image

**Frontend:**
- User positions drawing in front of webcam
- User clicks "Capture"
- Frontend processes image (scanning/cleanup) using frontend library
- Frontend calls: `POST /api/creations/abc-123/tasks/webcam_scan` with processed image file

**Backend:**
- Receives file upload
- Validates file
- Saves file to: `assets/temp/debug/abc-123/scan.jpg`
- Updates database

**Database:**
```sql
UPDATE creations 
SET current_task = 'image_processing', 
    status = 'processing',
    updated_at = NOW()
WHERE id = 'abc-123';
```

**File System:**
```
assets/temp/debug/abc-123/
  scan.jpg  ← File created
```

**Backend Response:**
```json
{
  "task_name": "webcam_scan",
  "status": "completed",
  "output_file": "scan.jpg",
  "file_url": "/api/files/temp/debug/abc-123/scan.jpg"
}
```

**Frontend:**
- Receives completion
- Updates UI: webcam_scan task marked complete
- Auto-triggers next task: `POST /api/creations/abc-123/tasks/image_processing`

---

### Step 3: Image processing (auto-triggered)

**Frontend:**
- Calls: `POST /api/creations/abc-123/tasks/image_processing`

**Backend:**
- Checks: Does `scan.jpg` exist? Yes
- Processes image (if needed, or frontend already did it)
- Saves: `assets/temp/debug/abc-123/scanned.jpg`
- Updates database

**Database:**
```sql
UPDATE creations 
SET current_task = 'chatgpt_render',
    updated_at = NOW()
WHERE id = 'abc-123';
```

**File System:**
```
assets/temp/debug/abc-123/
  scan.jpg
  scanned.jpg  ← New file
```

**Backend Response:**
```json
{
  "task_name": "image_processing",
  "status": "completed",
  "output_file": "scanned.jpg",
  "file_url": "/api/files/temp/debug/abc-123/scanned.jpg"
}
```

**Frontend:**
- Updates UI: image_processing task complete
- Auto-triggers: `POST /api/creations/abc-123/tasks/chatgpt_render`

---

### Step 4: ChatGPT render (auto-triggered)

**Frontend:**
- Calls: `POST /api/creations/abc-123/tasks/chatgpt_render`

**Backend:**
- Checks: Does `scanned.jpg` exist? Yes
- Calls ChatGPT API with image
- Stores ChatGPT task ID in metadata
- Updates database

**Database:**
```sql
UPDATE creations 
SET current_task = 'chatgpt_render',
    metadata = '{"chatgpt_task_id": "task_789"}',
    updated_at = NOW()
WHERE id = 'abc-123';
```

**Backend:**
- Calls ChatGPT API with image
- For streaming responses, polls for completion
- Backend calls: `GET https://api.openai.com/v1/threads/{thread_id}/runs/{run_id}` to check status
- Response includes completion status and result
- When complete, downloads rendered image
- Saves: `assets/temp/debug/abc-123/rendered.png`
- Extracts character name from ChatGPT response
- Updates database

**Database:**
```sql
UPDATE creations 
SET current_task = 'meshy_3d',
    character_name = 'Super Hero',
    metadata = '{"chatgpt_task_id": "task_789", "generated_name": "Super Hero"}',
    updated_at = NOW()
WHERE id = 'abc-123';
```

**File System:**
```
assets/temp/debug/abc-123/
  scan.jpg
  scanned.jpg
  rendered.png  ← New file
```

**Backend Response:**
```json
{
  "task_name": "chatgpt_render",
  "status": "completed",
  "output_file": "rendered.png",
  "file_url": "/api/files/temp/debug/abc-123/rendered.png",
  "metadata": {
    "generated_name": "Super Hero"
  }
}
```

**Frontend:**
- Updates UI: chatgpt_render complete
- Shows rendered image thumbnail
- Displays generated character name (user can edit)
- Auto-triggers: `POST /api/creations/abc-123/tasks/meshy_3d`

---

### Step 5: Meshy 3D conversion (auto-triggered)

**Frontend:**
- Calls: `POST /api/creations/abc-123/tasks/meshy_3d`

**Backend:**
- Checks: Does `rendered.png` exist? Yes
- Calls Meshy API image-to-3D endpoint
- Stores Meshy task ID
- Updates database

**Database:**
```sql
UPDATE creations 
SET current_task = 'meshy_3d',
    metadata = '{"meshy_3d_task_id": "meshy_task_456"}',
    updated_at = NOW()
WHERE id = 'abc-123';
```

**Backend:**
- Polls Meshy API every 5 seconds for task status
- Backend calls: `GET https://api.meshy.ai/v2/image-to-3d/{task_id}` to check progress
- Response includes: `{"status": "PROCESSING", "progress": 65}`
- Backend stores progress in creation metadata
- When status = "COMPLETED", downloads GLB file
- Saves: `assets/temp/debug/abc-123/model.glb`
- Updates database

**Database:**
```sql
UPDATE creations 
SET current_task = 'meshy_remesh',
    updated_at = NOW()
WHERE id = 'abc-123';
```

**File System:**
```
assets/temp/debug/abc-123/
  scan.jpg
  scanned.jpg
  rendered.png
  model.glb  ← New file
```

**Backend Response:**
```json
{
  "task_name": "meshy_3d",
  "status": "completed",
  "output_file": "model.glb",
  "file_url": "/api/files/temp/debug/abc-123/model.glb"
}
```

**Note:** During processing, backend polls Meshy API and updates metadata:
```json
{
  "task_name": "meshy_3d",
  "status": "processing",
  "metadata": {
    "meshy_task_id": "meshy_task_456",
    "meshy_status": "PROCESSING",
    "progress_percentage": 65,
    "last_polled": "2024-01-01T10:03:00Z"
  }
}
```

**Frontend:**
- Polls: `GET /api/creations/abc-123` every 2 seconds
- Sees meshy_3d status change to "completed"
- Updates UI: meshy_3d task complete
- Auto-triggers next task: `POST /api/creations/abc-123/tasks/meshy_remesh`

---

### Step 6-10: Remaining Meshy tasks (auto-triggered sequentially)

**Pattern repeats for:**
- meshy_remesh → remeshed.glb
- meshy_texture → textured.glb
- meshy_rig → rigged.glb
- meshy_animate → animated.glb
- select_glb → selected.glb (or references animated.glb)
- convert_vrm → abc-123.vrm (uses creation_id, not character_name)

**Each step:**
1. Frontend polls for status updates
2. Backend checks input file exists
3. Backend calls Meshy API (or runs conversion script)
4. Backend saves output file
5. Backend updates database `current_task`
6. Frontend updates UI
7. Auto-triggers next task

**Final state after convert_vrm:**

**Database:**
```sql
UPDATE creations 
SET current_task = 'complete',
    updated_at = NOW()
WHERE id = 'abc-123';
```

**File System:**
```
assets/temp/debug/abc-123/
  scan.jpg
  scanned.jpg
  rendered.png
  model.glb
  remeshed.glb
  textured.glb
  rigged.glb
  animated.glb
  selected.glb
  abc-123.vrm  ← Final file (uses creation_id)
```

---

### Step 11: Complete task (auto-triggered)

**Frontend:**
- Calls: `POST /api/creations/abc-123/tasks/complete`

**Backend:**
- Checks: Does `abc-123.vrm` exist? Yes (uses creation_id, not character_name)
- Moves all files from `temp/` to `permanent/`
- Updates database

**File System:**
```
# Files moved
assets/permanent/debug/abc-123/
  scan.jpg
  scanned.jpg
  rendered.png
  model.glb
  remeshed.glb
  textured.glb
  rigged.glb
  animated.glb
  selected.glb
  abc-123.vrm

# Temp directory cleaned up (or kept for reference)
```

**Database:**
```sql
UPDATE creations 
SET status = 'completed',
    current_task = NULL,
    completed_at = NOW(),
    updated_at = NOW()
WHERE id = 'abc-123';
```

**Backend Response:**
```json
{
  "task_name": "complete",
  "status": "completed"
}
```

**Frontend:**
- Receives completion
- Shows success message
- Transitions to Show state
- Loads VRM file for viewing

---

## Journey 2: Viewing Gallery

### Step 1: User opens gallery

**Frontend:**
- User in Browse state
- Frontend calls: `GET /api/characters?limit=20`

**Backend:**
- Queries database for completed creations

**Database:**
```sql
SELECT id, character_name, user_id, created_at
FROM creations
WHERE status = 'completed' AND is_public = true
ORDER BY created_at DESC
LIMIT 20;
```

**Backend Response:**
```json
{
  "characters": [
    {
      "id": "abc-123",
      "character_name": "Super Hero",
      "user_id": "debug-user-uuid",
      "scan_url": "/api/files/permanent/debug/abc-123/scanned.jpg",
      "rendered_url": "/api/files/permanent/debug/abc-123/rendered.png",
      "vrm_url": "/api/files/permanent/debug/abc-123/abc-123.vrm",
      "thumbnail_url": "/api/files/permanent/debug/abc-123/rendered.png",
      "created_at": "2024-01-01T10:00:00Z"
    }
    // ... more characters
  ],
  "total": 100,
  "limit": 20,
  "offset": 0
}
```

**Frontend:**
- Receives character list
- Displays characters in 3D circular arrangement
- Shows thumbnails and character names

---

### Step 2: User clicks character

**Frontend:**
- User clicks character in gallery
- Frontend calls: `GET /api/characters/abc-123`

**Backend:**
- Queries database for creation details
- Checks file system for all task outputs

**Database:**
```sql
SELECT * FROM creations WHERE id = 'abc-123' AND status = 'completed';
```

**File System Check:**
- Lists files in: `assets/permanent/debug/abc-123/`
- Infers completed tasks from file existence

**Backend Response:**
```json
{
  "id": "abc-123",
  "character_name": "Super Hero",
  "user_id": "debug-user-uuid",
  "scan_url": "/api/files/permanent/debug/abc-123/scanned.jpg",
  "rendered_url": "/api/files/permanent/debug/abc-123/rendered.png",
  "vrm_url": "/api/files/permanent/debug/abc-123/abc-123.vrm",
  "task_history": [
    {
      "name": "webcam_scan",
      "output_file": "scan.jpg",
      "file_url": "/api/files/permanent/debug/abc-123/scan.jpg"
    },
    {
      "name": "chatgpt_render",
      "output_file": "rendered.png",
      "file_url": "/api/files/permanent/debug/abc-123/rendered.png"
    }
    // ... all completed tasks
  ],
  "created_at": "2024-01-01T10:00:00Z"
}
```

**Frontend:**
- Receives character details
- Transitions to Show state
- Loads VRM file: `GET /api/files/permanent/debug/abc-123/abc-123.vrm` (uses creation_id)
- Displays character with webcam tracking
- Shows task history (scan, render, VRM) in UI

---

## Journey 3: Progress Polling During Creation

### User is watching creation progress

**Frontend:**
- User in Create state, watching progress
- Frontend polls every 2 seconds: `GET /api/creations/abc-123/progress`

**Backend:**
- Queries database for creation status
- Checks file system for completed tasks
- For current task, polls external API if needed

**Database:**
```sql
SELECT status, current_task, character_name, metadata, updated_at
FROM creations
WHERE id = 'abc-123';
```

**File System:**
- Lists files in: `assets/temp/debug/abc-123/`
- Determines which tasks are completed based on file existence

**External API Polling (if current_task is Meshy task):**
- Backend calls: `GET https://api.meshy.ai/v2/image-to-3d/{task_id}`
- Response: `{"status": "PROCESSING", "progress": 65}`
- Backend updates creation metadata with latest progress

**Backend Response:**
```json
{
  "creation_id": "abc-123",
  "status": "processing",
  "current_task": "meshy_remesh",
  "completed_tasks": ["webcam_scan", "image_processing", "chatgpt_render", "meshy_3d"],
  "processing_task": "meshy_remesh",
  "pending_tasks": ["meshy_texture", "meshy_rig", "meshy_animate", "select_glb", "convert_vrm", "complete"],
  "overall_progress": 36,  // 4 of 11 tasks done
  "current_task_progress": 65,  // From Meshy API polling (stored in metadata)
  "current_task_metadata": {
    "meshy_task_id": "meshy_task_456",
    "meshy_status": "PROCESSING",
    "last_polled": "2024-01-01T10:04:30Z"
  }
}
```

**Frontend:**
- Receives progress update
- Updates UI:
  - Shows completed tasks with checkmarks
  - Highlights current task (meshy_remesh)
  - Updates progress bar (36%)
  - Shows sub-task progress (65% for meshy_remesh)

---

## Journey 4: User Edits Character Name

### User changes character name during creation

**Frontend:**
- User sees generated name "Super Hero"
- User edits to "Amazing Hero"
- Frontend calls: `PATCH /api/creations/abc-123`

**Request:**
```json
{
  "character_name": "Amazing Hero"
}
```

**Backend:**
- Validates user owns creation (or is admin)
- Updates database

**Database:**
```sql
UPDATE creations 
SET character_name = 'Amazing Hero',
    updated_at = NOW()
WHERE id = 'abc-123' AND user_id = 'debug-user-uuid';
```

**Backend Response:**
```json
{
  "id": "abc-123",
  "character_name": "Amazing Hero",
  "updated_at": "2024-01-01T10:05:00Z"
}
```

**Frontend:**
- Receives update
- Updates UI with new name
- Note: VRM filename uses creation_id, not character_name, to avoid file system issues

---

## Journey 5: Error Handling - Task Failure

### Meshy task fails

**Backend:**
- Meshy API returns error
- Backend updates database

**Database:**
```sql
UPDATE creations 
SET status = 'failed',
    current_task = 'meshy_remesh',
    error_message = 'Meshy API error: Task timeout',
    updated_at = NOW()
WHERE id = 'abc-123';
```

**Frontend:**
- Polls: `GET /api/creations/abc-123`
- Receives response with status "failed"

**Backend Response:**
```json
{
  "id": "abc-123",
  "status": "failed",
  "current_task": "meshy_remesh",
  "error_message": "Meshy API error: Task timeout",
  "tasks": [
    // ... previous tasks marked completed
    {
      "name": "meshy_remesh",
      "status": "failed",
      "error": "Meshy API error: Task timeout"
    }
  ]
}
```

**Frontend:**
- Shows error message
- Displays "Retry" button on failed task
- User clicks retry: `POST /api/creations/abc-123/tasks/meshy_remesh/retry`

**Backend:**
- Retries Meshy API call
- Updates database status back to "processing"
- Process continues

---

## Data Flow Summary

**Frontend → Backend:**
- API calls: POST, GET, PATCH, DELETE
- File uploads: multipart/form-data
- Polling: GET requests every 2-5 seconds

**Backend → Database:**
- INSERT: New creations
- UPDATE: Status, current_task, character_name, metadata
- SELECT: Query creations, check status

**Backend → File System:**
- Write: Save task output files
- Read: Check file existence (task status)
- Move: temp → permanent on completion

**Backend → External APIs:**
- ChatGPT API: Image to render
- Meshy API: Multiple endpoints (3D, remesh, texture, rig, animate)
- Polling: Check task status

**Backend → Frontend:**
- JSON responses with creation/task status
- File URLs for serving assets
- Progress updates
- Error messages

---

## Related Documentation

- [API_REFERENCE.md](./API_REFERENCE.md) - Complete API endpoint details
- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) - Database structure
- [TASK_CONFIGURATION.md](./TASK_CONFIGURATION.md) - Task definitions
- [ERROR_HANDLING.md](./ERROR_HANDLING.md) - Error handling details
