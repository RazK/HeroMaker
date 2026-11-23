# Railway

How HeroMaker runs on Railway today. The release flow (merge → staging →
promote) is in [cicd.md](./cicd.md); the rules and traps are in `CLAUDE.md`.
This page used to describe deploying pre-built images from GHCR; that path
is not used (cleanup, 2026-11-23).

## Services

One Railway project, two environments (`staging`, `production`), three
services. Every ID is in `devops/railway/project.json` and nowhere else.

| Service | Built from | Health check |
|---|---|---|
| backend | `backend/Dockerfile` (`backend/railway.toml`) | `/health` (and `/health/detailed`, which also probes the converter) |
| frontend | `frontend/Dockerfile` (`frontend/railway.toml`) | `/health` |
| vrm-converter | `vrm-converter-service/Dockerfile` (`vrm-converter-service/railway.toml`) | `/health`; private, reached only by the backend |

Deploys upload the source with `railway up` from the workflows
(`build-images.yml` to staging on every merge to `main`,
`promote-production.yml` to production when Raz approves). Railway builds
the Dockerfile itself.

## Variables

Never typed into the dashboard. They live in layered files under
`devops/railway/env/` and are pushed with `devops/scripts/railway-env.sh`
(`check`, `diff`, `sync`); secrets are Railway shared variables referenced as
`${{shared.KEY}}`. See `devops/railway/env/README.md`.

Changing a production variable redeploys the latest commit of its branch,
not the running image: read "Changing a production variable redeploys
unreleased code" in `CLAUDE.md` first.

## Data

The two databases (staging, production) stay separate. Copying creations
between them needs Raz's permission each time (`CLAUDE.md`). Backups run
daily (`backup.yml`).
