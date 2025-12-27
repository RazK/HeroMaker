# 🚀 Simple Railway Deployment (Dockerfile-based)

**Easiest option** - Railway builds from your Dockerfiles automatically.

## Overview

Railway can detect and build from Dockerfiles when you deploy from source. This is simpler than pre-built images but takes longer to deploy.

## Quick Start

### 1. Push Code to GitHub

```bash
git add .
git commit -m "Ready for Railway deployment"
git push origin main
```

### 2. Create Railway Project

1. Go to [railway.app](https://railway.app)
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your repository

### 3. Deploy Backend Service

1. In Railway project, click **"New Service"** → **"GitHub Repo"**
2. Select your repository
3. Set **Root Directory** to: `backend/`
4. Railway will detect `backend/Dockerfile` automatically
5. Add environment variables:
   ```
   OPENAI_API_KEY=your_key_here
   MESHY_API_KEY=your_key_here
   DATABASE_URL=sqlite:////app/data/db/heromaker.db
   FILES_ROOT=/app/data/files
   VRM_CONVERTER_SERVICE_URL=http://vrm-converter:8000
   ALLOWED_ORIGINS=https://your-frontend-url.railway.app
   DEBUG=false
   ```
6. Add volume: Mount `/app/data` (create new volume)
7. Set health check: `/health`
8. Deploy

**Note the public URL** (e.g., `https://backend-production-xxxx.up.railway.app`)

### 4. Deploy Frontend Service

1. Click **"New Service"** → **"GitHub Repo"**
2. Select same repository
3. Set **Root Directory** to: `frontend/`
4. Railway will detect `frontend/Dockerfile` automatically
5. Add environment variable:
   ```
   VITE_API_BASE_URL=https://your-backend-url.railway.app
   ```
6. Set health check: `/health`
7. Deploy

**Note the public URL** (e.g., `https://frontend-production-xxxx.up.railway.app`)

### 5. Deploy VRM Converter Service

1. Click **"New Service"** → **"GitHub Repo"**
2. Select same repository
3. Set **Root Directory** to: `vrm-converter-service/`
4. Railway will detect `vrm-converter-service/Dockerfile` automatically
5. Add environment variable:
   ```
   BLENDER_PATH=/usr/bin/blender
   ```
6. Add volume: Mount `/app/data` (**use same volume as backend**)
7. **Disable public networking** (private only)
8. Set health check: `/health` (timeout: 60s)
9. Set resource limits: 2 vCPU, 2-4GB RAM
10. Deploy

### 6. Update Service URLs

After all services are deployed:

1. **Backend** → Update `ALLOWED_ORIGINS` with frontend URL
2. **Frontend** → Update `VITE_API_BASE_URL` with backend URL

### 7. Verify

- Backend: `https://backend-url.railway.app/health`
- Frontend: `https://frontend-url.railway.app/health`
- Test full flow: Upload image via frontend

## Pros & Cons

### ✅ Pros
- **Simpler** - No need to build/push images manually
- **Automatic** - Railway builds on every push
- **No GHCR setup** - No need for GitHub Container Registry

### ❌ Cons
- **Slower deployments** - Builds happen on Railway (5-10 minutes)
- **Build limits** - Railway free tier has build time limits
- **Less control** - Can't test images locally before deploying

## Alternative: Pre-Built Images

If you want faster deployments and more control, see `RAILWAY_DEPLOYMENT.md` for deploying pre-built images from GHCR.

## Troubleshooting

### Build Fails
- Check Railway logs for build errors
- Verify Dockerfiles are correct
- Check root directory is set correctly

### Services Can't Communicate
- Verify services are in same Railway project
- Check private networking is enabled
- Verify service names: `backend`, `frontend`, `vrm-converter`

### Volume Issues
- Ensure backend and VRM converter use **same volume** for `/app/data`
- Check volume is mounted at `/app/data`

