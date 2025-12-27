# API Reference

HeroMaker uses FastAPI, which automatically generates interactive API documentation.

## Interactive API Documentation

**Swagger UI (Recommended):**
- Local: http://localhost:8000/docs
- Production: https://your-backend-url.railway.app/docs

**ReDoc (Alternative):**
- Local: http://localhost:8000/redoc
- Production: https://your-backend-url.railway.app/redoc

**OpenAPI JSON Schema:**
- Local: http://localhost:8000/openapi.json
- Production: https://your-backend-url.railway.app/openapi.json

## Benefits of Auto-Generated Docs

✅ **Always up-to-date** - Generated directly from code  
✅ **Interactive** - Test endpoints directly in the browser  
✅ **Complete** - Includes all request/response schemas  
✅ **Type-safe** - Shows exact Pydantic models  
✅ **No maintenance** - No manual updates needed  

## Quick Reference

### Main Endpoints

- `POST /api/creations/upload` - Upload image and create creation
- `GET /api/creations/{id}` - Get creation status
- `GET /api/creations` - List creations
- `POST /api/creations/{id}/run` - Run full pipeline
- `POST /api/creations/{id}/steps/{step_name}/run` - Run single step
- `GET /api/files/{user_id}/{creation_id}/{filename}` - Serve files
- `GET /health` - Health check

### Authentication

Currently uses debug user (auto-assigned). See `.env.example` for configuration.

## Related Documentation

- [Database Schema](../backend/database.md) - Database structure
- [Step Configuration](../backend/steps.md) - Step definitions
- [Backend Integrations](../backend/integrations.md) - External API configuration
- [Architecture Overview](../architecture/overview.md) - High-level system architecture
