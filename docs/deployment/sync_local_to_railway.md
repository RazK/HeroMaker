# Sync Local Creations to Railway

Quick guide for syncing all local creations (database + files) to Railway.

## Prerequisites

1. **Local data exists**:
   - SQLite database: `./data/db/heromaker.db`
   - Local files: `./data/files/` (or path from `FILES_ROOT`)

2. **Railway services configured**:
   - PostgreSQL database created
   - Storage Bucket created
   - Environment variables set in Railway

## Quick Start

### Method 1: Run Locally (Recommended)

**First time setup:**

1. **Create Railway credentials file**:
   ```bash
   cp .env.railway.example .env.railway
   ```

2. **Edit `.env.railway`** and add your Railway credentials:
   - **PostgreSQL**: Railway dashboard → PostgreSQL service → Connect → copy connection string
   - **S3 Storage Bucket**: Railway dashboard → Storage Bucket → View credentials → copy all values
   
   The file should look like:
   ```bash
   DATABASE_URL=postgresql://user:password@host:port/database
   S3_BUCKET=your-bucket-name
   S3_ENDPOINT=https://storage.railway.app
   S3_ACCESS_KEY_ID=your-access-key-id
   S3_SECRET_ACCESS_KEY=your-secret-access-key
   S3_REGION=auto
   ```

3. **Run sync** (credentials are automatically loaded from `.env.railway`):
   ```bash
   ./scripts/sync-to-railway.sh
   ```
   
   Or directly:
   ```bash
   cd backend
   python scripts/sync_local_to_railway.py
   ```

**Note:** `.env.railway` is gitignored, so your secrets won't be committed. You only need to set this up once!

### Method 2: Run on Railway

This uses Railway's environment variables automatically:

```bash
railway run --service backend python scripts/sync_local_to_railway.py
```

## What the Script Does

1. **Database Migration**:
   - Connects to local SQLite database
   - Connects to Railway PostgreSQL
   - Migrates all users, creations, and steps
   - Skips existing records (idempotent)

2. **File Migration**:
   - Reads all files from local filesystem
   - Uploads to S3 Storage Bucket
   - Maintains structure: `{user_id}/{creation_id}/{filename}`
   - Skips existing files (idempotent)

3. **Verification**:
   - Compares record counts
   - Verifies file uploads
   - Reports any failures

## Expected Output

```
============================================================
SYNC LOCAL CREATIONS TO RAILWAY
============================================================

Checking prerequisites...
✓ Local SQLite database found: ./data/db/heromaker.db
✓ Local files directory found: ./data/files (42 files)
✓ PostgreSQL DATABASE_URL configured
✓ S3_BUCKET configured: heromaker-files-xxx

============================================================
STEP 1: Database Migration (SQLite → PostgreSQL)
============================================================
...
✓ Migrated 1 users (skipped 0 existing)
✓ Migrated 5 creations (skipped 0 existing)
✓ Migrated 30 creation steps (skipped 0 existing)

============================================================
STEP 2: File Migration (Local Filesystem → S3)
============================================================
...
Processing user: debug-user-uuid
  Processing creation: abc-123
    ✓ original.jpg (2.5 MB)
    ✓ processed.jpg (2.3 MB)
    ✓ rendered.png (1.8 MB)
    ✓ model.glb (5.2 MB)
    ✓ rigged.glb (5.1 MB)
    ✓ avatar.vrm (4.9 MB)

============================================================
SYNC SUMMARY
============================================================
Database migration: ✓ SUCCESS
File migration: ✓ SUCCESS

✅ All migrations completed successfully!
```

## Troubleshooting

### "Local SQLite database not found"

- Ensure you have local data to migrate
- Check path: `./data/db/heromaker.db`
- If using a different path, update the script

### "DATABASE_URL does not point to PostgreSQL"

- Get PostgreSQL connection string from Railway dashboard
- Format: `postgresql://user:pass@host:port/dbname`
- Or use Railway Variable Reference: `${{Postgres.DATABASE_URL}}`

### "S3_BUCKET environment variable not set"

- Get S3 credentials from Railway dashboard → Storage Bucket
- Set all required variables:
  - `S3_BUCKET`
  - `S3_ENDPOINT`
  - `S3_ACCESS_KEY_ID`
  - `S3_SECRET_ACCESS_KEY`
  - `S3_REGION` (usually "auto")

### "File upload failed"

- Check S3 credentials are correct
- Verify bucket exists and is accessible
- Check file size limits (Railway Storage Buckets have limits)
- Review error messages in output

### "Database connection failed"

- Verify PostgreSQL is running in Railway
- Check connection string format
- Ensure PostgreSQL service is accessible from your network
- For Railway CLI: ensure you're logged in and connected to the project

## After Migration

1. **Verify in Railway Dashboard**:
   - PostgreSQL: Check tables and record counts
   - Storage Bucket: Check files are present

2. **Test the Application**:
   - Upload a new image
   - Verify it goes to S3
   - Check database records are created in PostgreSQL

3. **Update Environment Variables** (if not already set):
   - Backend service should use PostgreSQL `DATABASE_URL`
   - Backend service should have S3 credentials set

## Notes

- **Idempotent**: Safe to run multiple times - existing records/files are skipped
- **Incremental**: Only migrates new data, doesn't overwrite existing
- **Non-destructive**: Local data is never modified or deleted
- **Progress tracking**: Shows detailed progress for each operation

