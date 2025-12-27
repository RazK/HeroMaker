# Backend Setup & Error Handling

Environment configuration, error handling patterns, and operational setup for HeroMaker backend.

---

## Environment Variables

Create a `.env` file in the `backend/` directory:

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/heromaker
# Or for SQLite (V2): sqlite:///./heromaker.db

# API Keys
OPENAI_API_KEY=sk-...
MESHY_API_KEY=meshy_...

# Application
DEBUG=true
SECRET_KEY=your-secret-key-here  # For JWT tokens (V3)

# File Storage
FILES_ROOT=./data/files
MAX_UPLOAD_SIZE=52428800  # 50MB in bytes

# CORS
CORS_ORIGINS=http://localhost:5173,http://localhost:3000

# Polling Intervals (seconds)
MESHY_POLL_INTERVAL=5
CHATGPT_POLL_INTERVAL=3
FRONTEND_POLL_INTERVAL=2

# Timeouts (seconds)
MESHY_API_TIMEOUT=300  # 5 minutes
CHATGPT_API_TIMEOUT=120  # 2 minutes
FILE_UPLOAD_TIMEOUT=60

# Rate Limiting
RATE_LIMIT_PER_MINUTE=60
RATE_LIMIT_PER_HOUR=1000
```

---

## Configuration by Environment

### Development (V2)
- Database: SQLite (`sqlite:///./heromaker.db`)
- Debug mode: `DEBUG=true`
- CORS: Allow all origins (`*`)
- No authentication required (debug user)

### Production (V3+)
- Database: PostgreSQL
- Debug mode: `DEBUG=false`
- CORS: Specific allowed origins
- Authentication required (OAuth)

---

## CORS Configuration

**Development:**
```python
CORS_ORIGINS = ["*"]  # Allow all for development
```

**Production:**
```python
CORS_ORIGINS = [
    "https://heromaker.com",
    "https://www.heromaker.com"
]
```

---

## File Upload Limits

**Per File Type:**
- Images (scan, rendered): 10MB max
- GLB files: 50MB max
- VRM files: 50MB max

**Total Creation Size:**
- All files combined: ~200MB max per creation

---

## Polling Configuration

**Frontend Polling:**
- Interval: 2 seconds
- Endpoint: `GET /api/creations/{id}/progress`
- Stop when status = "completed" or "failed"

**Backend External API Polling:**
- Meshy: Every 5 seconds
- ChatGPT: Every 2-3 seconds
- Max attempts: 120 (10 minutes for Meshy, 4 minutes for ChatGPT)

---

## Timeout Configuration

**External API Timeouts:**
- Meshy API: 300 seconds (5 minutes)
- ChatGPT API: 120 seconds (2 minutes)

**File Operations:**
- File upload: 60 seconds
- File download: 120 seconds

---

## Rate Limiting

**Per User (V3):**
- 60 requests per minute
- 1000 requests per hour

**Per Endpoint:**
- File uploads: 10 per minute
- Task execution: 5 per minute

---

## Debug User (V2)

**Configuration:**
```python
DEBUG_USER_ID = "debug-user-uuid"
DEBUG_USER_EMAIL = "debug@heromaker.local"
DEBUG_USER_USERNAME = "Debug User"
DEBUG_USER_IS_ADMIN = True
```

**Usage:**
- If no authentication token provided, auto-assign debug user
- All creations belong to debug user
- Debug user has admin privileges

---

## Error Response Format

All error responses follow this structure:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {
      // Additional context
    }
  }
}
```

---

## HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request (validation error, invalid input)
- `401` - Unauthorized (missing or invalid token)
- `403` - Forbidden (not owner/admin)
- `404` - Not Found (resource doesn't exist)
- `409` - Conflict (resource already exists)
- `422` - Unprocessable Entity (validation failed)
- `429` - Too Many Requests (rate limit exceeded)
- `500` - Internal Server Error
- `502` - Bad Gateway (external API error)
- `503` - Service Unavailable (external API unavailable)
- `504` - Gateway Timeout (external API timeout)

---

## Error Codes

### Creation Errors

- `CREATION_NOT_FOUND` - Creation ID doesn't exist
- `CREATION_ALREADY_COMPLETED` - Cannot modify completed creation
- `CREATION_OWNERSHIP_REQUIRED` - User doesn't own creation
- `CREATION_LIMIT_EXCEEDED` - User has reached creation limit (3 free)

### Task Errors

- `TASK_NOT_FOUND` - Task name doesn't exist
- `TASK_DEPENDENCY_NOT_MET` - Required dependency not completed
- `TASK_ALREADY_COMPLETED` - Task already finished
- `TASK_FAILED` - Task execution failed
- `TASK_RETRY_EXCEEDED` - Max retry attempts reached

### File Errors

- `FILE_NOT_FOUND` - File doesn't exist
- `FILE_TOO_LARGE` - File exceeds size limit
- `FILE_INVALID_TYPE` - File type not allowed
- `FILE_UPLOAD_FAILED` - File upload error
- `FILE_PATH_INVALID` - Invalid file path (security)

### External API Errors

- `CHATGPT_API_ERROR` - ChatGPT API returned error
- `CHATGPT_API_TIMEOUT` - ChatGPT API timeout
- `MESHY_API_ERROR` - Meshy API returned error
- `MESHY_API_TIMEOUT` - Meshy API timeout
- `EXTERNAL_API_UNAVAILABLE` - External API service down

### Validation Errors

- `VALIDATION_ERROR` - Request validation failed
- `INVALID_CHARACTER_NAME` - Character name invalid
- `INVALID_USER_ID` - User ID invalid

### Authentication Errors

- `AUTHENTICATION_REQUIRED` - Token missing
- `AUTHENTICATION_INVALID` - Token invalid
- `AUTHORIZATION_FAILED` - User doesn't have permission

---

## Retry Strategies

### Automatic Retry (Backend)

**For External API Calls:**
- Max retries: 3
- Exponential backoff: 1s, 2s, 4s
- Only retry on transient errors (timeout, 502, 503, 504)
- Don't retry on client errors (400, 401, 403, 404)

**For Task Execution:**
- Max retries: 1 (user must manually retry after that)
- Store retry count in creation metadata

### Manual Retry (User-Initiated)

**Endpoint:** `POST /api/creations/{id}/tasks/{task_name}/retry`

**Behavior:**
- Reset task status to "pending"
- Clear error message
- Re-execute task from beginning
- Update retry count in metadata

---

## Error Handling Examples

### Example 1: Task Dependency Not Met

**Request:** `POST /api/creations/abc-123/tasks/meshy_3d`

**Response (400):**
```json
{
  "error": {
    "code": "TASK_DEPENDENCY_NOT_MET",
    "message": "Task 'meshy_3d' requires 'chatgpt_render' to be completed first",
    "details": {
      "required_task": "chatgpt_render",
      "required_file": "rendered.png",
      "file_exists": false
    }
  }
}
```

### Example 2: External API Timeout

**Request:** `POST /api/creations/abc-123/tasks/meshy_3d`

**Response (504):**
```json
{
  "error": {
    "code": "MESHY_API_TIMEOUT",
    "message": "Meshy API request timed out after 300 seconds",
    "details": {
      "task_id": "meshy_task_456",
      "timeout_seconds": 300,
      "retry_available": true
    }
  }
}
```

### Example 3: File Not Found

**Request:** `GET /api/files/temp/debug/abc-123/nonexistent.jpg`

**Response (404):**
```json
{
  "error": {
    "code": "FILE_NOT_FOUND",
    "message": "File not found: temp/debug/abc-123/nonexistent.jpg",
    "details": {
      "file_path": "temp/debug/abc-123/nonexistent.jpg"
    }
  }
}
```

### Example 4: Validation Error

**Request:** `PATCH /api/creations/abc-123` with invalid data

**Response (422):**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": {
      "field": "character_name",
      "error": "Character name must be between 1 and 255 characters"
    }
  }
}
```

---

## Error Logging

**Backend should log:**
- All errors with full stack trace (development)
- Error code, message, user_id, creation_id (production)
- External API errors with request/response details
- File system errors with file paths

**Frontend should:**
- Display user-friendly error messages
- Show retry button for retryable errors
- Log errors to console (development)
- Send error reports to monitoring (production)

---

## Related Documentation

- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) - Database connection string
- [INTEGRATIONS.md](./INTEGRATIONS.md) - External API configuration
- [API_REFERENCE.md](../shared/API_REFERENCE.md) - API endpoints that return errors
- [IMPLEMENTATION.md](./IMPLEMENTATION.md) - Backend implementation guide
