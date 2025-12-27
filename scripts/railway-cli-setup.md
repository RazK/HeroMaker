# Railway CLI Setup - Zero Clickops

This guide shows how to configure Railway entirely from the command line.

## Prerequisites

```bash
npm i -g @railway/cli
railway login
```

## One-Time Service Setup (CLI Method)

### Option 1: Link from Service Directories (Recommended)

```bash
# Link backend service
cd backend
railway link  # Select your project and create/link 'backend' service
cd ..

# Link frontend service  
cd frontend
railway link  # Select your project and create/link 'frontend' service
cd ..

# Link VRM converter service
cd vrm-converter-service
railway link  # Select your project and create/link 'vrm-converter' service
cd ..
```

When you link from a directory, Railway automatically sets that as the root directory!

### Option 2: Create Services via CLI

```bash
# Create services
railway service create backend
railway service create frontend
railway service create vrm-converter

# Then link each from its directory (this sets root directory)
cd backend && railway link && cd ..
cd frontend && railway link && cd ..
cd vrm-converter-service && railway link && cd ..
```

## Configure Environment Variables

```bash
# Run the sync script
./scripts/sync-railway-env.sh

# Or manually for each service:
railway variables set DATABASE_URL="sqlite:////app/data/db/heromaker.db" --service backend
railway variables set FILES_ROOT="/app/data/files" --service backend
# ... etc
```

## Deploy

Just push to your branch:
```bash
git push origin railway-deployment
```

Railway will:
- ✅ Detect railway.toml files
- ✅ Use correct root directories (from linking)
- ✅ Apply build/deploy settings
- ✅ Auto-deploy on push

## After Initial Setup

Once services are linked with correct root directories:
- All config comes from `railway.toml` files
- Environment variables from `railway.env.*` files
- Just push code → Railway auto-deploys
- **Zero clickops needed!**

