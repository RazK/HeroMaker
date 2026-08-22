# Claude Instructions for HeroMaker

## Answering Raz

- **Bottom line first, and usually only.** A few sentences. No preamble, no story.
- No long explanations, caveats, or justifications unless explicitly asked.
- Details on request only. Lead with the answer, stop.

## Where the product lives

- **Live:** https://heromaker.up.railway.app/ (Railway, deployed from `main`).
- Full URL map, health checks, and troubleshooting: **[docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md)**.
- Known UX/product gaps with measurements: **[docs/PRODUCT_AUDIT_2026-08.md](docs/PRODUCT_AUDIT_2026-08.md)**.

Do not go hunting through scripts for the deployment URL — it is in the two docs above.

## Git & PR Rules

- **One PR per logical unit.** Even if given a list of tasks, work on them one at a time — separate branch, separate PR per topic (e.g. bug fixes, docs, new features are never mixed).
- Finish and open a PR for the current topic before starting the next one.

## Python / Venv

- **Always use the project venv**, never bare `python` or `python3`.
- Venv lives at `.venv/` in the project root (worktrees have a symlink pointing to main repo `.venv`).
- Run Python scripts as: `.venv/bin/python <script>`
- Run pip as: `.venv/bin/pip`

## Architecture: Local vs Production

| Service       | Local                              | Production (Railway)     |
|---------------|------------------------------------|--------------------------|
| Backend       | Native Python via `.venv`, port 8000 | Docker container        |
| Frontend      | Native `npm run dev`, port 5173    | Docker container (nginx) |
| VRM Converter | Docker container, port 8001        | Docker container         |

- **`start-dev.sh`** is the single command to start everything locally.
- **`docker-compose.yml`** is for production-like full-stack testing only — not used for daily dev.
- Railway deploys from `backend/Dockerfile`, `frontend/Dockerfile`, `vrm-converter-service/Dockerfile`.
