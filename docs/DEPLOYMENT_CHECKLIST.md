# 🚀 Railway Deployment Checklist

Quick checklist to ensure everything is ready for deployment.

## Pre-Deployment Verification

### ✅ Code Readiness
- [x] All services have health endpoints (`/health`)
- [x] Dockerfiles are production-ready
- [x] Environment variables are documented
- [x] Database path is correctly configured (`/app/data/db/heromaker.db`)
- [x] Files root is correctly configured (`/app/data/files`)
- [x] Local Docker Compose works correctly

### ✅ Docker Images
- [ ] Images built and pushed to GHCR (or ready to build)
- [ ] Image URLs documented
- [ ] GitHub Actions workflow configured (if using auto-build)

### ✅ Railway Configuration
- [ ] Railway account created
- [ ] GitHub token with `read:packages` permission (for private images)
- [ ] Or GHCR packages set to public

## Deployment Steps

### 1. Build and Push Images (If Not Using GitHub Actions)

```bash
# Login to GHCR
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# Build and push
./scripts/build-and-push-images.sh ghcr.io/YOUR_USERNAME/heromaker latest
```

**OR** push to GitHub and let GitHub Actions build automatically.

### 2. Create Railway Project

1. Go to [railway.app](https://railway.app)
2. Create new project
3. Add 3 services (see below)

### 3. Deploy Backend Service

**Source:**
- Type: Deploy from Docker image
- Image: `ghcr.io/YOUR_USERNAME/heromaker/backend:latest`
- Auth: GitHub username + Personal Access Token

**Environment Variables:**
```
OPENAI_API_KEY=your_key_here
MESHY_API_KEY=your_key_here
DATABASE_URL=sqlite:////app/data/db/heromaker.db
FILES_ROOT=/app/data/files
VRM_CONVERTER_SERVICE_URL=http://vrm-converter:8000
ALLOWED_ORIGINS=https://your-frontend-url.railway.app
DEBUG=false
```

**Volume:**
- Mount `/app/data` (create new volume)

**Health Check:**
- Path: `/health`

**Networking:**
- Public: ✅ Enabled
- Private: ✅ Enabled

**Note:** Update `ALLOWED_ORIGINS` after frontend is deployed.

### 4. Deploy Frontend Service

**Source:**
- Type: Deploy from Docker image
- Image: `ghcr.io/YOUR_USERNAME/heromaker/frontend:latest`
- Auth: Same as backend

**Environment Variables:**
```
VITE_API_BASE_URL=https://your-backend-url.railway.app
```

**Health Check:**
- Path: `/health`

**Networking:**
- Public: ✅ Enabled
- Private: ✅ Enabled

**Note:** Update `VITE_API_BASE_URL` with actual backend URL after deployment.

### 5. Deploy VRM Converter Service

**Source:**
- Type: Deploy from Docker image
- Image: `ghcr.io/YOUR_USERNAME/heromaker/vrm-converter:latest`
- Auth: Same as backend

**Environment Variables:**
```
BLENDER_PATH=/usr/bin/blender
```

**Volume:**
- Mount `/app/data` (**use same volume as backend**)

**Health Check:**
- Path: `/health`
- Timeout: 60 seconds (Blender takes time to start)

**Networking:**
- Public: ❌ Disabled (internal only)
- Private: ✅ Enabled

**Resource Limits:**
- CPU: 2 vCPU
- Memory: 2-4GB

### 6. Update Service URLs

After all services are deployed:

1. **Backend** → Update `ALLOWED_ORIGINS` with frontend URL
2. **Frontend** → Update `VITE_API_BASE_URL` with backend URL (if not using nginx proxy)

### 7. Verify Deployment

- [ ] Backend health: `https://backend-url.railway.app/health`
- [ ] Frontend health: `https://frontend-url.railway.app/health`
- [ ] Frontend loads correctly
- [ ] API calls work from frontend
- [ ] Upload an image and test full pipeline

## Post-Deployment

### Monitoring
- Check Railway logs for errors
- Monitor service health
- Test full user flow

### Custom Domain (Optional)
- Configure custom domain in Railway
- Update `ALLOWED_ORIGINS` with custom domain

### Backups
- Set up automated database backups
- See `docs/BACKUP_RECOVERY.md` for details

## Troubleshooting

### Images Not Pulling
- Verify image exists: `docker pull ghcr.io/YOUR_USERNAME/heromaker/backend:latest`
- Check GHCR package visibility
- Verify authentication token has `read:packages` permission

### Health Checks Failing
- Check service logs in Railway
- Verify health endpoints are accessible
- Check database connection (backend)
- Check Blender installation (VRM converter)

### Service Communication Issues
- Verify services are in same Railway project
- Check private networking is enabled
- Verify service names match (`vrm-converter`, `backend`, `frontend`)
- Test internal connectivity

### Volume Issues
- Ensure backend and VRM converter use **same volume** for `/app/data`
- Check volume permissions
- Verify volume is mounted correctly

## Quick Reference

### Image URLs
```
ghcr.io/YOUR_USERNAME/heromaker/backend:latest
ghcr.io/YOUR_USERNAME/heromaker/frontend:latest
ghcr.io/YOUR_USERNAME/heromaker/vrm-converter:latest
```

### Health Endpoints
- Backend: `/health` or `/health/detailed`
- Frontend: `/health`
- VRM Converter: `/health`

### Service Names (Private Network)
- `backend` or `backend.railway.internal`
- `frontend` or `frontend.railway.internal`
- `vrm-converter` or `vrm-converter.railway.internal`

### Required Environment Variables

**Backend:**
- `OPENAI_API_KEY` (required)
- `MESHY_API_KEY` (required)
- `DATABASE_URL` (default: `sqlite:////app/data/db/heromaker.db`)
- `FILES_ROOT` (default: `/app/data/files`)
- `VRM_CONVERTER_SERVICE_URL` (default: `http://vrm-converter:8000`)
- `ALLOWED_ORIGINS` (required after frontend deployment)

**Frontend:**
- `VITE_API_BASE_URL` (optional, if using nginx proxy)

**VRM Converter:**
- `BLENDER_PATH` (default: `/usr/bin/blender`)


