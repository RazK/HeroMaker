# Quick Start: Deploy to Railway

## TL;DR - Deploy Pre-Built Images

1. **Build and push images:**
   ```bash
   docker login ghcr.io -u YOUR_GITHUB_USERNAME
   ./scripts/build-and-push-images.sh ghcr.io/YOUR_GITHUB_USERNAME/heromaker latest
   ```

2. **In Railway:**
   - Create 3 services (backend, frontend, vrm-converter)
   - For each: Settings → Deploy from Docker image
   - Image URLs:
     - `ghcr.io/YOUR_GITHUB_USERNAME/heromaker/backend:latest`
     - `ghcr.io/YOUR_GITHUB_USERNAME/heromaker/frontend:latest`
     - `ghcr.io/YOUR_GITHUB_USERNAME/heromaker/vrm-converter:latest`

3. **Set environment variables** (see full guide)

4. **Mount volumes** for `/app/assets` and `/app/heromaker.db`

Done! 🎉

## Full Guide

See [RAILWAY_DEPLOYMENT.md](RAILWAY_DEPLOYMENT.md) for complete instructions.

