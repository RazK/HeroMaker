# Backend Implementation Guide

Complete guide to implementing the HeroMaker backend API, from setup to deployment.

---

## Prerequisites

- Python 3.11+
- PostgreSQL (or SQLite for V2 development)
- OpenAI API key (for ChatGPT integration)
- Meshy API key (for 3D pipeline)

---

## Quick Setup

### 1. Create Backend Directory Structure

```bash
cd /Users/razkarl/projects/HeroMaker
mkdir -p backend/app/{api,services,utils,config}
mkdir -p backend/alembic/versions
```

### 2. Install Dependencies

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install fastapi uvicorn sqlalchemy alembic pydantic python-dotenv
```

### 3. Configure Environment

Create `backend/.env`:
```bash
DATABASE_URL=sqlite:///./heromaker.db  # For V2 development
OPENAI_API_KEY=sk-...
MESHY_API_KEY=meshy_...
DEBUG=true
ASSETS_ROOT=../assets
```

See [SETUP.md](./SETUP.md) for all environment variables.

### 4. Initialize Database

```bash
cd backend
alembic init alembic
alembic revision --autogenerate -m "Initial schema"
alembic upgrade head
```

---

## Essential Reading Order

1. **[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)** - Understand the data model (5 min)
2. **[TASK_CONFIGURATION.md](./TASK_CONFIGURATION.md)** - Understand task system (10 min)
3. **[API_REFERENCE.md](../shared/API_REFERENCE.md)** - Review all endpoints (15 min)
4. **This document** - Follow step-by-step implementation (start here for coding)

---

## Testing Your First Endpoint

```bash
# Start server
cd backend
uvicorn app.main:app --reload --port 8000

# Test in another terminal
curl -X POST http://localhost:8000/api/creations \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## Key Concepts

- **File System as Source of Truth**: Task completion is inferred from file existence
- **User ID in Paths**: All files stored in `assets/{temp|permanent}/{user_id}/{creation_id}/`
- **Flat Task Structure**: Backend returns tasks as flat list, no nesting
- **Creation ID for Files**: VRM files use `{creation_id}.vrm`, not character name

---

## Implementation Steps

Step-by-step implementation guide with terminal commands ready for execution.

**Note:** Each step includes a terminal command ready for execution. Press Enter to run and verify the implementation.

---

## Step 1: Database Setup

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

## Step 2: SQLAlchemy Models

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

## Step 3: File System Utilities

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

## Step 4: Task Configuration

**Create task configuration system**

**Files to create:**
- `backend/app/config/tasks.py`

**Content:**
- TASKS list with all task definitions
- Helper functions: get_next_task, check_dependencies, etc.

**Terminal command ready:**
```bash
cd /Users/razkarl/projects/HeroMaker/backend && python -c "from app.config.tasks import TASKS, get_next_task; print(f'✅ Loaded {len(TASKS)} tasks'); print('Next after image_capture:', get_next_task('image_capture'))"
```

---

## Step 5: Authentication Middleware

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

## Step 6: Pydantic Schemas

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

## Step 7: Core API Endpoints

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

## Step 8: Task Endpoints

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
sleep 2 && CREATION_ID=$(curl -s -X POST http://localhost:8000/api/creations | python -c "import sys, json; print(json.load(sys.stdin)['id'])") && echo "Created: $CREATION_ID" && curl -X GET "http://localhost:8000/api/creations/$CREATION_ID/tasks/image_capture" | python -m json.tool && echo "✅ Task endpoint working" && pkill -f uvicorn
```

---

## Step 9: File Serving Endpoint

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

## Step 10: Progress Endpoint

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

## Step 11: Gallery/Characters Endpoints

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

## Step 12: Integration Testing

**Test complete flow end-to-end**

**Terminal command ready:**
```bash
cd /Users/razkarl/projects/HeroMaker/backend && python tests/test_complete_flow.py && echo "✅ Complete flow test passed"
```

---

## Implementation Checklist

Follow the steps above in order:

- [ ] Step 1: Database Setup
- [ ] Step 2: SQLAlchemy Models
- [ ] Step 3: File System Utilities
- [ ] Step 4: Task Configuration
- [ ] Step 5: Authentication Middleware
- [ ] Step 6: Pydantic Schemas
- [ ] Step 7: Core API Endpoints
- [ ] Step 8: Task Endpoints
- [ ] Step 9: File Serving Endpoint
- [ ] Step 10: Progress Endpoint
- [ ] Step 11: Gallery/Characters Endpoints
- [ ] Step 12: Integration Testing

---

## Reference Documentation

- [API_REFERENCE.md](../shared/API_REFERENCE.md) - All endpoint specifications
- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) - Database structure
- [TASK_CONFIGURATION.md](./TASK_CONFIGURATION.md) - Task definitions
- [SETUP.md](./SETUP.md) - Environment setup and error handling
- [INTEGRATIONS.md](./INTEGRATIONS.md) - External API integration

## Need Help?

- See [USER_JOURNEYS.md](../frontend/USER_JOURNEYS.md) to understand how frontend uses your APIs
- Check [ARCHITECTURE.md](../shared/ARCHITECTURE.md) for high-level system overview
