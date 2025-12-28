# Railway Deployment Testing Guide

Complete testing guide for verifying Railway deployment with S3 and PostgreSQL.

## Prerequisites

- Backend URL: `https://your-backend.railway.app`
- Frontend URL: `https://your-frontend.railway.app` (optional, for full UI testing)
- API access (curl, Postman, or browser)

## Step 1: Basic Health Checks

### 1.1 Basic Health Check

```bash
curl https://your-backend.railway.app/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "service": "HeroMaker API"
}
```

### 1.2 Detailed Health Check

```bash
curl https://your-backend.railway.app/health/detailed
```

**Expected Response:**
```json
{
  "status": "healthy",
  "service": "HeroMaker API",
  "checks": {
    "database": {
      "status": "healthy",
      "message": "Database connection successful"
    },
    "vrm_converter": {
      "status": "healthy" or "unreachable",
      "message": "..."
    }
  }
}
```

**✅ Pass Criteria:**
- Status is "healthy"
- Database check shows "healthy" (confirms PostgreSQL connection)
- Service responds within 2-3 seconds

**❌ If Database Check Fails:**
- Check Railway logs for connection errors
- Verify `DATABASE_URL` is set correctly
- Verify PostgreSQL service is running

## Step 2: Verify Storage Backend

### 2.1 Check Railway Logs

In Railway dashboard → Backend service → Logs, look for:

```
INFO: Using S3 storage backend
INFO: Initialized S3 storage: bucket=heromaker-files-xxx, endpoint=https://storage.railway.app
```

**OR** (if S3 not configured):

```
INFO: Using local filesystem storage backend
```

**✅ Pass Criteria:**
- Logs show which storage backend is being used
- If S3 is configured, no initialization errors

## Step 3: Test File Operations

### 3.1 Upload a Test Image

**Note:** You'll need authentication. For testing, you can:
- Use the frontend UI
- Or temporarily disable auth (not recommended for production)

```bash
# Example with curl (requires auth token)
curl -X POST https://your-backend.railway.app/api/creations/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test-image.jpg" \
  -F "character_name=Test Character"
```

**Expected Response:**
```json
{
  "id": "creation-id-here",
  "user_id": "user-id-here",
  "character_name": "Test Character",
  "status": "pending",
  "steps": [...]
}
```

### 3.2 Verify File in S3

1. Go to Railway dashboard → Storage Bucket
2. Check for file: `{user_id}/{creation_id}/original.jpg`
3. File should be present if S3 is working

**✅ Pass Criteria:**
- Upload succeeds
- File appears in S3 bucket (if S3 configured)
- Creation record created in database

### 3.3 Download File (Test Presigned URL)

```bash
# Get file URL
curl https://your-backend.railway.app/api/files/{user_id}/{creation_id}/original.jpg
```

**Expected Behavior:**
- If S3: Redirects (302) to presigned URL
- If local: Returns file directly

**✅ Pass Criteria:**
- File is accessible
- Presigned URL works (if S3)
- File downloads correctly

## Step 4: Test Database Operations

### 4.1 Create a Creation (via API)

```bash
curl -X POST https://your-backend.railway.app/api/creations/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test.jpg" \
  -F "character_name=DB Test"
```

### 4.2 Verify in PostgreSQL

1. Go to Railway dashboard → PostgreSQL database
2. Connect via Railway's database interface or CLI
3. Run query:
   ```sql
   SELECT * FROM creations ORDER BY created_at DESC LIMIT 5;
   ```

**✅ Pass Criteria:**
- Creation appears in PostgreSQL
- All fields are correct
- Timestamps are set

### 4.3 Check Creation Steps

```sql
SELECT * FROM creation_steps WHERE creation_id = 'your-creation-id';
```

**✅ Pass Criteria:**
- Steps are initialized
- Status is "pending"
- Metadata is stored correctly

## Step 5: Test Full Pipeline

### 5.1 Start Pipeline

```bash
curl -X POST https://your-backend.railway.app/api/creations/{creation_id}/run \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 5.2 Monitor Progress

```bash
# Check creation status
curl https://your-backend.railway.app/api/creations/{creation_id} \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected Flow:**
1. Status changes from "pending" → "processing" → "completed"
2. Steps progress: `image_processing` → `openai_render` → `meshy_3d` → etc.
3. Files appear in S3 at each step

### 5.3 Verify Files in S3

Check Railway Storage Bucket for:
- `{user_id}/{creation_id}/original.jpg`
- `{user_id}/{creation_id}/processed.jpg`
- `{user_id}/{creation_id}/rendered.png`
- `{user_id}/{creation_id}/model.glb`
- `{user_id}/{creation_id}/rigged.glb`
- `{user_id}/{creation_id}/avatar.vrm`

**✅ Pass Criteria:**
- Pipeline completes successfully
- All intermediate files are in S3
- Final VRM file is accessible
- Database shows all steps as "completed"

## Step 6: Verify Data Persistence

### 6.1 Restart Backend Service

1. In Railway dashboard → Backend service
2. Click "Restart" or "Redeploy"
3. Wait for service to come back online

### 6.2 Verify Data Still Exists

```bash
# Check creations still exist
curl https://your-backend.railway.app/api/creations \
  -H "Authorization: Bearer YOUR_TOKEN"
```

```bash
# Check files still accessible
curl https://your-backend.railway.app/api/files/{user_id}/{creation_id}/avatar.vrm
```

**✅ Pass Criteria:**
- Creations still exist after restart
- Files still accessible
- Database data persisted
- S3 files still available

## Step 7: Test Error Handling

### 7.1 Test Invalid File Access

```bash
curl https://your-backend.railway.app/api/files/invalid-user/invalid-creation/nonexistent.jpg
```

**Expected:** 404 Not Found

### 7.2 Test Database Connection Loss

1. Temporarily stop PostgreSQL service
2. Check health endpoint: `/health/detailed`
3. Expected: Database check shows "unhealthy", but service still responds

**✅ Pass Criteria:**
- Errors are handled gracefully
- Service doesn't crash
- Appropriate error messages returned

## Step 8: Performance Testing

### 8.1 Response Times

```bash
time curl https://your-backend.railway.app/health
time curl https://your-backend.railway.app/api/creations
```

**✅ Pass Criteria:**
- Health check: < 1 second
- API calls: < 2 seconds
- File uploads: Depends on file size

### 8.2 S3 Presigned URL Generation

```bash
time curl -I https://your-backend.railway.app/api/files/{user_id}/{creation_id}/original.jpg
```

**✅ Pass Criteria:**
- Presigned URL generation: < 500ms
- Redirect works correctly

## Quick Test Script

Save this as `test-railway.sh`:

```bash
#!/bin/bash

BACKEND_URL="https://your-backend.railway.app"

echo "Testing Railway Deployment..."
echo "================================"

echo ""
echo "1. Basic Health Check:"
curl -s "$BACKEND_URL/health" | jq '.'

echo ""
echo "2. Detailed Health Check:"
curl -s "$BACKEND_URL/health/detailed" | jq '.'

echo ""
echo "3. Root Endpoint:"
curl -s "$BACKEND_URL/" | jq '.'

echo ""
echo "✅ Basic tests complete!"
echo ""
echo "Next steps:"
echo "- Test file upload (requires authentication)"
echo "- Test pipeline execution"
echo "- Verify files in S3 bucket"
echo "- Verify data in PostgreSQL"
```

Make it executable:
```bash
chmod +x test-railway.sh
./test-railway.sh
```

## Troubleshooting

### Health Check Fails

1. **Check Railway Logs:**
   - Look for Python errors
   - Check database connection errors
   - Verify S3 initialization

2. **Common Issues:**
   - `DATABASE_URL` not set correctly
   - PostgreSQL service not accessible
   - S3 credentials incorrect
   - Port conflicts

### Files Not Appearing in S3

1. **Check S3 Credentials:**
   - Verify `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY are set
   - Check Railway logs for S3 errors

2. **Verify Bucket Permissions:**
   - Bucket should be accessible with provided credentials
   - Check Railway Storage Bucket dashboard

### Database Connection Issues

1. **Verify Variable Reference:**
   - `DATABASE_URL=${{Postgres.DATABASE_URL}}`
   - Replace `Postgres` with actual service name

2. **Check PostgreSQL Service:**
   - Service should be running
   - Private networking enabled
   - Connection string format correct

## Success Criteria

✅ All health checks pass  
✅ Database operations work (PostgreSQL)  
✅ File uploads work (S3)  
✅ Files are accessible via presigned URLs  
✅ Pipeline executes successfully  
✅ Data persists after service restart  
✅ Error handling works correctly  

If all criteria pass, your Railway deployment is working correctly! 🎉

