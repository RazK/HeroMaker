# Implementation Steps

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
cd /Users/razkarl/projects/HeroMaker/backend && python -c "from app.config.tasks import TASKS, get_next_task; print(f'✅ Loaded {len(TASKS)} tasks'); print('Next after webcam_scan:', get_next_task('webcam_scan'))"
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
sleep 2 && CREATION_ID=$(curl -s -X POST http://localhost:8000/api/creations | python -c "import sys, json; print(json.load(sys.stdin)['id'])") && echo "Created: $CREATION_ID" && curl -X GET "http://localhost:8000/api/creations/$CREATION_ID/tasks/webcam_scan" | python -m json.tool && echo "✅ Task endpoint working" && pkill -f uvicorn
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

## Related Documentation

- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) - Database structure to implement
- [API_REFERENCE.md](./API_REFERENCE.md) - API endpoints to implement
- [TASK_CONFIGURATION.md](./TASK_CONFIGURATION.md) - Task system to implement
- [CONFIGURATION.md](./CONFIGURATION.md) - Configuration needed
- [INTEGRATIONS.md](./INTEGRATIONS.md) - External API integrations
