# Railway Root Directory Configuration

## Problem
Railway shows "Dockerfile does not exist" for frontend and vrm-converter services.

## Solution

For each service in Railway, set the **Root Directory**:

### Backend Service
1. Go to Railway → Backend Service → Settings → Source
2. Set **Root Directory** to: `backend`
3. Save

### Frontend Service  
1. Go to Railway → Frontend Service → Settings → Source
2. Set **Root Directory** to: `frontend`
3. Save

### VRM Converter Service
1. Go to Railway → VRM Converter Service → Settings → Source
2. Set **Root Directory** to: `vrm-converter-service`
3. Save

## Verification

After setting root directories:
- Railway will find the Dockerfiles
- Builds should succeed
- Services should deploy

## Note

The `railway.toml` files in each service directory help, but Railway still needs the Root Directory set in the dashboard for the initial service setup.

