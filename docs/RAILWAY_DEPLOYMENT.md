# Railway Deployment Guide

This guide explains how to deploy HeroMaker to Railway using **pre-built Docker images**. This approach avoids Railpack detection issues and provides faster, more reliable deployments.

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

## Step 2: Deploy to Railway

### Create Railway Project

1. Go to [railway.app](https://railway.app)
2. Create a new project
3. Click "New Service" → "Empty Service"

### Deploy Backend Service

1. In the service settings, go to **Settings** → **Source**
2. Select **Deploy from Docker image**
3. Enter image URL: `ghcr.io/YOUR_GITHUB_USERNAME/heromaker/backend:latest`
4. Configure authentication:
   - Username: Your GitHub username
   - Password: GitHub Personal Access Token (with `read:packages` permission)
5. Set **Root Directory**: Leave empty (not needed for images)
6. Configure environment variables (see below)

### Deploy Frontend Service

1. Create another service: "New Service" → "Empty Service"
2. **Deploy from Docker image**: `ghcr.io/YOUR_GITHUB_USERNAME/heromaker/frontend:latest`
3. Same authentication as backend
4. Configure environment variables

### Deploy VRM Converter Service

1. Create another service: "New Service" → "Empty Service"
2. **Deploy from Docker image**: `ghcr.io/YOUR_GITHUB_USERNAME/heromaker/vrm-converter:latest`
3. Same authentication as backend
4. Configure environment variables

## Step 3: Configure Environment Variables

### Backend Service

```
OPENAI_API_KEY=your_key_here
MESHY_API_KEY=your_key_here
DATABASE_URL=sqlite:///./heromaker.db
DEBUG=false
ASSETS_ROOT=/app/assets
VRM_CONVERTER_SERVICE_URL=http://vrm-converter:8000
ALLOWED_ORIGINS=https://your-frontend-url.railway.app
```

### Frontend Service

```
VITE_API_BASE_URL=https://your-backend-url.railway.app
```

### VRM Converter Service

```
BLENDER_PATH=/usr/bin/blender
```

## Step 4: Configure Persistent Volumes

In Railway dashboard, for each service:

### Backend Service
- Mount volume at `/app/assets` (for user uploads and generated files)
- Mount volume at `/app/heromaker.db` (for database persistence)

### Frontend Service
- No persistent storage needed

### VRM Converter Service
- Mount volume at `/app/assets` (to access GLB files and write VRM files)

**Note**: Make sure backend and vrm-converter use the **same volume** for `/app/assets` so they can share files.

## Step 5: Configure Networking

Railway automatically creates a private network for services in the same project. Services can communicate using:

- Service names as hostnames (e.g., `http://vrm-converter:8000`)
- Railway automatically resolves service names within the project

## Step 6: Configure Health Checks

In Railway dashboard, for each service:

- **Backend**: Health check path `/health`
- **Frontend**: Health check path `/health`
- **VRM Converter**: Health check path `/health`

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

## Troubleshooting

### Image Pull Errors

If Railway can't pull images:
- Verify image exists: `docker pull ghcr.io/YOUR_USERNAME/heromaker/backend:latest`
- Check GHCR package visibility (should be public or Railway has access)
- Verify authentication token has `read:packages` permission

### Service Communication Issues

- Verify services are in the same Railway project
- Check service names match (Railway uses service names, not container names)
- Test connectivity: `railway run --service backend curl http://vrm-converter:8000/health`

### Volume Mount Issues

- Ensure volumes are mounted at correct paths
- Backend and VRM converter must share the same `/app/assets` volume
- Check volume permissions

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

## Next Steps

1. Build and push images to GHCR
2. Create Railway project and deploy services from images
3. Configure environment variables
4. Set up persistent volumes
5. Configure health checks
6. Test the application
7. Set up automatic deployments (optional)
