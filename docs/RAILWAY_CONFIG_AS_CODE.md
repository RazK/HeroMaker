# Railway Config as Code

This project uses Railway's config-as-code feature to manage deployment settings in version control.

## Files

### Railway Configuration Files

- **`railway.toml`** - Root project configuration
- **`backend/railway.toml`** - Backend service configuration
- **`frontend/railway.toml`** - Frontend service configuration
- **`vrm-converter-service/railway.toml`** - VRM converter service configuration

These files define:
- Build settings (Dockerfile paths, context)
- Deploy settings (health checks, restart policies)
- Service-specific configurations

### Environment Variable Files

- **`railway.env.backend.example`** - Backend environment variables template
- **`railway.env.frontend.example`** - Frontend environment variables template
- **`railway.env.vrm-converter.example`** - VRM converter environment variables template

**Note:** The actual `railway.env.*` files (with real API keys) are gitignored. Copy the `.example` files and fill in your actual values.

## Usage

### 1. Initial Setup

```bash
# Copy example files and fill in your values
cp railway.env.backend.example railway.env.backend
cp railway.env.frontend.example railway.env.frontend
cp railway.env.vrm-converter.example railway.env.vrm-converter

# Edit the files with your actual API keys
# (These files are gitignored, so they won't be committed)
```

### 2. Sync Environment Variables to Railway

```bash
# Install Railway CLI if needed
npm i -g @railway/cli
railway login

# Sync all services
./scripts/sync-railway-env.sh

# Or sync a specific service
./scripts/sync-railway-env.sh backend
./scripts/sync-railway-env.sh frontend
./scripts/sync-railway-env.sh vrm-converter
```

### 3. Deploy

When you push changes to the `railway-deployment` branch:

1. Railway automatically detects the `railway.toml` files
2. Applies the build/deploy settings from those files
3. Environment variables are synced via the sync script (or manually in dashboard)

## How It Works

1. **Railway detects `railway.toml` files** in service directories
2. **Build settings** are applied automatically (Dockerfile, context)
3. **Deploy settings** are applied (health checks, restart policies)
4. **Environment variables** are managed via:
   - Railway dashboard (manual)
   - Railway CLI (via sync script)
   - `railway.env.*` files (local, gitignored)

## Benefits

- ✅ **Version Control** - Track deployment config changes in git
- ✅ **Consistency** - Same config across all deployments
- ✅ **Reproducibility** - Easy to recreate services
- ✅ **Documentation** - Config serves as documentation

## Updating Configuration

1. Edit the `railway.toml` files
2. Edit the `railway.env.*.example` files (for documentation)
3. Update your local `railway.env.*` files (if needed)
4. Sync env vars: `./scripts/sync-railway-env.sh`
5. Commit and push: Railway will auto-apply the config

## Notes

- Railway's config-as-code is **service-level**, not project-level
- Environment variables with secrets should **NOT** be committed
- Use Railway's secret management for sensitive values
- The sync script uses Railway CLI to set variables

