# API Reference

Complete API endpoint documentation for HeroMaker backend.

**Base URL:** `http://localhost:8000` (development)

**Authentication:** Optional in V2 (auto-assigns debug user). See [SETUP.md](../backend/SETUP.md) for auth setup.

---

## Authentication

### GET /api/auth/me

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

## Creation Management

### POST /api/creations

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
  "current_task": "image_capture",
  "character_name": null,
  "user_id": "debug-user-uuid",
  "created_at": "2024-01-01T00:00:00Z",
  "tasks": [
    {
      "name": "image_capture",
      "status": "pending",
      "output_file": "original.jpg"
    },
    {
      "name": "image_processing",
      "status": "pending",
      "output_file": "processed.jpg"
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

### GET /api/creations/{creation_id}

Get creation status with task progress

**Response:**
```json
{
  "id": "uuid",
  "character_name": "Super Hero",
  "status": "processing",
  "current_task": "meshy_rig",
  "user_id": "debug-user-uuid",
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:05:00Z",
  "tasks": [
    {
      "name": "image_capture",
      "status": "completed",
      "output_file": "original.jpg",
      "file_url": "/api/files/temp/debug/{creation_id}/original.jpg"
    },
    {
      "name": "image_processing",
      "status": "completed",
      "output_file": "processed.jpg",
      "file_url": "/api/files/temp/debug/{creation_id}/processed.jpg"
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
      "name": "meshy_rig",
      "status": "processing",
      "output_file": "rigged.glb",
      "metadata": {
        "meshy_task_id": "task_123",
        "progress_percentage": 45
      }
    }
    // ... remaining tasks
  ]
}
```

**Note:** Task status is inferred from file existence in the file system.

### GET /api/creations

List creations

**Query Parameters:**
- `status`: filter by status (default: all)
- `user_id`: filter by user (admin only, or own user in V3)
- `limit`: pagination limit (default: 20)
- `offset`: pagination offset (default: 0)

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

### PATCH /api/creations/{creation_id}

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

**Response:**
```json
{
  "id": "uuid",
  "character_name": "Edited Name",
  "updated_at": "2024-01-01T00:06:00Z"
}
```

### DELETE /api/creations/{creation_id}

Delete creation and all associated files

**Headers:**
```
Authorization: Bearer <token>  // Required - must own creation or be admin
```

**Response:**
```json
{
  "message": "Creation deleted successfully"
}
```

---

## Task Execution

### POST /api/creations/{creation_id}/tasks/{task_name}

Execute a specific task

**Headers:**
```
Authorization: Bearer <token>  // Required - must own creation
```

**Path Parameters:**
- `creation_id`: UUID of the creation
- `task_name`: Name of task (e.g., "image_capture", "chatgpt_render", "meshy_3d")

**Request:**
```json
{
  "input_data": "..."  // Optional, if not provided uses output from depends_on task
}
```

**For image_capture (file upload - supports both webcam capture and file upload):**
```
multipart/form-data
file: <image_file>
```

**Note:** The `image_capture` task accepts image files from two sources:
- **Webcam capture**: Frontend captures image from webcam and uploads
- **File upload**: User selects and uploads image file from device

Both methods upload the same way via `multipart/form-data`. The backend treats them identically.

**Response:**
```json
{
  "task_name": "image_capture",
  "status": "processing",
  "output_file": "original.jpg",
  "file_url": "/api/files/temp/debug/{creation_id}/original.jpg"
}
```

### GET /api/creations/{creation_id}/tasks/{task_name}

Get specific task status

**Response:**
```json
{
  "task_name": "meshy_rig",
  "status": "processing",  // Inferred from file existence + current_task
  "input_file": "model.glb",
  "output_file": "rigged.glb",
  "depends_on": "meshy_3d",
  "started_at": "2024-01-01T00:04:00Z",
  "metadata": {
    "meshy_task_id": "task_456",
    "progress_percentage": 65
  }
}
```

### POST /api/creations/{creation_id}/tasks/{task_name}/retry

Retry a failed task

**Headers:**
```
Authorization: Bearer <token>  // Required - must own creation
```

**Request:**
```json
{}
```

**Response:**
```json
{
  "task_name": "meshy_rig",
  "status": "processing",
  "started_at": "2024-01-01T00:07:00Z"
}
```

### POST /api/creations/{creation_id}/tasks/{task_name}/upload (Admin Only)

Admin upload file to replace task output

**Headers:**
```
Authorization: Bearer <token>  // Required - must be admin
```

**Request:**
```
multipart/form-data
file: <file>
```

**Response:**
```json
{
  "task_name": "meshy_rig",
  "input_file_path": "temp/{creation_id}/uploaded_file.glb",
  "status": "completed"  // If replacing output
}
```

---

## File Serving

### GET /api/files/{file_path}

Serve files from assets directory

**Path Examples:**
- `/api/files/temp/debug/{creation_id}/processed.jpg`
- `/api/files/permanent/debug/{creation_id}/rendered.png`
- `/api/files/permanent/debug/{creation_id}/avatar.vrm`

**Security:**
- Validate file paths (prevent directory traversal)
- Only serve from assets/ directory
- Check file exists before serving

**Response:**
- Binary file with appropriate Content-Type headers
- Images: `image/jpeg`, `image/png`
- GLB: `model/gltf-binary`
- VRM: `model/vrm` or `application/octet-stream`

---

## Gallery/Characters

### GET /api/characters

List completed characters (for gallery)

**Query Parameters:**
- `focus`: character_id to focus on (for share links)
- `limit`: pagination limit (default: 20)
- `offset`: pagination offset (default: 0)

**Response:**
```json
{
  "characters": [
    {
      "id": "uuid",  // creation_id
      "character_name": "Super Hero",
      "user_id": "debug-user-uuid",
      "original_url": "/api/files/permanent/debug/{creation_id}/original.jpg",
      "processed_url": "/api/files/permanent/debug/{creation_id}/processed.jpg",
      "rendered_url": "/api/files/permanent/debug/{creation_id}/rendered.png",
      "vrm_url": "/api/files/permanent/debug/{creation_id}/avatar.vrm",
      "thumbnail_url": "/api/files/permanent/debug/{creation_id}/rendered.png",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ],
  "total": 100,
  "focus_index": 5  // If focus parameter provided
}
```

**Note:** This endpoint returns `GET /api/creations?status=completed` with a character-focused response format.

### GET /api/characters/{character_id}

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
      "output_file": "processed.jpg",
      "file_url": "/api/files/permanent/debug/{creation_id}/processed.jpg"
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

## Progress Tracking

### GET /api/creations/{creation_id}/progress

Get detailed progress for real-time updates

**Response:**
```json
{
  "creation_id": "uuid",
  "status": "processing",
  "current_task": "meshy_rig",
  "completed_tasks": ["image_capture", "image_processing", "chatgpt_render", "meshy_3d"],
  "processing_task": "meshy_rig",
  "pending_tasks": ["meshy_rig", "convert_vrm", "complete"],
  "overall_progress": 35,  // Percentage across all tasks
  "current_task_progress": 65  // Progress within current task (if applicable)
}
```

---

## Error Responses

All endpoints may return error responses. See [SETUP.md](../backend/SETUP.md) for details.

**Standard Error Format:**
```json
{
  "error": {
    "code": "TASK_FAILED",
    "message": "Meshy API returned error",
    "details": {}
  }
}
```

**HTTP Status Codes:**
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation error)
- `401` - Unauthorized
- `403` - Forbidden (not owner/admin)
- `404` - Not Found
- `500` - Internal Server Error

---

## Related Documentation

- [DATABASE_SCHEMA.md](../backend/DATABASE_SCHEMA.md) - Database structure
- [TASK_CONFIGURATION.md](../backend/TASK_CONFIGURATION.md) - Task definitions
- [USER_JOURNEYS.md](../frontend/USER_JOURNEYS.md) - Usage examples
- [SETUP.md](../backend/SETUP.md) - Error handling and configuration details
- [ARCHITECTURE.md](./ARCHITECTURE.md) - High-level system architecture


