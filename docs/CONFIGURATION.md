# Configuration

Environment variables, settings, and configuration for HeroMaker.

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
ASSETS_ROOT=./assets
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

## File Upload Limits

**Per File Type:**
- Images (scan, rendered): 10MB max
- GLB files: 50MB max
- VRM files: 50MB max

**Total Creation Size:**
- All files combined: ~200MB max per creation

## Polling Configuration

**Frontend Polling:**
- Interval: 2 seconds
- Endpoint: `GET /api/creations/{id}/progress`
- Stop when status = "completed" or "failed"

**Backend External API Polling:**
- Meshy: Every 5 seconds
- ChatGPT: Every 2-3 seconds
- Max attempts: 120 (10 minutes for Meshy, 4 minutes for ChatGPT)

## Timeout Configuration

**External API Timeouts:**
- Meshy API: 300 seconds (5 minutes)
- ChatGPT API: 120 seconds (2 minutes)

**File Operations:**
- File upload: 60 seconds
- File download: 120 seconds

## Rate Limiting

**Per User (V3):**
- 60 requests per minute
- 1000 requests per hour

**Per Endpoint:**
- File uploads: 10 per minute
- Task execution: 5 per minute

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

## Related Documentation

- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) - Database connection string
- [INTEGRATIONS.md](./INTEGRATIONS.md) - External API configuration
- [ERROR_HANDLING.md](./ERROR_HANDLING.md) - Error handling configuration
