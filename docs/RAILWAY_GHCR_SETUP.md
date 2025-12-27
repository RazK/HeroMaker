# Railway + GHCR Setup Guide

## Issue: Railway Can't Access Private GHCR Images

If you see "Container failed to start - unable to connect to registry", the GHCR packages are likely private.

## Solution 1: Make Packages Public (Easiest)

1. Go to your GitHub packages: https://github.com/RazK?tab=packages
2. Find each package:
   - `heromaker/backend`
   - `heromaker/frontend`
   - `heromaker/vrm-converter`
3. Click on each package
4. Go to **Package settings** (gear icon)
5. Scroll to **Danger Zone**
6. Click **Change visibility** → **Make public**
7. Confirm

After making them public, Railway can pull the images without authentication.

## Solution 2: Use Private Images with Authentication

If you want to keep packages private, configure Railway authentication:

### Step 1: Create GitHub Personal Access Token

1. Go to: https://github.com/settings/tokens
2. Click **Generate new token (classic)**
3. Name it: `Railway GHCR Access`
4. Select scopes:
   - ✅ `read:packages` (to pull images)
5. Generate token and **copy it** (you won't see it again!)

### Step 2: Configure Railway Service

For each service in Railway:

1. Go to service → **Settings** → **Source**
2. Under **Docker Image Authentication**:
   - **Username**: `RazK` (your GitHub username)
   - **Password**: `YOUR_PERSONAL_ACCESS_TOKEN` (the token you just created)
3. Save

### Step 3: Redeploy

Railway will now authenticate when pulling images.

## Recommendation

**Make packages public** (Solution 1) - it's simpler and the images don't contain secrets (those are in environment variables).

## Verify Images Are Accessible

Test if images are public:
```bash
# Should work without login if public
docker pull ghcr.io/razk/heromaker/backend:latest
```

If it requires login, the package is still private.

