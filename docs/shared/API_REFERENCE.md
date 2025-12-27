# API Reference

Complete API endpoint documentation for HeroMaker backend.

**Base URL:** `http://localhost:8000` (development)

**Authentication:** Optional in V2 (auto-assigns debug user). See [SETUP.md](../backend/SETUP.md) for auth setup.

---

## Authentication

**Note:** In V2, authentication is handled automatically via middleware. All requests are assigned a debug user (`debug-user-uuid`). No explicit auth endpoints are required.

---

## Creation Management

### POST /api/creations/upload

Upload image file and create a new creation. This is the primary way to create a creation - uploads automatically create the creation record.

**Headers:**
```
Authorization: Bearer <token>  // Optional in V2 (uses debug user)
Content-Type: multipart/form-data
```

**Request:**
```
multipart/form-data
file: <image_file>
character_name: <optional string>
```

**Response:**
```json
{
  "id": "uuid",
  "character_name": null,
  "status": "pending",
  "current_step": "image_processing",
  "user_id": "debug-user-uuid",
  "created_at": "2024-01-01T00:00:00Z",
  "completed_at": null,
  "steps": [
    {
      "step_name": "image_processing",
      "status": "pending",
      "started_at": null,
      "completed_at": null,
      "estimated_completion_time": null,
      "error_message": null
    },
    {
      "step_name": "chatgpt_render",
      "status": "pending",
      "started_at": null,
      "completed_at": null,
      "estimated_completion_time": null,
      "error_message": null
    },
    {
      "step_name": "meshy_3d",
      "status": "pending",
      "started_at": null,
      "completed_at": null,
      "estimated_completion_time": null,
      "error_message": null
    },
    {
      "step_name": "meshy_rig",
      "status": "pending",
      "started_at": null,
      "completed_at": null,
      "estimated_completion_time": null,
      "error_message": null
    },
    {
      "step_name": "convert_vrm",
      "status": "pending",
      "started_at": null,
      "completed_at": null,
      "estimated_completion_time": null,
      "error_message": null
    },
    {
      "step_name": "complete",
      "status": "pending",
      "started_at": null,
      "completed_at": null,
      "estimated_completion_time": null,
      "error_message": null
    }
  ],
  "error_message": null
}
```

**Note:** Uploading automatically creates the creation, initializes all steps as "pending", and saves the uploaded file as `original.jpg` in `/data/files/{user_id}/{creation_id}/`.

### GET /api/creations/{creation_id}

Get creation status with step progress

**Response:**
```json
{
  "id": "uuid",
  "character_name": "Super Hero",
  "status": "processing",
  "current_step": "meshy_rig",
  "user_id": "debug-user-uuid",
  "created_at": "2024-01-01T00:00:00Z",
  "completed_at": null,
  "steps": [
    {
      "step_name": "image_processing",
      "status": "completed",
      "started_at": "2024-01-01T00:00:00Z",
      "completed_at": "2024-01-01T00:00:01Z",
      "estimated_completion_time": "2024-01-01T00:00:01Z",
      "error_message": null
    },
    {
      "step_name": "chatgpt_render",
      "status": "completed",
      "started_at": "2024-01-01T00:00:01Z",
      "completed_at": "2024-01-01T00:00:40Z",
      "estimated_completion_time": "2024-01-01T00:00:40Z",
      "error_message": null
    },
    {
      "step_name": "meshy_3d",
      "status": "completed",
      "started_at": "2024-01-01T00:00:40Z",
      "completed_at": "2024-01-01T00:03:52Z",
      "estimated_completion_time": "2024-01-01T00:03:52Z",
      "error_message": null
    },
    {
      "step_name": "meshy_rig",
      "status": "processing",
      "started_at": "2024-01-01T00:03:52Z",
      "completed_at": null,
      "estimated_completion_time": "2024-01-01T00:04:18Z",
      "error_message": null
    },
    {
      "step_name": "convert_vrm",
      "status": "pending",
      "started_at": null,
      "completed_at": null,
      "estimated_completion_time": null,
      "error_message": null
    },
    {
      "step_name": "complete",
      "status": "pending",
      "started_at": null,
      "completed_at": null,
      "estimated_completion_time": null,
      "error_message": null
    }
  ],
  "error_message": null
}
```

**Step Status Values:**
- `pending` - Step has not started
- `processing` - Step is currently running
- `completed` - Step finished successfully
- `failed` - Step failed (check `error_message`)

**Note:** The `status` field on the creation is derived from step statuses:
- `pending` - All steps are pending
- `processing` - At least one step is processing
- `completed` - All steps are completed
- `failed` - At least one step failed

### GET /api/creations

List creations

**Query Parameters:**
- `status`: Filter by status (`pending`, `processing`, `completed`, `failed`) - default: all
- `limit`: Pagination limit (default: 20)
- `offset`: Pagination offset (default: 0)

**Response:**
```json
{
  "creations": [
    {
      "id": "uuid",
      "character_name": "Super Hero",
      "status": "completed",
      "current_step": null,
      "user_id": "debug-user-uuid",
      "created_at": "2024-01-01T00:00:00Z",
      "completed_at": "2024-01-01T00:05:00Z",
      "steps": [...],
      "error_message": null
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
Authorization: Bearer <token>  // Optional in V2
```

**Request:**
```json
{
  "character_name": "Edited Name",
  "name": "John Doe",  // Optional: Person's name
  "age": 25  // Optional: Person's age
}
```

**Response:**
```json
{
  "id": "uuid",
  "character_name": "Edited Name",
  "status": "processing",
  "current_step": "meshy_rig",
  "user_id": "debug-user-uuid",
  "created_at": "2024-01-01T00:00:00Z",
  "completed_at": null,
  "steps": [...],
  "error_message": null
}
```

### DELETE /api/creations/{creation_id}

Delete creation and all associated files

**Headers:**
```
Authorization: Bearer <token>  // Optional in V2
```

**Response:**
```json
{
  "message": "Creation deleted successfully"
}
```

**Note:** This deletes the creation record from the database and removes all associated files from `/data/files/{user_id}/{creation_id}/`.

---

## Pipeline Execution

### POST /api/creations/{creation_id}/run

Run the full pipeline sequentially

**Headers:**
```
Authorization: Bearer <token>  // Optional in V2
```

**Query Parameters:**
- `step_name` (optional): If provided, start from this step. If not provided, start from beginning.
- `retry_all_following` (default: `true`): If `true` and `step_name` provided, resets the step and all following steps. If `false`, only resets the specified step.

**Response:**
```json
{
  "message": "Pipeline run triggered",
  "creation_id": "uuid",
  "step_name": null,
  "retry_all_following": true
}
```

**Note:** Pipeline execution runs in the background. Poll `GET /api/creations/{creation_id}` to check progress.

### POST /api/creations/{creation_id}/steps/{step_name}/run

Run a single step manually

**Headers:**
```
Authorization: Bearer <token>  // Optional in V2
```

**Path Parameters:**
- `creation_id`: UUID of the creation
- `step_name`: Name of step (e.g., "image_processing", "chatgpt_render", "meshy_3d", "meshy_rig", "convert_vrm", "complete")

**Response:**
```json
{
  "message": "Step execution started",
  "creation_id": "uuid",
  "step_name": "meshy_3d"
}
```

**Note:** 
- Step execution runs in the background
- Dependencies are automatically validated before execution
- If a dependency step hasn't completed, the request will fail with a 400 error

**Available Steps:**
- `image_processing` - Process uploaded image
- `chatgpt_render` - Transform drawing to 3D render using OpenAI GPT-Image-1
- `meshy_3d` - Generate 3D model from rendered image (Meshy API)
- `meshy_rig` - Rig the 3D model (Meshy API)
- `convert_vrm` - Convert rigged GLB to VRM format
- `complete` - Mark creation as complete (no file output)

### POST /api/creations/{creation_id}/steps/{step_name}/reset-and-run

Reset a step and all following steps to pending, then run pipeline from that step.

**Headers:**
```
Authorization: Bearer <token>  // Optional in V2
```

**Path Parameters:**
- `creation_id`: UUID of the creation
- `step_name`: Name of step to reset from

**Response:**
```json
{
  "message": "Steps reset and pipeline started",
  "creation_id": "uuid",
  "step_name": "meshy_3d"
}
```

**Note:** This endpoint resets the specified step and all following steps to `pending`, then triggers the pipeline to run from that step.

---

## File Serving

### GET /api/files/{path:path}

Serve files from assets directory

**Path Format:**
- `/api/files/{user_id}/{creation_id}/{filename}`

**Path Examples:**
- `/api/files/debug-user-uuid/{creation_id}/original.jpg`
- `/api/files/debug-user-uuid/{creation_id}/processed.jpg`
- `/api/files/debug-user-uuid/{creation_id}/rendered.png`
- `/api/files/debug-user-uuid/{creation_id}/model.glb`
- `/api/files/debug-user-uuid/{creation_id}/rigged.glb`
- `/api/files/debug-user-uuid/{creation_id}/avatar.vrm`

**Security:**
- Validates file paths (prevents directory traversal)
- Only serves from `/data/files/` directory
- Checks file exists before serving

**Response:**
- Binary file with appropriate Content-Type headers
- Images: `image/jpeg`, `image/png`
- GLB: `model/gltf-binary`
- VRM: `model/vrm` or `application/octet-stream`

---

## Error Responses

All endpoints may return error responses. See [SETUP.md](../backend/SETUP.md) for details.

**Standard Error Format:**
```json
{
  "detail": "Error message here"
}
```

**HTTP Status Codes:**
- `200` - Success
- `400` - Bad Request (validation error, missing dependency)
- `401` - Unauthorized
- `403` - Forbidden (not owner/admin)
- `404` - Not Found (creation not found, step not found)
- `500` - Internal Server Error

---

## Related Documentation

- [DATABASE_SCHEMA.md](../backend/DATABASE_SCHEMA.md) - Database structure
- [TASK_CONFIGURATION.md](../backend/TASK_CONFIGURATION.md) - Step definitions (note: uses "steps" not "tasks")
- [SETUP.md](../backend/SETUP.md) - Error handling and configuration details
- [ARCHITECTURE.md](./ARCHITECTURE.md) - High-level system architecture
