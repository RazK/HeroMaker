# HeroMaker DevOps Reference

Everything you need to know to run, stop, and deploy HeroMaker.

---

## Architecture Overview

HeroMaker has **3 services**:

| Service | What it does | Language/Runtime |
|---|---|---|
| **backend** | FastAPI REST API, AI pipeline orchestration | Python / uvicorn |
| **frontend** | React UI | Node (dev) / nginx (prod) |
| **vrm-converter** | Converts GLB → VRM using Blender | Python / uvicorn + Blender |

---

## Local Development

### Port Map

| Service | Your Mac (host) | Inside container | Notes |
|---|---|---|---|
| frontend | `localhost:3000` | N/A (runs on Mac, not in Docker) | Vite dev server with hot reload |
| backend | `localhost:8000` | `8000` | Docker, mapped `8000:8000` |
| vrm-converter | `localhost:8001` | `8000` | Docker, mapped `8001:8000` |

**Why do backend and vrm-converter both use port 8000 internally?**
Because containers are isolated — they each have their own network namespace. The host port (8001 vs 8000) is what distinguishes them from your Mac.

**How does backend reach vrm-converter?**
Via Docker's internal network `heromaker-network` at `http://vrm-converter:8000` — this is the *internal* port, not 8001.

### Starting Everything

```bash
cd /path/to/HeroMaker   # or your worktree

# 1. Start backend + vrm-converter in Docker
docker-compose up -d backend vrm-converter

# 2. Start frontend natively (Docker frontend image has no npm — it's a multi-stage nginx build)
cd frontend
npm run dev -- --port 3000
```

### Stopping Everything

```bash
# Stop Docker services
docker-compose down

# Stop frontend: Ctrl+C in the terminal running npm run dev
```

### Checking Status

```bash
docker-compose ps                        # see running containers
curl http://localhost:8000/health        # backend health
curl http://localhost:8001/health        # vrm-converter health
# frontend: open http://localhost:3000 in browser
```

### Logs

```bash
docker-compose logs -f backend           # follow backend logs
docker-compose logs -f vrm-converter     # follow vrm-converter logs
docker-compose logs --tail=50 backend    # last 50 lines
```

### Data Persistence (local)

All data lives in `./data/` (relative to repo root), mounted into containers:

```
./data/
  db/heromaker.db          ← SQLite database (survives container restarts)
  files/{user_id}/{creation_id}/  ← uploaded images, GLBs, VRMs
```

This folder is bind-mounted — data survives `docker-compose down` and restarts.
Only `docker-compose down -v` or manually deleting `./data/` would lose it.

### Environment Variables (local)

Stored in `.env` at repo root. The worktree symlinks to it:
```
.claude/worktrees/trusting-babbage/.env → /path/to/HeroMaker/.env
```

Key local-specific settings in `.env`:
```
DATABASE_URL=sqlite:///...  (absolute path to ./data/db/heromaker.db)
VRM_CONVERTER_SERVICE_URL=http://localhost:8001   ← NOTE: localhost, not Docker hostname
DEBUG=true
```

> ⚠️ `VRM_CONVERTER_SERVICE_URL=http://localhost:8001` is correct when backend runs in Docker
> because the backend container reaches the host via `host.docker.internal` — actually
> wait: this should be `http://vrm-converter:8000` when both run in Docker.
> Use `http://localhost:8001` only if backend runs natively on Mac (not in Docker).

### Git Worktrees (Claude vs Cursor)

Claude works in a separate git worktree:
- Claude: `~/.claude/worktrees/trusting-babbage/` (branch: `claude/trusting-babbage`)
- Cursor: `/Users/razkarl/projects/HeroMaker/` (branch: `mobile-ui-improvements-13`)

Both branch from the same base commit. Changes are independent at the filesystem level.
Merge strategy: commit → push → rebase on GitHub.

---

## Production (Railway)

### Architecture

Three separate Railway services in one Railway project:

```
Internet
  ├── https://frontend-xxx.railway.app  →  frontend service (nginx, static React build)
  └── https://backend-xxx.railway.app   →  backend service (FastAPI)
                                                    ↓ private network
                                         vrm-converter service (no public URL)
                                                    ↓ shared
                                         Railway Storage Bucket (S3-compatible, files)
                                         Railway PostgreSQL (database)
```

### Key Differences vs Local

| Thing | Local | Production |
|---|---|---|
| Database | SQLite (`./data/db/heromaker.db`) | PostgreSQL (Railway managed) |
| Files | Local filesystem (`./data/files/`) | Railway S3 Storage Bucket |
| Frontend | Vite dev server (hot reload) | nginx serving pre-built static bundle |
| Backend port | `8000` (fixed) | `$PORT` env var (Railway assigns, often 8080) |
| Secrets | `.env` file | Railway dashboard environment variables |
| Container orchestration | Docker Compose | Railway (each service = separate container) |

### Service → Service Communication (prod)

- **Frontend → Backend**: via `VITE_API_BASE_URL` (public Railway URL, baked into build)
- **Backend → VRM Converter**: `http://vrm-converter.railway.internal:$PORT` (private network)

### Deploy Flow

1. Push to `main` branch on GitHub
2. GitHub Actions (`.github/workflows/build-images.yml`) builds 3 Docker images and pushes to GHCR:
   - `ghcr.io/razkarl/heromaker/backend:latest`
   - `ghcr.io/razkarl/heromaker/frontend:latest`
   - `ghcr.io/razkarl/heromaker/vrm-converter:latest`
3. Railway auto-redeploys (or manual redeploy in dashboard)

### Railway Config Files

Each service directory has a `railway.toml`:
- `backend/railway.toml` — build from `backend/Dockerfile`, healthcheck `/health`
- `frontend/railway.toml` — build from `frontend/Dockerfile`, healthcheck `/health`
- `vrm-converter-service/railway.toml` — build from its `Dockerfile`, healthcheck `/health` (60s timeout for Blender)

### Checking Production Health

```bash
curl https://your-backend.railway.app/health
curl https://your-backend.railway.app/health/detailed
# frontend: open https://your-frontend.railway.app in browser
```

### Railway CLI

```bash
npm i -g @railway/cli
railway login
railway logs --service backend --lines 100
railway logs --service vrm-converter --lines 100
railway run --service backend python scripts/sync_local_to_railway.py  # data migration
```

---

## Frontend Docker Note

The frontend `Dockerfile` is a **multi-stage build**:
1. Stage 1 (`node:20-alpine`): builds React app with `npm run build`
2. Stage 2 (`nginx:alpine`): copies `dist/` into nginx, no node/npm present

This means:
- **Production**: use `docker build` → nginx image with static files ✅
- **Local dev**: do NOT use Docker for frontend — run `npm run dev` natively instead ✅
- The `docker-compose.yml` overrides CMD to `npm run dev`, which fails because the final image has no npm ❌ (known issue — just use native npm)

---

## VRM Converter Resource Requirements

Blender is CPU and memory intensive:
- **Local**: 2 vCPU, 4GB RAM limit (set in docker-compose.yml)
- **Production**: Railway hobby plan may be tight — monitor for OOM errors on heavy load
- For Shaon Choref (100 heroes): jobs queue sequentially — Blender is single-threaded per job

---

## Quick Reference

```bash
# Local: start all
docker-compose up -d backend vrm-converter && cd frontend && npm run dev -- --port 3000

# Local: restart backend after code changes
docker-compose restart backend

# Local: full reset (keeps data)
docker-compose down && docker-compose up -d backend vrm-converter

# Local: nuclear reset (DELETES ALL DATA)
docker-compose down && rm -rf ./data && docker-compose up -d backend vrm-converter

# Check what's running
docker-compose ps
docker ps

# Production logs
railway logs --service backend -f
```
