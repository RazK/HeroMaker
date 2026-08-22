# Agent Instructions for HeroMaker

Follow the existing project guidance in `CLAUDE.md`.

## Start here

- **Live product:** https://heromaker.up.railway.app/ — one public URL; `/api/*` is
  reverse-proxied to the backend on Railway's private network.
- **[docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md)** — every deployed and local URL, plus
  how to tell "the site is down" apart from "my sandbox blocks egress" (a blocked
  sandbox fails with `CONNECT tunnel failed, response 403` while DNS still resolves).
- **[docs/PRODUCT_AUDIT_2026-08.md](docs/PRODUCT_AUDIT_2026-08.md)** — known UX and
  product gaps, with measurements. Read before proposing UI work so you do not
  re-discover the same findings.

## Cursor Cloud specific instructions

Use the repo-local setup script to refresh dependencies after pulling changes:

```bash
bash scripts/setup-dev-env.sh
```

The script is idempotent and installs backend dependencies into `.venv/`, frontend dependencies under `frontend/`, and writes a gitignored local `.env` only when one does not already exist.

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
