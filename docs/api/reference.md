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

Every client (the app, other apps, agents) calls `/api/v1`. The public part
is described for agents at `/llms.txt` and as OpenAPI at
`/api/v1/openapi.json`; the app's own routes (account, classes, admin) are in
`/docs`.

- `POST /api/v1/heroes` - Upload a drawing and start a hero (`start: false` uploads only)
- `GET /api/v1/heroes/{id}` - A hero: status, stages, progress, time left, files
- `GET /api/v1/heroes` - The account's heroes
- `GET /api/v1/gallery?view=featured|mine|all` - The gallery
- `POST /api/v1/heroes/{id}/start` - Start, or start again from a stage (`from_stage`)
- `POST /api/v1/heroes/{id}/stages/{stage}/run` - Run one stage (the app only)
- `POST /api/v1/heroes/{id}/cancel` - Stop the stage being made
- `PATCH` / `DELETE /api/v1/heroes/{id}` - Rename, set who drew it; delete
- `GET /api/v1/estimates` - Each stage's cost and typical length
- `GET /api/v1/styles` - The painting styles
- `POST /api/v1/signup`, `/login`, `/login/google`; `GET`/`PATCH`/`DELETE /api/v1/me` - The account
- `GET /api/v1/packs`, `POST /api/v1/checkout`, `GET /api/v1/receipts` - Buying credits
- `/api/v1/classes/...`, `/api/v1/class/...`, `/api/v1/admin/...` - Classes and the admin console
- `POST /api/payments/webhook` - Lemon Squeezy only (the store is configured with this address)
- `GET /api/files/{user_id}/{creation_id}/{filename}` - Serve files
- `GET /health` - Health check

### Authentication

`Authorization: Bearer <token>`: the app's sign-in token (`POST /api/v1/login`),
or an API key (`hm_sk_...`) made on the account page. What each may do is its
scope (`backend/app/services/principal.py`).

## Related Documentation

- [Database Schema](../backend/database.md) - Database structure
- [Step Configuration](../backend/steps.md) - Step definitions
- [Backend Integrations](../backend/integrations.md) - External API configuration
- [Architecture Overview](../architecture/overview.md) - High-level system architecture
