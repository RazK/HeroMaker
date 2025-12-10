# Meshy API Documentation

## Overview

Meshy provides a comprehensive API for generating and processing 3D models from images. The API supports the complete pipeline: image-to-3D conversion, remeshing, texturing, rigging, and animation.

## Base URL

```
https://api.meshy.ai
```

## Authentication

All API requests require authentication using an API key in the `Authorization` header:

```http
Authorization: Bearer YOUR_API_KEY
```

### Getting an API Key

1. Sign up at [meshy.ai](https://www.meshy.ai/)
2. Navigate to API settings
3. Generate a new API key
4. Multiple keys can be created for different applications

## Rate Limits

Rate limits vary by subscription tier:

| Tier | Requests/Second | Queue Tasks | Priority |
|------|----------------|-------------|----------|
| Pro | 20 | 10 | Default |
| Studio | 20 | 20 | Higher than Pro |
| Enterprise | 100 | 50+ | Highest |

**Response**: `429 Too Many Requests` if limits are exceeded.

## Pricing (Credit-Based System)

| API Endpoint | Price per Call |
|--------------|----------------|
| Text to 3D (Preview) - Mesh Generation | Meshy-6: 20 credits<br>Other: 5 credits |
| Text to 3D (Refine) - Texture | 10 credits |
| Image to 3D | Meshy-6: 20 (no texture), 30 (with texture)<br>Other: 5 (no texture), 15 (with texture) |
| Multi Image to 3D | 5 (no texture), 15 (with texture) |
| Retexture | 10 credits |
| Remesh | 5 credits |
| Auto-Rigging | 5 credits |
| Animation | 3 credits |

*Note: Volume pricing and custom contracts available - contact sales.*

## Task Status Monitoring

Meshy API tasks are processed asynchronously. Three methods to monitor completion:

### 1. Polling (Recommended for Testing)

Poll the task status endpoint periodically:

```python
GET https://api.meshy.ai/openapi/v2/{endpoint}/{task_id}
```

**Status Values:**
- `PENDING` - Task queued
- `PROCESSING` - Task in progress
- `SUCCEEDED` - Task completed successfully
- `FAILED` - Task failed

**Best Practice**: Wait until `progress` reaches 100% before downloading models.

### 2. Webhooks (Recommended for Production)

- Configure webhooks in Meshy API settings
- Up to 5 active webhooks per account
- Must use HTTPS URLs
- Server must respond with HTTP status < 400

**Webhook Payload Example:**
```json
{
  "id": "task_id",
  "status": "SUCCEEDED",
  "progress": 100,
  "model_urls": {
    "glb": "https://...",
    "fbx": "https://..."
  }
}
```

### 3. Server-Sent Events (SSE) - For Remesh

Stream real-time updates:
```
GET /openapi/v1/remesh/{task_id}/stream
```

## Supported File Formats

### Input Formats
- **Images**: PNG, JPG, JPEG
- **3D Models**: GLB, FBX (for remesh/retexture operations)

### Output Formats
- **3D Models**: GLB, FBX, OBJ
- Format selection via `target_formats` parameter in remesh endpoint

## API Endpoints Overview

### Image-to-3D
- **Endpoint**: `POST /openapi/v1/multi-image-to-3d`
- **Description**: Converts 1-4 images into a 3D model
- **Required**: `image_urls` (array)
- **Optional**: `ai_model`, `is_a_t_pose`

### Remesh
- **Endpoint**: `POST /openapi/v1/remesh`
- **Description**: Optimizes and exports 3D models
- **Required**: `input_task_id`
- **Optional**: `target_formats`, `topology`, `target_polycount`, `resize_height`, `origin_at`

### Retexture
- **Endpoint**: `POST /openapi/v1/retexture`
- **Description**: Applies new textures to 3D models
- **Required**: `input_task_id`, `text_style_prompt` OR `image_style_url`
- **Optional**: `ai_model`, `enable_original_uv`, `enable_pbr`

### Auto-Rigging
- **Endpoint**: `POST /openapi/v1/rigging`
- **Description**: Creates rigging for 3D models
- **Required**: `input_task_id`

### Animation
- **Endpoint**: `POST /openapi/v1/animations`
- **Description**: Applies animations to rigged characters
- **Required**: `rig_task_id`, `action_id`

## Error Handling

### HTTP Status Codes
- `200 OK` - Request succeeded
- `400 Bad Request` - Invalid parameters
- `401 Unauthorized` - Missing or invalid API key
- `404 Not Found` - Resource doesn't exist
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error

### Error Response Format
```json
{
  "error": {
    "message": "Error description",
    "code": "ERROR_CODE"
  }
}
```

## Best Practices

1. **Always check task status** before downloading results
2. **Use webhooks** in production to avoid polling overhead
3. **Handle rate limits** with exponential backoff
4. **Validate file formats** before uploading
5. **Store task IDs** for tracking and retry logic
6. **Monitor credit usage** to avoid unexpected costs

## References

- [Official Meshy API Documentation](https://docs.meshy.ai/en/api/)
- [Authentication Guide](https://docs.meshy.ai/en/api/authentication)
- [Rate Limits](https://docs.meshy.ai/en/api/rate-limits)
- [Pricing](https://docs.meshy.ai/en/api/pricing)
- [Webhooks](https://docs.meshy.ai/en/api/webhooks)
