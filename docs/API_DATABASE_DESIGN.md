---
name: API and Database Design for HeroMaker
overview: Complete API and database design for HeroMaker with file system as source of truth for task status, user-scoped file paths, and terminal commands ready for execution at each step. Backend returns flat task lists without user-facing step nesting.
todos:
  - id: db_migration
    content: Create Alembic migration for users and creations tables
    status: pending
  - id: sqlalchemy_models
    content: Create SQLAlchemy models for User and Creation
    status: pending
  - id: file_utils
    content: Create file system utilities with user_id in paths
    status: pending
  - id: task_config
    content: Create task configuration system
    status: pending
  - id: auth_middleware
    content: Create authentication middleware (debug user for V2)
    status: pending
  - id: pydantic_schemas
    content: Create Pydantic schemas for API validation
    status: pending
  - id: creation_endpoints
    content: Implement creation management API endpoints
    status: pending
  - id: task_endpoints
    content: Implement task execution endpoints
    status: pending
  - id: file_serving
    content: Implement file serving endpoint
    status: pending
  - id: progress_endpoint
    content: Implement progress tracking endpoint
    status: pending
  - id: gallery_endpoints
    content: Implement gallery/characters endpoints
    status: pending
  - id: integration_testing
    content: Test complete flow end-to-end
    status: pending
---

# API and Database Design for HeroMaker

## Database Schema

### Users Table
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE,
    google_id VARCHAR(255) UNIQUE,
    username VARCHAR(255),
    password_hash VARCHAR(255),  -- For future non-OAuth auth
    is_admin BOOLEAN DEFAULT false,
    subscription_tier VARCHAR(50) DEFAULT 'free',  -- free, pro, enterprise
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_google_id ON users(google_id);
```

### Creations Table
```sql
CREATE TABLE creations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    character_name VARCHAR(255),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL,  -- pending, processing, completed, failed, cancelled
    current_task VARCHAR(100),  -- NULL if completed or no current step
    is_public BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP,  -- Set when status = completed
    error_message TEXT,
    metadata JSONB  -- Store any extra data (generated name, API task IDs, etc.)
);

CREATE INDEX idx_creations_status ON creations(status);
CREATE INDEX idx_creations_user_id ON creations(user_id);
CREATE INDEX idx_creations_public_completed ON creations(is_public, status) WHERE status = 'completed';
CREATE INDEX idx_creations_created_at ON creations(created_at DESC);
```

**Design Notes:**
- Creations table tracks both in-progress creations and completed characters
- Status field determines state: "processing" = active creation, "completed" = finished character
- File system is source of truth for task completion status
- Task status inferred from file existence in file system

---

## File System Structure

```
assets/
  temp/
    {user_id}/
      {creation_id}/
        scan.jpg
        scanned.jpg
        rendered.png
        model.glb
        remeshed.glb
        textured.glb
        rigged.glb
        animated.glb
        selected.glb
        {creation_id}.vrm
  permanent/
    {user_id}/
      {creation_id}/
        (same files, moved here on completion)
```

**File Naming Convention:**
Each task produces a specific output file. File existence indicates task completion.

**Task to File Mapping:**
- `webcam_scan` → `scan.jpg`
- `image_processing` → `scanned.jpg`
- `chatgpt_render` → `rendered.png`
- `meshy_3d` → `model.glb`
- `meshy_remesh` → `remeshed.glb`
- `meshy_texture` → `textured.glb`
- `meshy_rig` → `rigged.glb`
- `meshy_animate` → `animated.glb`
- `select_glb` → `selected.glb` (or reference animated.glb)
- `convert_vrm` → `{creation_id}.vrm` (uses creation ID, not character name, to avoid file system issues)

**User ID in Paths:**
- All file paths include user_id for organization and security
- For V2 debug mode: use `user_id = "debug"` when user_id is NULL
- Path structure: `assets/{temp|permanent}/{user_id}/{creation_id}/`

---

## Task Configuration

Tasks are defined by their input/output file patterns and dependencies:

```python
TASKS = [
    {
        "name": "webcam_scan",
        "input": None,  # No input (user action)
        "output": "scan.jpg"
    },
    {
        "name": "image_processing", 
        "input": "scan.jpg",
        "output": "scanned.jpg",
        "depends_on": "webcam_scan"
    },
    {
        "name": "chatgpt_render",
        "input": "scanned.jpg",
        "output": "rendered.png",
        "depends_on": "image_processing"
    },
    {
        "name": "meshy_3d",
        "input": "rendered.png",
        "output": "model.glb",
        "depends_on": "chatgpt_render"
    },
    {
        "name": "meshy_remesh",
        "input": "model.glb",
        "output": "remeshed.glb",
        "depends_on": "meshy_3d"
    },
    {
        "name": "meshy_texture",
        "input": "remeshed.glb",
        "output": "textured.glb",
        "depends_on": "meshy_remesh"
    },
    {
        "name": "meshy_rig",
        "input": "textured.glb",
        "output": "rigged.glb",
        "depends_on": "meshy_texture"
    },
    {
        "name": "meshy_animate",
        "input": "rigged.glb",
        "output": "animated.glb",
        "depends_on": "meshy_rig"
    },
    {
        "name": "select_glb",
        "input": "animated.glb",
        "output": "selected.glb",
        "depends_on": "meshy_animate"
    },
    {
        "name": "convert_vrm",
        "input": "selected.glb",
        "output": "{creation_id}.vrm",  // Use creation_id, not character_name, to avoid file system issues
        "depends_on": "select_glb"
    },
    {
        "name": "complete",
        "input": "{creation_id}.vrm",
        "output": None,  # No output, just marks completion
        "depends_on": "convert_vrm"
    }
]
```

**Task Execution Logic:**
- Check if input file exists (or depends_on task completed)
- Execute task
- Save output file to file system
- Update `current_task` in database
- Auto-trigger next task if dependencies are met

---

## API Endpoints

### Authentication

#### GET /api/auth/me
Get current authenticated user

**Headers:**
```
Authorization: Bearer <token>  // Optional in V2 (auto-assigns debug user)
```

**Response (V2 - Debug):**
```json
{
  "id": "debug-user-uuid",
  "email": "debug@heromaker.local",
  "username": "Debug User",
  "is_admin": true
}
```

---

### Creation Management

#### POST /api/creations
Create a new creation (start "Making A New Hero")

**Headers:**
```
Authorization: Bearer <token>  // Optional in V2 (uses debug user)
```

**Request:**
```json
{}
```

**Response:**
```json
{
  "id": "uuid",
  "status": "pending",
  "current_task": "webcam_scan",
  "character_name": null,
  "user_id": "debug-user-uuid",
  "created_at": "2024-01-01T00:00:00Z",
  "tasks": [
    {
      "name": "webcam_scan",
      "status": "pending",
      "output_file": "scan.jpg"
    },
    {
      "name": "image_processing",
      "status": "pending",
      "output_file": "scanned.jpg"
    },
    {
      "name": "chatgpt_render",
      "status": "pending",
      "output_file": "rendered.png"
    }
    // ... all tasks
  ]
}
```

#### GET /api/creations/{creation_id}
Get creation status with task progress

**Response:**
```json
{
  "id": "uuid",
  "character_name": "Super Hero",
  "status": "processing",
  "current_task": "meshy_remesh",
  "user_id": "debug-user-uuid",
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:05:00Z",
  "tasks": [
    {
      "name": "webcam_scan",
      "status": "completed",
      "output_file": "scan.jpg",
      "file_url": "/api/files/temp/debug/{creation_id}/scan.jpg"
    },
    {
      "name": "image_processing",
      "status": "completed",
      "output_file": "scanned.jpg",
      "file_url": "/api/files/temp/debug/{creation_id}/scanned.jpg"
    },
    {
      "name": "chatgpt_render",
      "status": "completed",
      "output_file": "rendered.png",
      "file_url": "/api/files/temp/debug/{creation_id}/rendered.png",
      "metadata": {
        "generated_name": "Super Hero"
      }
    },
    {
      "name": "meshy_3d",
      "status": "completed",
      "output_file": "model.glb",
      "file_url": "/api/files/temp/debug/{creation_id}/model.glb"
    },
    {
      "name": "meshy_remesh",
      "status": "processing",
      "output_file": "remeshed.glb",
      "metadata": {
        "meshy_task_id": "task_123",
        "progress_percentage": 45
      }
    },
    {
      "name": "meshy_texture",
      "status": "pending",
      "output_file": "textured.glb"
    }
    // ... remaining tasks
  ]
}
```

**Note:** Task status is inferred from file existence in the file system.

#### GET /api/creations
List creations

**Query Parameters:**
- `status`: filter by status (default: all)
- `user_id`: filter by user (admin only, or own user in V3)
- `limit`: pagination limit
- `offset`: pagination offset

**Response:**
```json
{
  "creations": [
    {
      "id": "uuid",
      "character_name": "Super Hero",
      "status": "completed",
      "created_at": "2024-01-01T00:00:00Z",
      "thumbnail_url": "/api/files/permanent/debug/{creation_id}/rendered.png"
    }
  ],
  "total": 100,
  "limit": 20,
  "offset": 0
}
```

#### PATCH /api/creations/{creation_id}
Update creation (currently only character_name)

**Headers:**
```
Authorization: Bearer <token>  // Required - must own creation or be admin
```

**Request:**
```json
{
  "character_name": "Edited Name"
}
```

#### DELETE /api/creations/{creation_id}
Delete creation and all associated files

**Headers:**
```
Authorization: Bearer <token>  // Required - must own creation or be admin
```

---

### Task Execution

#### POST /api/creations/{creation_id}/tasks/{task_name}
Execute a specific task

**Headers:**
```
Authorization: Bearer <token>  // Required - must own creation
```

**Path Parameters:**
- `task_name`: Name of task (e.g., "webcam_scan", "chatgpt_render", "meshy_3d")

**Request:**
```json
{
  "input_data": "..."  // Optional, if not provided uses output from depends_on task
}
```

**For webcam_scan (with file upload):**
```
multipart/form-data
file: <image_file>
```

**Response:**
```json
{
  "task_name": "webcam_scan",
  "status": "processing",
  "output_file": "scan.jpg",
  "file_url": "/api/files/temp/debug/{creation_id}/scan.jpg"
}
```

#### GET /api/creations/{creation_id}/tasks/{task_name}
Get specific task status

**Response:**
```json
{
  "task_name": "meshy_remesh",
  "status": "processing",  // Inferred from file existence + current_task
  "input_file": "model.glb",
  "output_file": "remeshed.glb",
  "depends_on": "meshy_3d",
  "started_at": "2024-01-01T00:04:00Z",
  "metadata": {
    "meshy_task_id": "task_456",
    "progress_percentage": 65
  }
}
```

#### POST /api/creations/{creation_id}/tasks/{task_name}/retry
Retry a failed task

**Headers:**
```
Authorization: Bearer <token>  // Required - must own creation
```

#### POST /api/creations/{creation_id}/tasks/{task_name}/upload (Admin Only)
Admin upload file to replace task output

**Headers:**
```
Authorization: Bearer <token>  // Required - must be admin
```

---

### File Serving

#### GET /api/files/{file_path}
Serve files from assets directory

**Path Examples:**
- `/api/files/temp/debug/{creation_id}/scanned.jpg`
- `/api/files/permanent/debug/{creation_id}/rendered.png`
- `/api/files/permanent/debug/{creation_id}/{creation_id}.vrm`

**Security:**
- Validate file paths (prevent directory traversal)
- Only serve from assets/ directory
- Check file exists before serving

---

### Gallery/Characters

#### GET /api/characters
List completed characters (for gallery)

**Query Parameters:**
- `focus`: character_id to focus on (for share links)
- `limit`: pagination limit
- `offset`: pagination offset

**Response:**
```json
{
  "characters": [
    {
      "id": "uuid",  // creation_id
      "character_name": "Super Hero",
      "user_id": "debug-user-uuid",
      "scan_url": "/api/files/permanent/debug/{creation_id}/scanned.jpg",
      "rendered_url": "/api/files/permanent/debug/{creation_id}/rendered.png",
      "vrm_url": "/api/files/permanent/debug/{creation_id}/{creation_id}.vrm",
      "thumbnail_url": "/api/files/permanent/debug/{creation_id}/rendered.png",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ],
  "total": 100,
  "focus_index": 5
}
```

**Note:** This endpoint returns `GET /api/creations?status=completed` with a character-focused response format.

#### GET /api/characters/{character_id}
Get single character details for Show mode

**Response:**
```json
{
  "id": "uuid",
  "character_name": "Super Hero",
  "user_id": "debug-user-uuid",
  "scan_url": "/api/files/permanent/debug/{creation_id}/scanned.jpg",
  "rendered_url": "/api/files/permanent/debug/{creation_id}/rendered.png",
  "vrm_url": "/api/files/permanent/debug/{creation_id}/{creation_id}.vrm",
  "task_history": [
    {
      "name": "webcam_scan",
      "output_file": "scanned.jpg",
      "file_url": "/api/files/permanent/debug/{creation_id}/scanned.jpg"
    },
    {
      "name": "chatgpt_render",
      "output_file": "rendered.png",
      "file_url": "/api/files/permanent/debug/{creation_id}/rendered.png"
    }
    // ... all completed tasks
  ],
  "created_at": "2024-01-01T00:00:00Z"
}
```

---

### Progress Tracking

#### GET /api/creations/{creation_id}/progress
Get detailed progress for real-time updates

**Response:**
```json
{
  "creation_id": "uuid",
  "status": "processing",
  "current_task": "meshy_remesh",
  "completed_tasks": ["webcam_scan", "image_processing", "chatgpt_render", "meshy_3d"],
  "processing_task": "meshy_remesh",
  "pending_tasks": ["meshy_texture", "meshy_rig", "meshy_animate", "select_glb", "convert_vrm", "complete"],
  "overall_progress": 35,  // Percentage across all tasks
  "current_task_progress": 65  // Progress within current task (if applicable)
}
```

---

## Implementation Steps

Each step includes a terminal command ready for execution. Press Enter to run and verify the implementation.

### Step 1: Database Setup

**Create Alembic migration for database schema**

**Files to create:**
- `backend/alembic/versions/001_initial_schema.py`

**Migration content:**
- Users table
- Creations table
- All indexes

**Terminal command ready:**
```bash
cd /Users/razkarl/projects/HeroMaker/backend && alembic revision --autogenerate -m "Initial schema: users and creations" && echo "✅ Migration created. Review the file, then run: alembic upgrade head"
```

---

### Step 2: SQLAlchemy Models

**Create models matching database schema**

**Files to create:**
- `backend/app/models.py`

**Models:**
- User model
- Creation model

**Terminal command ready:**
```bash
cd /Users/razkarl/projects/HeroMaker/backend && python -c "from app.models import User, Creation; print('✅ Models imported successfully')" && echo "✅ Models are valid"
```

---

### Step 3: File System Utilities

**Create file management utilities with user_id in paths**

**Files to create:**
- `backend/app/utils/file_utils.py`

**Functions:**
- `get_creation_path(creation, is_temp=True)` - Returns path with user_id
- `get_task_status(creation_id)` - Checks file existence
- `list_creation_files(creation_id)` - Lists all files for creation
- `move_to_permanent(creation_id)` - Moves files on completion

**Terminal command ready:**
```bash
cd /Users/razkarl/projects/HeroMaker/backend && python -c "from app.utils.file_utils import get_creation_path; print('✅ File utils imported'); print('Example path:', get_creation_path({'id': 'test-123', 'user_id': 'debug'}, is_temp=True))"
```

---

### Step 4: Task Configuration

**Create task configuration system**

**Files to create:**
- `backend/app/config/tasks.py`

**Content:**
- TASKS list with all task definitions
- Helper functions: get_next_task, check_dependencies, etc.

**Terminal command ready:**
```bash
cd /Users/razkarl/projects/HeroMaker/backend && python -c "from app.config.tasks import TASKS, get_next_task; print(f'✅ Loaded {len(TASKS)} tasks'); print('Next after webcam_scan:', get_next_task('webcam_scan'))"
```

---

### Step 5: Authentication Middleware

**Create authentication middleware (debug user for V2)**

**Files to create:**
- `backend/app/middleware/auth.py`
- `backend/app/services/auth.py`

**Functions:**
- Get current user (debug user for V2)
- Verify ownership
- Check admin

**Terminal command ready:**
```bash
cd /Users/razkarl/projects/HeroMaker/backend && python -c "from app.services.auth import get_current_user; user = get_current_user(); print(f'✅ Debug user: {user.id}')"
```

---

### Step 6: Pydantic Schemas

**Create request/response schemas**

**Files to create:**
- `backend/app/schemas/creation.py`
- `backend/app/schemas/user.py`
- `backend/app/schemas/task.py`

**Terminal command ready:**
```bash
cd /Users/razkarl/projects/HeroMaker/backend && python -c "from app.schemas.creation import CreationCreate, CreationResponse; print('✅ Schemas imported successfully')"
```

---

### Step 7: Core API Endpoints

**Implement creation management endpoints**

**Files to create:**
- `backend/app/api/creations.py`

**Endpoints:**
- POST /api/creations
- GET /api/creations/{id}
- GET /api/creations
- PATCH /api/creations/{id}
- DELETE /api/creations/{id}

**Terminal command ready:**
```bash
cd /Users/razkarl/projects/HeroMaker/backend && uvicorn app.main:app --reload --port 8000 &
sleep 2 && curl -X POST http://localhost:8000/api/creations -H "Content-Type: application/json" | python -m json.tool && echo "✅ Creation endpoint working" && pkill -f uvicorn
```

---

### Step 8: Task Endpoints

**Implement task execution endpoints**

**Files to create:**
- `backend/app/api/tasks.py`

**Endpoints:**
- POST /api/creations/{id}/tasks/{name}
- GET /api/creations/{id}/tasks/{name}
- POST /api/creations/{id}/tasks/{name}/retry

**Terminal command ready:**
```bash
cd /Users/razkarl/projects/HeroMaker/backend && uvicorn app.main:app --reload --port 8000 &
sleep 2 && CREATION_ID=$(curl -s -X POST http://localhost:8000/api/creations | python -c "import sys, json; print(json.load(sys.stdin)['id'])") && echo "Created: $CREATION_ID" && curl -X GET "http://localhost:8000/api/creations/$CREATION_ID/tasks/webcam_scan" | python -m json.tool && echo "✅ Task endpoint working" && pkill -f uvicorn
```

---

### Step 9: File Serving Endpoint

**Implement file serving**

**Files to create:**
- `backend/app/api/files.py`

**Endpoint:**
- GET /api/files/{file_path}

**Terminal command ready:**
```bash
cd /Users/razkarl/projects/HeroMaker/backend && mkdir -p assets/temp/debug/test-123 && echo "test content" > assets/temp/debug/test-123/test.txt && uvicorn app.main:app --reload --port 8000 &
sleep 2 && curl -I http://localhost:8000/api/files/temp/debug/test-123/test.txt && echo "✅ File serving working" && pkill -f uvicorn && rm -rf assets/temp/debug/test-123
```

---

### Step 10: Progress Endpoint

**Implement progress tracking**

**Files to create:**
- Update `backend/app/api/creations.py`

**Endpoint:**
- GET /api/creations/{id}/progress

**Terminal command ready:**
```bash
cd /Users/razkarl/projects/HeroMaker/backend && uvicorn app.main:app --reload --port 8000 &
sleep 2 && CREATION_ID=$(curl -s -X POST http://localhost:8000/api/creations | python -c "import sys, json; print(json.load(sys.stdin)['id'])") && curl -X GET "http://localhost:8000/api/creations/$CREATION_ID/progress" | python -m json.tool && echo "✅ Progress endpoint working" && pkill -f uvicorn
```

---

### Step 11: Gallery/Characters Endpoints

**Implement gallery endpoints**

**Files to create:**
- `backend/app/api/characters.py`

**Endpoints:**
- GET /api/characters
- GET /api/characters/{id}

**Terminal command ready:**
```bash
cd /Users/razkarl/projects/HeroMaker/backend && uvicorn app.main:app --reload --port 8000 &
sleep 2 && curl -X GET "http://localhost:8000/api/characters?limit=5" | python -m json.tool && echo "✅ Gallery endpoint working" && pkill -f uvicorn
```

---

### Step 12: Integration Testing

**Test complete flow end-to-end**

**Terminal command ready:**
```bash
cd /Users/razkarl/projects/HeroMaker/backend && python tests/test_complete_flow.py && echo "✅ Complete flow test passed"
```

---

## User Journeys and System Interactions

This section demonstrates how frontend, backend, and database interact during user journeys.

---

### Journey 1: Making A New Hero - Complete Flow

#### Step 1: User clicks "Make A New Hero"

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

#### Step 2: User captures webcam image

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

#### Step 3: Image processing (auto-triggered)

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

#### Step 4: ChatGPT render (auto-triggered)

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

#### Step 5: Meshy 3D conversion (auto-triggered)

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

#### Step 6-10: Remaining Meshy tasks (auto-triggered sequentially)

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

#### Step 11: Complete task (auto-triggered)

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

### Journey 2: Viewing Gallery

#### Step 1: User opens gallery

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

#### Step 2: User clicks character

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

### Journey 3: Progress Polling During Creation

#### User is watching creation progress

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

### Journey 4: User Edits Character Name

#### User changes character name during creation

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

### Journey 5: Error Handling - Task Failure

#### Meshy task fails

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

## Task Consolidation Considerations

**Meshy API Research Findings:**
Research may reveal that Meshy endpoints can be consolidated:
- `image-to-3d` + `remesh` + `texture` → Single endpoint or combined workflow
- This would reduce from 5 separate Meshy tasks to potentially 2-3 tasks

**System Design Impact:**
- **Low Impact:** Task configuration is flexible
- Tasks are defined by input/output files, not hardcoded
- If Meshy consolidates endpoints:
  1. Update `TASKS` configuration to reflect new workflow
  2. Update task names (e.g., `meshy_3d_complete` instead of separate tasks)
  3. Update file outputs (e.g., `model_textured.glb` instead of separate files)
  4. Backend service layer handles API calls (easy to update)
  5. No database schema changes needed
  6. Frontend adapts to new task list automatically

**Example Consolidated Task:**
```python
{
    "name": "meshy_3d_complete",  # Combined 3D + remesh + texture
    "input": "rendered.png",
    "output": "model_textured.glb",
    "depends_on": "chatgpt_render"
}
```

**Design Benefits:**
- File system as source of truth means task consolidation doesn't break existing logic
- Task dependencies work the same way
- Progress tracking adapts automatically
- Only need to update task configuration and service implementations

---

## Key Implementation Notes

1. **File System as Source of Truth:**
   - Task status inferred from file existence
   - No database synchronization needed
   - Simple logic: if file exists, task is done

2. **File Naming:**
   - VRM files use `{creation_id}.vrm`, not `{character_name}.vrm`
   - Prevents file system issues if character name changes
   - Creation ID is immutable, character name can change
   - All file operations reference creation_id, not character_name

3. **User ID in Paths:**
   - All file paths include user_id for organization and security
   - Use "debug" for NULL user_id in V2
   - Path structure: `assets/{temp|permanent}/{user_id}/{creation_id}/`

4. **Creations Table:**
   - Single table tracks both in-progress creations and completed characters
   - Status field determines state
   - Completed creations appear in gallery automatically

5. **Task Execution:**
   - Check dependencies (input file exists)
   - Execute task
   - For long-running tasks (Meshy, ChatGPT), poll external API for progress
   - Store progress in creation metadata
   - Save output file when complete
   - Update `current_task` in database
   - Auto-trigger next task if dependencies met

6. **External API Polling:**
   - Meshy tasks: Poll `GET /v2/image-to-3d/{task_id}` or similar endpoints
   - ChatGPT tasks: Poll thread/run status endpoints
   - Poll interval: Every 5 seconds for Meshy, every 2-3 seconds for ChatGPT
   - Store progress percentage and status in creation metadata
   - Frontend polls backend, backend polls external APIs

7. **Flat Task Structure:**
   - Backend returns tasks as flat list, no user-facing step nesting
   - Frontend handles grouping tasks into "Dream It", "Create It", "Become It" if needed
   - Backend focuses on task execution and file management

8. **Terminal Commands:**
   - Each step ends with a ready-to-run command
   - Press Enter to test and verify implementation
   - Commands are self-contained and test the functionality
