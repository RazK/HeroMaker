# External API Integrations

Details for integrating with ChatGPT and Meshy APIs.

## ChatGPT API Integration

### Endpoint
- Base URL: `https://api.openai.com/v1`
- Task: Convert scanned image to rendered figure and generate character name

### Implementation

**Step 1: Send Image**
```python
POST https://api.openai.com/v1/chat/completions
Headers:
  Authorization: Bearer {OPENAI_API_KEY}
  Content-Type: application/json

Body:
{
  "model": "gpt-4-vision-preview",  # Or appropriate vision model
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "Convert this drawing into a 3D-rendered character figure. Also suggest a character name based on the drawing."
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,{base64_image}"
          }
        }
      ]
    }
  ]
}
```

**Step 2: Poll for Completion (if streaming)**
```python
GET https://api.openai.com/v1/threads/{thread_id}/runs/{run_id}
Headers:
  Authorization: Bearer {OPENAI_API_KEY}
```

**Step 3: Extract Results**
- Rendered image from response
- Character name from response text
- Save rendered image to file system
- Store character name in database

### Configuration
- Poll interval: 2-3 seconds
- Timeout: 120 seconds
- Max retries: 3

### Error Handling
- Timeout: Retry with exponential backoff
- Rate limit: Wait and retry
- Invalid image: Return validation error
- API error: Store error, allow manual retry

## Meshy API Integration

### Base URL
- `https://api.meshy.ai/v2`

### Endpoints Used

#### 1. Image to 3D
**Endpoint:** `POST /v2/image-to-3d`

**Request:**
```python
POST https://api.meshy.ai/v2/image-to-3d
Headers:
  Authorization: Bearer {MESHY_API_KEY}
  Content-Type: multipart/form-data

Body:
  mode: "preview"  # or "premium"
  image: <file>
  art_style: "realistic"  # or other styles
```

**Response:**
```json
{
  "id": "task_id",
  "status": "PROCESSING"
}
```

**Polling:**
```python
GET https://api.meshy.ai/v2/image-to-3d/{task_id}
Headers:
  Authorization: Bearer {MESHY_API_KEY}
```

**Poll Response:**
```json
{
  "id": "task_id",
  "status": "PROCESSING",  // or "COMPLETED", "FAILED"
  "progress": 65,
  "result": {
    "model_urls": {
      "glb": "https://..."
    }
  }
}
```

#### 2. Remesh
**Endpoint:** `POST /v2/remesh`

**Request:**
```python
POST https://api.meshy.ai/v2/remesh
Headers:
  Authorization: Bearer {MESHY_API_KEY}
  Content-Type: multipart/form-data

Body:
  model: <glb_file>
```

#### 3. Texture
**Endpoint:** `POST /v2/texture`

**Request:**
```python
POST https://api.meshy.ai/v2/texture
Headers:
  Authorization: Bearer {MESHY_API_KEY}
  Content-Type: multipart/form-data

Body:
  model: <glb_file>
  prompt: "realistic texture"
```

#### 4. Rig
**Endpoint:** `POST /v2/rig`

**Request:**
```python
POST https://api.meshy.ai/v2/rig
Headers:
  Authorization: Bearer {MESHY_API_KEY}
  Content-Type: multipart/form-data

Body:
  model: <glb_file>
```

#### 5. Animate
**Endpoint:** `POST /v2/animate`

**Request:**
```python
POST https://api.meshy.ai/v2/animate
Headers:
  Authorization: Bearer {MESHY_API_KEY}
  Content-Type: multipart/form-data

Body:
  model: <glb_file>
  animation_preset: "idle"  # or other presets
```

### Polling Strategy

**For All Meshy Tasks:**
1. Submit task, receive task_id
2. Poll every 5 seconds: `GET /v2/{endpoint}/{task_id}`
3. Check status: `PROCESSING`, `COMPLETED`, `FAILED`
4. Store progress percentage in creation metadata
5. When `COMPLETED`, download result file
6. Save to file system
7. Update database

**Polling Configuration:**
- Interval: 5 seconds
- Max duration: 10 minutes (120 polls)
- Timeout: 300 seconds per request

### Error Handling

**Meshy API Errors:**
- `PROCESSING` - Continue polling
- `COMPLETED` - Download result
- `FAILED` - Store error, allow retry
- Timeout - Retry with exponential backoff
- Rate limit - Wait and retry

**Error Storage:**
```json
{
  "meshy_task_id": "task_456",
  "meshy_status": "FAILED",
  "error_message": "Task failed: insufficient credits",
  "retry_count": 1
}
```

## Task Consolidation

**Research Finding:**
Meshy API may support consolidated endpoints:
- `image-to-3d` + `remesh` + `texture` → Single endpoint
- This would reduce from 5 separate tasks to 2-3 tasks

**Impact:**
- Update task configuration (see [TASK_CONFIGURATION.md](./TASK_CONFIGURATION.md))
- Update service layer API calls
- No database changes needed
- Frontend adapts automatically

## Rate Limits

**ChatGPT API:**
- Check current rate limits in OpenAI dashboard
- Implement exponential backoff on rate limit errors

**Meshy API:**
- Check Meshy API documentation for rate limits
- Implement queue system if needed (V3)

## API Key Management

**Storage:**
- Store in environment variables (see [SETUP.md](./SETUP.md))
- Never commit to git
- Use `.env.example` as template

**Rotation:**
- Support multiple API keys for failover (V3)
- Rotate keys without downtime

## Related Documentation

- [TASK_CONFIGURATION.md](./TASK_CONFIGURATION.md) - How tasks use these APIs
- [SETUP.md](./SETUP.md) - Error handling and API key configuration
- [USER_JOURNEYS.md](../frontend/USER_JOURNEYS.md) - See API calls in practice


