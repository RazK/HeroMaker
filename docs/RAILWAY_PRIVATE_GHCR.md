# Railway Private GHCR Authentication Setup

## Step 1: Create GitHub Personal Access Token

1. Go to: https://github.com/settings/tokens
2. Click **"Generate new token"** → **"Generate new token (classic)"**
3. Name it: `Railway GHCR Access`
4. Set expiration (recommend: 90 days or No expiration)
5. Select scopes:
   - ✅ **`read:packages`** (required to pull images)
6. Click **"Generate token"**
7. **COPY THE TOKEN** - you won't see it again! It looks like: `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

## Step 2: Configure Railway Service Authentication

For **each service** (backend, frontend, vrm-converter):

### Option A: Via Railway Dashboard (if available)

1. Go to your service in Railway
2. Click **Settings** tab
3. Look for **"Registry"** or **"Docker Registry"** section
4. If you see authentication fields:
   - **Registry URL**: `ghcr.io`
   - **Username**: `RazK` (your GitHub username)
   - **Password**: `YOUR_PERSONAL_ACCESS_TOKEN` (the token from Step 1)

### Option B: Via Railway CLI

If the dashboard doesn't show authentication options, use Railway CLI:

```bash
# Install Railway CLI if needed
npm i -g @railway/cli

# Login to Railway
railway login

# Link to your project
railway link

# Set registry credentials for each service
railway variables set DOCKER_REGISTRY_USERNAME=RazK --service backend
railway variables set DOCKER_REGISTRY_PASSWORD=YOUR_TOKEN --service backend

railway variables set DOCKER_REGISTRY_USERNAME=RazK --service frontend
railway variables set DOCKER_REGISTRY_PASSWORD=YOUR_TOKEN --service frontend

railway variables set DOCKER_REGISTRY_USERNAME=RazK --service vrm-converter
railway variables set DOCKER_REGISTRY_PASSWORD=YOUR_TOKEN --service vrm-converter
```

### Option C: Environment Variables (if Railway supports it)

Some Railway plans support registry authentication via environment variables. Check if these work:

- `DOCKER_REGISTRY_USERNAME`
- `DOCKER_REGISTRY_PASSWORD`
- `DOCKER_REGISTRY_URL` (set to `ghcr.io`)

## Step 3: Verify

After setting authentication:
1. Redeploy the service in Railway
2. Check logs - should show successful image pull
3. Service should start successfully

## Troubleshooting

### If authentication options aren't visible:
- Railway's free tier might not support private registry authentication
- Check Railway documentation for your plan's features
- Consider Railway Pro plan if needed

### Alternative: Use Railway's GitHub Integration
- Connect Railway to your GitHub repo
- Railway can authenticate using GitHub OAuth
- Deploy from source instead of pre-built images

## Security Note

- Never commit the token to git
- Store it securely (use Railway's secrets management)
- Rotate tokens periodically
- Use minimal scopes (only `read:packages`)

