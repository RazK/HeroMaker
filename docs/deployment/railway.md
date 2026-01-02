# Railway Deployment Guide

Complete guide for deploying HeroMaker to Railway with detailed service configuration.

## Overview

This guide covers deploying HeroMaker to Railway. There are two main approaches:

1. **Pre-built Docker Images (Recommended)** - Fastest deployments, uses GitHub Container Registry
2. **Dockerfile-based** - Simpler setup, Railway builds from source

## Deployment Options Comparison

| Feature | Dockerfile-based | Pre-built Images (Public GHCR) |
|---------|------------------|--------------------------------|
| **Setup Complexity** | ⭐ Easy | ⭐⭐ Medium |
| **Deploy Speed** | 🐌 2-5 min | ⚡ 30-60 sec |
| **Cost** | 💰 Free | 💰 Free |
| **Image Privacy** | ✅ Private | ❌ Public |
| **Local Testing** | ❌ No | ✅ Yes |
| **Build Limits** | ⚠️ Yes | ✅ No |

**Recommendation:** Use pre-built images (Public GHCR) for fastest deployments. Public GHCR packages are free and images don't contain secrets (those are in env vars).

## Recommended Approach: Deploy Pre-Built Docker Images

Deploying pre-built images from GitHub Container Registry (GHCR) is the recommended approach because:
- ✅ Avoids Railpack detection errors
- ✅ Faster deployments (no build time on Railway)
- ✅ Free (GHCR included with GitHub, public packages are free)
- ✅ Version control for images
- ✅ Can test images locally before deploying

## Step 1: Build and Push Docker Images

### Option A: Build Locally and Push

```bash
# Login to GHCR (use GitHub Personal Access Token with packages:write permission)
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# Build and push all images
./devops/scripts/build-and-push-images.sh ghcr.io/YOUR_GITHUB_USERNAME/heromaker latest
```

### Option B: Automatic via GitHub Actions

Images are automatically built and pushed to GHCR when you:
- Push to `main` branch → builds `latest` tag
- Create a git tag (e.g., `v1.0.0`) → builds versioned tag
- Push a PR → builds but doesn't push (for testing)

The workflow is in `.github/workflows/build-images.yml`.

### Image URLs

After building, your images will be at:
- `ghcr.io/YOUR_GITHUB_USERNAME/heromaker/backend:latest`
- `ghcr.io/YOUR_GITHUB_USERNAME/heromaker/frontend:latest`
- `ghcr.io/YOUR_GITHUB_USERNAME/heromaker/vrm-converter:latest`

## Step 2: Create Railway Project

1. Go to [railway.app](https://railway.app)
2. Create a new project
3. Click "New Service" → "Empty Service"

## Step 3: Service Configuration

You need to configure 3 services:
1. **Backend** - FastAPI service (port 8000)
2. **Frontend** - React + Nginx (port 80)
3. **VRM Converter** - Blender service (port 8000)

### Backend Service

#### Source
- **Type**: Deploy from Docker image
- **Image URL**: `ghcr.io/YOUR_GITHUB_USERNAME/heromaker/backend:latest`
- **Authentication**: GitHub username + Personal Access Token (with `read:packages` permission)

#### Health Check
- **Healthcheck Path**: `/health`
- **Timeout**: 30 seconds (default)

#### Start Command
- **Custom Start Command**: Leave empty (uses Dockerfile CMD: `uvicorn app.main:app --host 0.0.0.0 --port 8000`)

#### Networking
- **Public Networking**: ✅ Enabled (for API access)
- **Private Networking**: ✅ Enabled (for internal service communication)
- **Private DNS**: `backend.railway.internal`

#### Environment Variables

**If using PostgreSQL + S3 (Recommended):**
```
OPENAI_API_KEY=your_openai_key_here
MESHY_API_KEY=your_meshy_key_here
DATABASE_URL=${{Postgres.DATABASE_URL}}
DEBUG=false
S3_BUCKET=your_bucket_name
S3_ENDPOINT=https://storage.railway.app
S3_ACCESS_KEY_ID=your_access_key_id
S3_SECRET_ACCESS_KEY=your_secret_access_key
S3_REGION=auto
VRM_CONVERTER_SERVICE_URL=http://vrm-converter:8000
ALLOWED_ORIGINS=https://your-frontend-url.railway.app
```

**If using SQLite + Volumes (Legacy):**
```
OPENAI_API_KEY=your_openai_key_here
MESHY_API_KEY=your_meshy_key_here
DATABASE_URL=sqlite:////app/data/db/heromaker.db
DEBUG=false
FILES_ROOT=/app/data/files
VRM_CONVERTER_SERVICE_URL=http://vrm-converter:8000
ALLOWED_ORIGINS=https://your-frontend-url.railway.app
```

**Note**: 
- Replace `your-frontend-url.railway.app` with your actual frontend Railway URL after deployment.
- Replace `Postgres` with your actual PostgreSQL service name if different.
- For PostgreSQL, use Railway's Variable Reference `${{Postgres.DATABASE_URL}}` to automatically link the connection string.

#### Storage Configuration (Recommended: Railway Managed Services)

**Option 1: Railway Storage Buckets + PostgreSQL (Recommended)**

For production deployments, use Railway's managed services for persistent storage:

1. **Create Railway Storage Bucket** (for files):
   - Railway dashboard → Create → **Bucket**
   - Region: US West (or preferred)
   - Name: `heromaker-files`
   - Note: Buckets are private by default (good for security)

2. **Create Railway PostgreSQL Database**:
   - Railway dashboard → Create → **Database** → **PostgreSQL**
   - Note: Hobby plan provides 5GB storage

3. **Configure Backend Environment Variables**:
   Add these variables to your backend service (via Railway dashboard):
   ```
   # S3 Storage (from bucket credentials)
   S3_BUCKET=your_bucket_name
   S3_ENDPOINT=https://storage.railway.app
   S3_ACCESS_KEY_ID=your_access_key_id
   S3_SECRET_ACCESS_KEY=your_secret_access_key
   S3_REGION=auto
   
   # PostgreSQL (from database service - use Variable Reference)
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   ```
   
   **Note**: Use Railway's Variable References to automatically link the PostgreSQL connection string.

4. **Benefits**:
   - ✅ Persistent storage (survives container rebuilds)
   - ✅ Scalable (1TB files, 5GB database on Hobby plan)
   - ✅ Automatic backups (PostgreSQL managed service)
   - ✅ No volume management needed

**Option 2: Persistent Volumes (Legacy)**

If you prefer to use volumes instead of managed services:

Mount **one volume** at:
- `/app/data` - Contains both user files and database

**Directory Structure**:
- `/app/data/files/{user_id}/{creation_id}/` - User uploads and generated files
- `/app/data/db/heromaker.db` - Database file

**Note**: Use 3 slashes in `DATABASE_URL` (`sqlite:////`) because the path is absolute.

**Limitations**:
- ⚠️ Volumes require manual setup in Railway dashboard
- ⚠️ Data may be lost if volume is not properly mounted
- ⚠️ Less scalable than managed services

#### Resource Limits
- **CPU**: 1-2 vCPU (default is fine)
- **Memory**: 512MB-1GB (default is fine)

---

### Frontend Service

#### Source
- **Type**: Deploy from Docker image
- **Image URL**: `ghcr.io/YOUR_GITHUB_USERNAME/heromaker/frontend:latest`
- **Authentication**: Same as backend

#### Health Check
- **Healthcheck Path**: `/health`
- **Timeout**: 30 seconds (default)

#### Start Command
- **Custom Start Command**: Leave empty (uses Dockerfile CMD: nginx starts automatically)

#### Networking
- **Public Networking**: ✅ Enabled (for web access)
- **Private Networking**: ✅ Enabled (for API calls to backend)
- **Private DNS**: `frontend.railway.internal`

#### Environment Variables

**Required: Direct backend connection**
```
VITE_API_BASE_URL=https://your-backend-url.railway.app
```

**Note**: 
- Replace `your-backend-url.railway.app` with your actual backend Railway public URL
- The frontend calls the backend directly via this URL (no nginx proxy)
- This is set at build time, so you need to rebuild/redeploy frontend if the backend URL changes
- Railway provides automatic SSL certificates for all public services

#### Persistent Volumes
- **None needed** - Frontend is statically built

#### Resource Limits
- **CPU**: 0.5-1 vCPU (default is fine)
- **Memory**: 256MB-512MB (default is fine)

---

### VRM Converter Service

#### Source
- **Type**: Deploy from Docker image
- **Image URL**: `ghcr.io/YOUR_GITHUB_USERNAME/heromaker/vrm-converter:latest`
- **Authentication**: Same as backend

#### Health Check
- **Healthcheck Path**: `/health`
- **Timeout**: 60 seconds (Blender takes time to start)

#### Start Command
- **Custom Start Command**: Leave empty (uses Dockerfile CMD: `uvicorn app:app --host 0.0.0.0 --port 8000`)

#### Networking
- **Public Networking**: ❌ Disabled (only accessed internally by backend)
- **Private Networking**: ✅ Enabled (for backend communication)
- **Private DNS**: `vrm-converter.railway.internal`

#### Environment Variables
```
BLENDER_PATH=/usr/bin/blender
```

#### Persistent Volumes
Mount volume at:
- `/app/data` - **Must be the same volume as backend** (so they can share GLB/VRM files)

#### Resource Limits
- **CPU**: 2 vCPU (Blender needs more CPU)
- **Memory**: 2-4GB (Blender is memory-intensive)

**Important**: VRM converter needs more resources. Consider upgrading Railway plan if you hit limits.

---

## Step 4: Step-by-Step Deployment

### 1. Set Up Storage (If Using Managed Services)

**If using Railway Storage Buckets + PostgreSQL:**

1. **Create Storage Bucket**:
   - Railway dashboard → Create → **Bucket**
   - Name: `heromaker-files`
   - Note the bucket credentials (Access Key ID, Secret Access Key)

2. **Create PostgreSQL Database**:
   - Railway dashboard → Create → **Database** → **PostgreSQL**
   - Note the connection string (or use Variable Reference: `${{Postgres.DATABASE_URL}}`)

3. **Migrate Existing Data** (if migrating from volumes):
   - See "Data Migration" section below

### 2. Deploy Backend Service

1. Create new service → "Empty Service"
2. **Deploy from Docker image**: `ghcr.io/YOUR_GITHUB_USERNAME/heromaker/backend:latest`
3. Configure authentication (GitHub username + token)
4. Configure environment variables:
   - **If using managed services**: Add S3 and PostgreSQL variables (see Storage Configuration above)
   - **If using volumes**: Use SQLite and volume paths (see Storage Configuration above)
5. Set health check: `/health`
6. **If using volumes**: Mount volume at `/app/data`
7. Deploy

**Note the public URL** (e.g., `https://backend-production-xxxx.up.railway.app`)

### 3. Deploy Frontend Service

1. Create new service → "Empty Service"
2. **Deploy from Docker image**: `ghcr.io/YOUR_GITHUB_USERNAME/heromaker/frontend:latest`
3. Same authentication as backend
4. Set health check: `/health`
5. Set environment variables:
   ```
   VITE_API_BASE_URL=https://backend-production-xxxx.up.railway.app
   ```
   **Note**: Replace `backend-production-xxxx.up.railway.app` with your actual backend Railway URL (get this from backend service settings after deployment).
6. Deploy

**Note the public URL** (e.g., `https://frontend-production-xxxx.up.railway.app`)

### 4. Deploy VRM Converter Service

1. Create new service → "Empty Service"
2. **Deploy from Docker image**: `ghcr.io/YOUR_GITHUB_USERNAME/heromaker/vrm-converter:latest`
3. Same authentication as backend
4. Set health check: `/health`
5. **Disable public networking** (private only)
6. Mount volume: `/app/data` (**use same volume as backend**)
7. Set resource limits: 2 vCPU, 2-4GB RAM
8. Deploy

### 5. Update Backend Configuration

1. Go to Backend service → Settings → Variables
2. Update `ALLOWED_ORIGINS` with frontend URL:
   ```
   ALLOWED_ORIGINS=https://frontend-production-xxxx.up.railway.app
   ```
3. Redeploy backend

### 6. Verify Everything Works

1. **Backend health**: `https://backend-url.railway.app/health`
2. **Frontend health**: `https://frontend-url.railway.app/health`
3. **VRM Converter health**: Check Railway logs (no public URL)
4. **Test full flow**: Upload image via frontend, verify backend processes it

---

## Data Migration

If you're migrating from local development to Railway (or from volumes to managed services), you can sync all your local creations (database + files) to Railway in one step.

### Option 1: Unified Sync (Recommended)

**Sync both database and files in one command:**

1. **Set up Railway environment variables** (if running locally):
   ```bash
   # PostgreSQL connection (from Railway dashboard)
   export DATABASE_URL=postgresql://user:pass@host:port/dbname
   
   # S3 Storage Bucket credentials (from Railway dashboard)
   export S3_BUCKET=your_bucket_name
   export S3_ENDPOINT=https://storage.railway.app
   export S3_ACCESS_KEY_ID=your_access_key_id
   export S3_SECRET_ACCESS_KEY=your_secret_access_key
   export S3_REGION=auto
   ```

2. **Run unified sync script**:
   ```bash
   # From project root
   cd backend
   python scripts/sync_local_to_railway.py
   ```

   This will:
   - Migrate all users, creations, and steps from SQLite → PostgreSQL
   - Upload all files from local filesystem → S3 Storage Bucket
   - Skip existing records/files (idempotent - safe to run multiple times)
   - Show progress and verify data integrity

3. **Or run on Railway directly** (uses Railway environment variables):
   ```bash
   railway run --service backend python scripts/sync_local_to_railway.py
   ```

### Option 2: Separate Migrations

If you prefer to migrate database and files separately:

#### Migrate Files to S3

1. **Ensure S3 credentials are set**:
   ```bash
   export S3_BUCKET=your_bucket_name
   export S3_ENDPOINT=https://storage.railway.app
   export S3_ACCESS_KEY_ID=your_access_key_id
   export S3_SECRET_ACCESS_KEY=your_secret_access_key
   export S3_REGION=auto
   ```

2. **Run migration script**:
   ```bash
   cd backend
   python scripts/migrate_files_to_s3.py
   ```

3. **Verify files in Railway dashboard**:
   - Go to your Storage Bucket
   - Check that files are present with structure: `{user_id}/{creation_id}/{filename}`

#### Migrate Database to PostgreSQL

1. **Set PostgreSQL connection string**:
   ```bash
   export DATABASE_URL=postgresql://user:pass@host:port/dbname
   ```

2. **Run migration script**:
   ```bash
   cd backend
   python scripts/migrate_to_postgres.py
   ```

3. **Verify data in Railway dashboard**:
   - Go to your PostgreSQL database
   - Check that tables and data are present

### After Migration

1. **Update Railway environment variables**:
   - Set `S3_BUCKET` and S3 credentials (if not already set)
   - Set `DATABASE_URL` to PostgreSQL connection string
   - Remove `FILES_ROOT` (not needed for S3)

2. **Redeploy backend service**:
   - Railway will automatically use S3 and PostgreSQL
   - Files will be served via presigned URLs
   - Database operations will use PostgreSQL

3. **Test the application**:
   - Verify file uploads go to S3
   - Verify database operations use PostgreSQL
   - Check presigned URLs work correctly

---

## Service Communication

### Internal Service URLs

Services communicate via Railway's private network using service names:

- **Backend → VRM Converter**: `http://vrm-converter:8000`
- **Frontend → Backend**: Use public URL or private `http://backend:8000` (if configured)

### Environment Variable Updates

After all services are deployed, update:

1. **Backend** `ALLOWED_ORIGINS` with frontend public URL
2. **Frontend** `VITE_API_BASE_URL` with backend public URL (must rebuild frontend after changing this)

---

## Updating Deployments

### Manual Update

1. Build new images: `./devops/scripts/build-and-push-images.sh ghcr.io/YOUR_USERNAME/heromaker latest`
2. In Railway, go to service → **Settings** → **Source**
3. Click **Redeploy** (Railway will pull the latest image)

### Automatic Update (Recommended)

Set up GitHub Actions to automatically rebuild and push images on push to main. Railway can be configured to auto-redeploy when images are updated (check Railway settings).

## Service URLs

After deployment, Railway provides public URLs:
- Frontend: `https://your-frontend.railway.app`
- Backend: `https://your-backend.railway.app`
- VRM Converter: `https://your-vrm-converter.railway.app` (if exposed)

Update `ALLOWED_ORIGINS` in backend with the frontend URL.

---

## Troubleshooting

### Image Pull Errors

If Railway can't pull images:
- Verify image exists: `docker pull ghcr.io/YOUR_USERNAME/heromaker/backend:latest`
- Check GHCR package visibility (should be public or Railway has access)
- Verify authentication token has `read:packages` permission

### Health Checks Failing

- **Backend**: Check logs for database connection issues
- **Frontend**: Check if nginx is running (should be automatic)
- **VRM Converter**: Check if Blender is installed correctly (takes ~40s to start)

### Service Communication Issues

- **Frontend can't reach backend:**
  - Verify `VITE_API_BASE_URL` is set to backend's public Railway URL (e.g., `https://backend-xxxx.up.railway.app`)
  - Check backend is publicly accessible (public networking enabled)
  - Verify backend CORS settings allow frontend origin
  - Check browser console for CORS or network errors
  - **Note**: `VITE_API_BASE_URL` is baked into the frontend build - you must rebuild/redeploy frontend if backend URL changes

- **Backend can't reach VRM converter:**
  - Verify services are in the same Railway project
  - Verify private networking is enabled on both services
  - Check service names match (Railway uses service names, not container names)
  - Railway assigns ports dynamically - check VRM converter logs for actual port:
    ```bash
    railway logs --service vrm-converter --lines 100 | grep "Uvicorn running"
    ```
  - Update `VRM_CONVERTER_SERVICE_URL` in backend: `http://vrm-converter:XXXX` (replace XXXX with actual port)
  - Test connectivity: `railway run --service backend curl http://vrm-converter:XXXX/health`

### Volume Mount Issues

- Ensure volumes are mounted at correct paths
- Backend and VRM converter must use the **same volume** for `/app/data`
- Check volume permissions
- Verify volumes are mounted correctly in Railway dashboard

### Root Directory Configuration

If Railway shows "Dockerfile does not exist":

1. Go to Railway → Service → Settings → Source
2. Set **Root Directory** to:
   - Backend: `backend`
   - Frontend: `frontend`
   - VRM Converter: `vrm-converter-service`
3. Save and redeploy

The `railway.toml` files in each service directory help, but Railway still needs the Root Directory set in the dashboard for the initial service setup.

### Resource Limits

- VRM converter may need more resources
- Check Railway logs for OOM (Out of Memory) errors
- Consider upgrading Railway plan if needed

---

## Alternative: Deploy from Dockerfile

If you prefer Railway to build from source (simpler setup, but slower deployments):

### Quick Start

1. **Push Code to GitHub**
   ```bash
   git add .
   git commit -m "Ready for Railway deployment"
   git push origin main
   ```

2. **Create Railway Project**
   - Go to [railway.app](https://railway.app)
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository

3. **Deploy Services**
   - For each service (backend, frontend, vrm-converter):
     - Click "New Service" → "GitHub Repo"
     - Select your repository
     - Set **Root Directory** to: `backend/`, `frontend/`, or `vrm-converter-service/`
     - Railway will detect the Dockerfile automatically
     - Configure environment variables and volumes (same as pre-built images)

### Pros & Cons

**✅ Pros:**
- Simpler - No need to build/push images manually
- Automatic - Railway builds on every push
- No GHCR setup needed

**❌ Cons:**
- Slower deployments (5-10 minutes)
- Build limits on Railway free tier
- Can't test images locally before deploying

**Note**: This approach may trigger Railpack detection if Railway analyzes the root directory. Using pre-built images avoids this issue.

---

## Quick Reference

### Health Check Endpoints
- Backend: `/health` or `/health/detailed`
- Frontend: `/health`
- VRM Converter: `/health`

### Ports
- Backend: Railway assigns dynamically (check logs: `railway logs --service backend | grep "Uvicorn running"`), Railway assigns public port
- Frontend: Railway assigns dynamically (usually 80), Railway assigns public port
- VRM Converter: Railway assigns dynamically (check logs), internal only, no public port

**Important**: Railway assigns ports dynamically via the `PORT` environment variable. The backend listens on whatever port Railway assigns (often 8080, not 8000). Always check the startup logs to find the actual port:
```bash
railway logs --service backend --lines 100 | grep "Uvicorn running"
# Look for: "Uvicorn running on http://0.0.0.0:XXXX"
```

### Service Names (Private Network)
- `backend` or `backend.railway.internal`
- `frontend` or `frontend.railway.internal`
- `vrm-converter` or `vrm-converter.railway.internal`

---

## Config as Code

This project uses Railway's config-as-code feature to manage deployment settings in version control.

### Railway Configuration Files

- `backend/railway.toml` - Backend service configuration
- `frontend/railway.toml` - Frontend service configuration
- `vrm-converter-service/railway.toml` - VRM converter service configuration

These files define:
- Build settings (Dockerfile paths, context)
- Deploy settings (health checks, restart policies)
- Service-specific configurations

### Environment Variable Management

Environment variables are managed via:
- Railway dashboard (manual)
- Railway CLI (via `devops/scripts/sync-railway-env.sh`)
- `devops/railway/env/*.example` files (templates)

**Note:** The actual `devops/railway/env/*` files (with real API keys) are gitignored. Copy the `.example` files and fill in your actual values.

### Syncing Environment Variables

```bash
# Install Railway CLI if needed
npm i -g @railway/cli
railway login

# Sync all services
./devops/scripts/sync-railway-env.sh

# Or sync a specific service
./devops/scripts/sync-railway-env.sh backend
```

### Benefits

- ✅ **Version Control** - Track deployment config changes in git
- ✅ **Consistency** - Same config across all deployments
- ✅ **Reproducibility** - Easy to recreate services
- ✅ **Documentation** - Config serves as documentation

## Quick Deployment Checklist

### Pre-Deployment
- [x] All services have health endpoints (`/health`)
- [x] Dockerfiles are production-ready
- [x] Environment variables are documented
- [x] Database path configured (`/app/data/db/heromaker.db`)
- [x] Files root configured (`/app/data/files`)
- [x] Local Docker Compose works correctly

### Post-Deployment Verification
- [ ] Backend health: `https://backend-url.railway.app/health`
- [ ] Frontend health: `https://frontend-url.railway.app/health`
- [ ] Frontend loads correctly
- [ ] API calls work from frontend
- [ ] Upload an image and test full pipeline

## Next Steps

After all services are configured and running:

1. Test the full pipeline (upload → 3D generation → VRM conversion)
2. Set up custom domain (optional)
3. Configure monitoring and alerts
4. Review and update `railway.toml` files as needed
