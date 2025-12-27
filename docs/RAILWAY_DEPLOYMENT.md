# Railway Deployment Guide

Complete guide for deploying HeroMaker to Railway with detailed service configuration.

## Overview

This guide covers deploying HeroMaker to Railway using **pre-built Docker images**. This approach avoids Railpack detection issues and provides faster, more reliable deployments.

## Recommended Approach: Deploy Pre-Built Docker Images

Deploying pre-built images from GitHub Container Registry (GHCR) is the recommended approach because:
- ✅ Avoids Railpack detection errors
- ✅ Faster deployments (no build time on Railway)
- ✅ Free (GHCR included with GitHub)
- ✅ Version control for images
- ✅ Can test images locally before deploying

## Step 1: Build and Push Docker Images

### Option A: Build Locally and Push

```bash
# Login to GHCR (use GitHub Personal Access Token with packages:write permission)
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# Build and push all images
./scripts/build-and-push-images.sh ghcr.io/YOUR_GITHUB_USERNAME/heromaker latest
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
```
OPENAI_API_KEY=your_openai_key_here
MESHY_API_KEY=your_meshy_key_here
DATABASE_URL=sqlite:////app/data/db/heromaker.db
DEBUG=false
FILES_ROOT=/app/data/files
VRM_CONVERTER_SERVICE_URL=http://vrm-converter:8000
ALLOWED_ORIGINS=https://your-frontend-url.railway.app
```

**Note**: Replace `your-frontend-url.railway.app` with your actual frontend Railway URL after deployment.

#### Persistent Volumes
Mount **one volume** at:
- `/app/data` - Contains both user files and database

**Directory Structure**:
- `/app/data/files/{user_id}/{creation_id}/` - User uploads and generated files
- `/app/data/db/heromaker.db` - Database file

**Note**: Use 3 slashes in `DATABASE_URL` (`sqlite:////`) because the path is absolute.

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
```
VITE_API_BASE_URL=https://your-backend-url.railway.app
```

**Note**: Replace `your-backend-url.railway.app` with your actual backend Railway URL.

**Alternative**: If frontend proxies to backend via nginx (configured in `nginx.conf`), you can leave this empty and the frontend will use relative `/api/*` paths.

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

### 1. Deploy Backend Service

1. Create new service → "Empty Service"
2. **Deploy from Docker image**: `ghcr.io/YOUR_GITHUB_USERNAME/heromaker/backend:latest`
3. Configure authentication (GitHub username + token)
4. Configure environment variables (see above)
5. Set health check: `/health`
6. Mount volume: `/app/data`
7. Deploy

**Note the public URL** (e.g., `https://backend-production-xxxx.up.railway.app`)

### 2. Deploy Frontend Service

1. Create new service → "Empty Service"
2. **Deploy from Docker image**: `ghcr.io/YOUR_GITHUB_USERNAME/heromaker/frontend:latest`
3. Same authentication as backend
4. Set health check: `/health`
5. Set environment variable:
   ```
   VITE_API_BASE_URL=https://backend-production-xxxx.up.railway.app
   ```
6. Deploy

**Note the public URL** (e.g., `https://frontend-production-xxxx.up.railway.app`)

### 3. Deploy VRM Converter Service

1. Create new service → "Empty Service"
2. **Deploy from Docker image**: `ghcr.io/YOUR_GITHUB_USERNAME/heromaker/vrm-converter:latest`
3. Same authentication as backend
4. Set health check: `/health`
5. **Disable public networking** (private only)
6. Mount volume: `/app/data` (**use same volume as backend**)
7. Set resource limits: 2 vCPU, 2-4GB RAM
8. Deploy

### 4. Update Backend Configuration

1. Go to Backend service → Settings → Variables
2. Update `ALLOWED_ORIGINS` with frontend URL:
   ```
   ALLOWED_ORIGINS=https://frontend-production-xxxx.up.railway.app
   ```
3. Redeploy backend

### 5. Verify Everything Works

1. **Backend health**: `https://backend-url.railway.app/health`
2. **Frontend health**: `https://frontend-url.railway.app/health`
3. **VRM Converter health**: Check Railway logs (no public URL)
4. **Test full flow**: Upload image via frontend, verify backend processes it

---

## Service Communication

### Internal Service URLs

Services communicate via Railway's private network using service names:

- **Backend → VRM Converter**: `http://vrm-converter:8000`
- **Frontend → Backend**: Use public URL or private `http://backend:8000` (if configured)

### Environment Variable Updates

After all services are deployed, update:

1. **Backend** `ALLOWED_ORIGINS` with frontend public URL
2. **Frontend** `VITE_API_BASE_URL` with backend public URL (if not using nginx proxy)

---

## Updating Deployments

### Manual Update

1. Build new images: `./scripts/build-and-push-images.sh ghcr.io/YOUR_USERNAME/heromaker latest`
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

- Verify services are in the same Railway project
- Verify private networking is enabled on all services
- Check service names match (Railway uses service names, not container names)
- Verify `VRM_CONVERTER_SERVICE_URL` uses service name: `http://vrm-converter:8000`
- Test connectivity: `railway run --service backend curl http://vrm-converter:8000/health`

### Volume Mount Issues

- Ensure volumes are mounted at correct paths
- Backend and VRM converter must use the **same volume** for `/app/data`
- Check volume permissions
- Verify volumes are mounted correctly in Railway dashboard

### Resource Limits

- VRM converter may need more resources
- Check Railway logs for OOM (Out of Memory) errors
- Consider upgrading Railway plan if needed

---

## Alternative: Deploy from Dockerfile (If Needed)

If you prefer Railway to build from source:

1. **Deploy Backend Service**
   - Click "New Service" → "GitHub Repo"
   - Select your repository
   - Set **Root Directory** to `backend/`
   - Railway will detect `backend/Dockerfile`

2. **Deploy Frontend Service**
   - Same process, set **Root Directory** to `frontend/`

3. **Deploy VRM Converter Service**
   - Same process, set **Root Directory** to `vrm-converter-service/`

**Note**: This approach may trigger Railpack detection if Railway analyzes the root directory. Using pre-built images avoids this issue.

---

## Quick Reference

### Health Check Endpoints
- Backend: `/health` or `/health/detailed`
- Frontend: `/health`
- VRM Converter: `/health`

### Ports
- Backend: 8000 (internal), Railway assigns public port
- Frontend: 80 (internal), Railway assigns public port
- VRM Converter: 8000 (internal only, no public port)

### Service Names (Private Network)
- `backend` or `backend.railway.internal`
- `frontend` or `frontend.railway.internal`
- `vrm-converter` or `vrm-converter.railway.internal`

---

## Next Steps

After all services are configured and running:

1. Test the full pipeline (upload → 3D generation → VRM conversion)
2. Set up custom domain (optional)
3. Configure monitoring and alerts
4. Set up automated backups (see `BACKUP_RECOVERY.md`)
