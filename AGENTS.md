# Agent Instructions for HeroMaker

Follow the existing project guidance in `CLAUDE.md`.

## Cursor Cloud specific instructions

Use the repo-local setup script to refresh dependencies after pulling changes:

```bash
bash scripts/setup-dev-env.sh
```

The script is idempotent and installs backend dependencies into `.venv/`, frontend dependencies under `frontend/`, and writes a gitignored local `.env` only when one does not already exist.
It also installs the default seed database and gallery images when no local database exists yet. To reset local data back to the seed, run `bash scripts/install-seed-data.sh --force`.

If `python3 -m venv` reports that `ensurepip` is unavailable on Ubuntu, install `python3.12-venv` once and rerun the setup script.

For local development, start services with:

```bash
bash start-dev.sh
```

If broad process-kill commands are not allowed in the current agent environment, start the services manually in persistent terminals:

```bash
mkdir -p data/db data/files
(cd backend && ../.venv/bin/python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000)
(cd frontend && npm run dev)
(cd vrm-converter-service && BLENDER_PATH=/usr/bin/blender ../.venv/bin/python -m uvicorn app:app --host 0.0.0.0 --port 8001)
```

Verify the environment with:

```bash
curl http://localhost:8000/health/detailed
curl http://localhost:8001/health
curl http://localhost:5173/
```
