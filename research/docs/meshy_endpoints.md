# Meshy API Endpoint Mapping

This document maps HeroMaker pipeline steps to specific Meshy API endpoints.

## Pipeline Step to API Mapping

### Image-to-3D Model Generation

**Pipeline Step**: Convert rendered image to 3D model  
**Meshy Endpoint**: `POST /openapi/v1/multi-image-to-3d`

**Request Details:**
- **Method**: POST
- **URL**: `https://api.meshy.ai/openapi/v1/multi-image-to-3d`
- **Headers**: 
  - `Authorization: Bearer {API_KEY}`
  - `Content-Type: application/json`

**Request Body:**
```json
{
  "image_urls": ["https://..."],
  "ai_model": "meshy-5",  // Optional
  "is_a_t_pose": false     // Optional: generate in A/T pose
}
```

**Response:**
```json
{
  "result": "task_id_here",
  "status": "PENDING"
}
```

**Status Check:**
- **Endpoint**: `GET /openapi/v2/multi-image-to-3d/{task_id}`
- **Poll until**: `status == "SUCCEEDED"` and `progress == 100`

**Output:**
- GLB file URL in `model_urls.glb`
- Download and save to `assets/{character_name}/model.glb`

---

### Remesh 3D Model

**Pipeline Step**: Optimize mesh topology  
**Meshy Endpoint**: `POST /openapi/v1/remesh`

**Request Details:**
- **Method**: POST
- **URL**: `https://api.meshy.ai/openapi/v1/remesh`
- **Headers**: 
  - `Authorization: Bearer {API_KEY}`
  - `Content-Type: application/json`

**Request Body:**
```json
{
  "input_task_id": "task_id_from_image_to_3d",
  "target_formats": ["glb"],           // Optional: ["glb", "fbx"]
  "topology": "quad",                   // Optional: "quad" or "triangle"
  "target_polycount": 10000,            // Optional: target polygon count
  "resize_height": 1.8,                 // Optional: height in meters
  "origin_at": "bottom"                 // Optional: "bottom" or "center"
}
```

**Response:**
```json
{
  "result": "remesh_task_id",
  "status": "PENDING"
}
```

**Status Check:**
- **Endpoint**: `GET /openapi/v1/remesh/{task_id}`
- **Alternative**: `GET /openapi/v1/remesh/{task_id}/stream` (SSE for real-time updates)
- **Poll until**: `status == "SUCCEEDED"`

**Output:**
- Remeshed GLB file URL in `model_urls.glb`
- Download and save to `assets/{character_name}/remeshed.glb`

---

### Texture 3D Model (Retexture)

**Pipeline Step**: Apply textures to 3D model  
**Meshy Endpoint**: `POST /openapi/v1/retexture`

**Request Details:**
- **Method**: POST
- **URL**: `https://api.meshy.ai/openapi/v1/retexture`
- **Headers**: 
  - `Authorization: Bearer {API_KEY}`
  - `Content-Type: application/json`

**Request Body:**
```json
{
  "input_task_id": "task_id_from_remesh",
  "text_style_prompt": "realistic textures, high quality",  // OR image_style_url
  "ai_model": "latest",                  // Optional: "latest", "meshy-4", "meshy-5"
  "enable_original_uv": true,            // Optional: use original UV mapping
  "enable_pbr": true                     // Optional: generate PBR maps
}
```

**Alternative with Image Reference:**
```json
{
  "input_task_id": "task_id_from_remesh",
  "image_style_url": "https://..."       // Instead of text_style_prompt
}
```

**Response:**
```json
{
  "result": "retexture_task_id",
  "status": "PENDING"
}
```

**Status Check:**
- **Endpoint**: `GET /openapi/v1/retexture/{task_id}`
- **Poll until**: `status == "SUCCEEDED"`

**Output:**
- Textured GLB file URL in `model_urls.glb`
- Download and save to `assets/{character_name}/textured.glb`

---

### Rig 3D Model (Auto-Rigging)

**Pipeline Step**: Add armature/rigging to 3D model  
**Meshy Endpoint**: `POST /openapi/v1/rigging`

**Request Details:**
- **Method**: POST
- **URL**: `https://api.meshy.ai/openapi/v1/rigging`
- **Headers**: 
  - `Authorization: Bearer {API_KEY}`
  - `Content-Type: application/json`

**Request Body:**
```json
{
  "input_task_id": "task_id_from_retexture"
}
```

**Response:**
```json
{
  "result": "rig_task_id",
  "status": "PENDING"
}
```

**Status Check:**
- **Endpoint**: `GET /openapi/v1/rigging/{task_id}`
- **Poll until**: `status == "SUCCEEDED"`

**Output:**
- Rigged GLB file URL in `model_urls.glb`
- Download and save to `assets/{character_name}/rigged.glb`
- **Important**: Save `rig_task_id` for animation step

---

### Add Animations

**Pipeline Step**: Apply animations to rigged model  
**Meshy Endpoint**: `POST /openapi/v1/animations`

**Request Details:**
- **Method**: POST
- **URL**: `https://api.meshy.ai/openapi/v1/animations`
- **Headers**: 
  - `Authorization: Bearer {API_KEY}`
  - `Content-Type: application/json`

**Request Body:**
```json
{
  "rig_task_id": "rig_task_id_from_rigging",
  "action_id": "animation_preset_id"     // Animation preset identifier
}
```

**Response:**
```json
{
  "result": "animation_task_id",
  "status": "PENDING"
}
```

**Status Check:**
- **Endpoint**: `GET /openapi/v1/animations/{task_id}`
- **Poll until**: `status == "SUCCEEDED"`

**Output:**
- Animated GLB file URL in `model_urls.glb`
- Download and save to `assets/{character_name}/animated.glb`

**Note**: Need to research available `action_id` values for animation presets.

---

## Endpoint Summary Table

| Pipeline Step | Endpoint | Method | Required Params | Cost |
|---------------|----------|--------|-----------------|------|
| Image-to-3D | `/openapi/v1/multi-image-to-3d` | POST | `image_urls` | 5-30 credits |
| Remesh | `/openapi/v1/remesh` | POST | `input_task_id` | 5 credits |
| Texture | `/openapi/v1/retexture` | POST | `input_task_id`, `text_style_prompt` OR `image_style_url` | 10 credits |
| Rig | `/openapi/v1/rigging` | POST | `input_task_id` | 5 credits |
| Animate | `/openapi/v1/animations` | POST | `rig_task_id`, `action_id` | 3 credits |

**Total Pipeline Cost**: ~28-53 credits per complete pipeline (depending on image-to-3D model used)

## Status Check Endpoints

All tasks can be checked using:
- `GET /openapi/v2/{endpoint}/{task_id}` (for image-to-3d)
- `GET /openapi/v1/{endpoint}/{task_id}` (for remesh, retexture, rigging, animations)

## File Flow

```
Image-to-3D: image.png → [API] → model.glb
Remesh: model.glb (task_id) → [API] → remeshed.glb
Texture: remeshed.glb (task_id) → [API] → textured.glb
Rig: textured.glb (task_id) → [API] → rigged.glb
Animate: rigged.glb (rig_task_id) + action_id → [API] → animated.glb
```

## Key Observations

1. **Task IDs are chained**: Each step uses the `task_id` from the previous step
2. **Rigging is special**: The `rig_task_id` is used for animations, not the task_id
3. **Image URLs required**: Images must be accessible via URL (not direct file upload)
4. **Asynchronous processing**: All operations are async, requiring polling/webhooks
5. **Format flexibility**: Remesh allows choosing output formats (GLB, FBX)

## Questions to Resolve During Testing

1. What are the available `action_id` values for animations?
2. Can we use direct file uploads or must images be hosted URLs?
3. What are the recommended parameter values for each step?
4. How long does each step typically take?
5. Can steps be skipped (e.g., remesh → texture directly)?
6. What happens if a step fails mid-pipeline?
