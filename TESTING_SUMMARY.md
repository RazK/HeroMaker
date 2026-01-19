# Pipeline Refactor - Testing Summary

## Completed Tests

### 1. Backend API Tests ✓

#### Cost Calculation Endpoint
- ✅ **Full pipeline cost**: `GET /api/creations/cost` → Returns `{"cost": 10}` (all steps)
- ✅ **Specific steps**: `GET /api/creations/cost?steps=openai_render,meshy_3d` → Returns `{"cost": 7}`
- ✅ **Single step**: `GET /api/creations/cost?steps=image_processing` → Returns `{"cost": 0}`
- ✅ **Route ordering**: `/cost` endpoint correctly placed before `/{creation_id}` route

#### Service Status
- ✅ Backend running on port 8000
- ✅ Health endpoint accessible
- ✅ `.venv` exists and is properly configured
- ✅ `.env` file exists

### 2. Frontend Integration Verification ✓

#### Component Integration
- ✅ `PipelineCartModal` imported in `App.tsx` for upload flow
- ✅ `PipelineCartModal` imported in `StepCard.tsx` for retry flow
- ✅ API client updated with new `createCreation()` and `runPipeline()` methods
- ✅ Modal props configured correctly (initialSelection, isAdmin, creditBalance)

#### Flow Verification (Code Review)
- ✅ **Upload Flow**: 
  - User uploads image → `createCreation()` called
  - Modal opens with all steps pre-selected
  - On "Run" → `runPipeline()` called with selected steps
- ✅ **Retry Flow**:
  - User clicks retry on step → Modal opens
  - Selected step + following steps pre-selected
  - Previous steps disabled
  - On "Run" → `runPipeline()` called with correct steps

### 3. Test Files Created ✓

- ✅ **`test-pipeline.http`**: Comprehensive REST Client test file with:
  - Authentication endpoints (signup/login)
  - Cost calculation tests
  - Creation upload tests
  - Pipeline execution tests (single step, multiple steps, full pipeline)
  - Mock mode tests (admin only)
  - Error case tests
  
- ✅ **`test-pipeline.sh`**: Quick smoke test script for:
  - Health check
  - Cost calculation verification
  - Venv verification

## Manual Testing Required

### Edge Cases (Require Auth Token & Test Data)

These tests require authentication and actual file uploads. Use `test-pipeline.http` file with a valid token:

1. **Invalid Step Names**
   - Request: `POST /api/creations/{id}/run` with `{"steps": ["invalid_step"]}`
   - Expected: 404 error with "Step invalid_step not found"

2. **Empty Steps List**
   - Request: `POST /api/creations/{id}/run` with `{"steps": []}`
   - Expected: Should fail validation or return appropriate error

3. **Insufficient Credits**
   - Create user with 0 credits
   - Try to run step that costs credits
   - Expected: 402 Payment Required with insufficient credits message

4. **Mock Validation Errors**
   - Mock steps not subset of steps: Should return 400 error
   - Mock steps without mock_creation_id: Should return 400 error
   - Invalid mock_creation_id: Should return 404 error
   - Non-admin using mock mode: Should return 403 error

5. **Missing Input Files**
   - Run step that requires input file that doesn't exist
   - Expected: Appropriate error handling

6. **Already Completed Steps**
   - Run step that's already completed
   - Expected: Step should reset to pending and re-run

### Frontend UI Testing (Manual)

1. **Upload Flow**
   - Upload image file
   - Verify PipelineCartModal opens
   - Verify all steps selected by default
   - Verify total cost displayed correctly
   - Deselect some steps → verify cost updates
   - Click "Run" → verify creation created and pipeline starts

2. **Retry Flow**
   - Have a creation with failed step
   - Click retry on failed step
   - Verify modal opens with correct step selected
   - Verify following steps are also selected
   - Verify previous steps are disabled
   - Click "Run" → verify correct steps executed

3. **Mock Mode (Admin)**
   - Login as admin
   - Upload image → open cart modal
   - Verify mock checkboxes visible
   - Select mock steps → verify mock creation ID input appears
   - Enter mock creation ID
   - Click "Run" → verify mock parameters sent correctly

4. **Cost Display**
   - Verify costs match backend calculations
   - Verify free steps show 0 cost
   - Verify total updates when steps selected/deselected

## Testing Notes

- **Venv Usage**: All Python commands should use `.venv/bin/python` (handled by `start-dev.sh`)
- **Token Required**: Most endpoints require Bearer token from `/api/auth/login`
- **Admin Mode**: Mock testing requires admin user (`is_admin=true`)
- **File Uploads**: Creation endpoint requires actual image file upload

## Next Steps

1. Start services: `./start-dev.sh`
2. Open `test-pipeline.http` in REST Client extension (VS Code)
3. Authenticate: Signup/login to get token
4. Set token variable in HTTP file
5. Run tests sequentially
6. Test frontend manually by opening http://localhost:5173
