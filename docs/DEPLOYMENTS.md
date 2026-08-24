# Deployments — where HeroMaker actually lives

> **Start here.** If you are a new contributor (human or AI agent) and you want to
> *see the product*, this is the page you need. Everything else in `docs/deployment/`
> explains *how to deploy*; this page states *what is deployed right now*.

## Live production

| What | URL | Notes |
|------|-----|-------|
| **HeroMaker (public app)** | **https://heromaker.up.railway.app/** | The only public entry point. Open this to use the product. |
| API (same host) | https://heromaker.up.railway.app/api/ | Not a separate domain — see "Why one URL" below. |
| API health | https://heromaker.up.railway.app/api/health | Should return `{"status":"healthy","service":"HeroMaker API"}` |

Hosted on **Railway**. Deploys are driven by `.github/workflows/deploy.yml` from the
`main` branch, building `frontend/Dockerfile`, `backend/Dockerfile` and
`vrm-converter-service/Dockerfile`.

### Why one URL

The frontend container runs nginx (`frontend/nginx.conf`), which serves the static
React build and reverse-proxies `^~ /api/` to the backend over Railway's **private
network**. The backend and the VRM converter have **no public URL** — you cannot
reach them directly from the internet, and you do not need to.

```
                    public internet
                          │
                          ▼
        https://heromaker.up.railway.app/         ← the only public host
                  (frontend: nginx)
                    │            │
       static React │            │ /api/*  (private network)
                    ▼            ▼
              index.html      backend (FastAPI)
                                   │ private network
                                   ▼
                          vrm-converter (Blender)
```

### Verifying it is up

```bash
curl -sS https://heromaker.up.railway.app/api/health
curl -sS -o /dev/null -w '%{http_code}\n' https://heromaker.up.railway.app/
```

`scripts/test-railway.sh` runs a fuller smoke test and already defaults to this host:

```bash
./scripts/test-railway.sh                                  # uses the URL above
./scripts/test-railway.sh https://some-other-host          # override
```

## Local

Run everything with `./start-dev.sh`, or manually (see `AGENTS.md`):

| Service | Local URL |
|---------|-----------|
| Frontend (Vite) | http://localhost:5173 |
| Backend (FastAPI) | http://localhost:8000 — docs at `/docs` |
| VRM converter | http://localhost:8001 |

Note the local split: the Vite dev server proxies `/api` to `127.0.0.1:8000`
(`VITE_API_PROXY_TARGET`), mirroring what nginx does in production.

## Outage playbook

The site can look healthy while being completely unusable: nginx serves the
static build, so `GET /` returns 200 while every `/api/*` request 504s. Check
the API, not the homepage.

```bash
curl -sS https://heromaker.up.railway.app/api/creations/steps/config   # via nginx
curl -sS https://heromaker-backend.up.railway.app/health/detailed      # backend direct
```

The backend has its own public URL, `heromaker-backend.up.railway.app`, which is
the fastest way to split the two failure modes apart:

| Through nginx | Backend direct | Meaning |
|---|---|---|
| 504 | 200 | nginx cannot reach the backend — check `VITE_API_PROXY_TARGET` on the **frontend** service |
| 504 | 504/timeout | the backend itself is down — check its deploy and logs |
| 200 | `/health/detailed` unhealthy | backend up, database connection bad |

There are **two working wiring modes**, and which one is live depends on
whether `VITE_API_BASE_URL` was baked into the frontend image at build time:

| Mode | Set at build | Browser calls | nginx `/api/` proxy |
|---|---|---|---|
| **Direct** (currently live) | `VITE_API_BASE_URL=https://heromaker-backend.up.railway.app` | the backend's public URL | unused; `/api/*` falls through to the SPA |
| Same-origin proxy | `VITE_API_BASE_URL` empty | `/api/*` on the frontend origin | proxies to `VITE_API_PROXY_TARGET` |

Direct mode depends on the backend's `ALLOWED_ORIGINS` containing the frontend
origin, or the browser blocks the calls on CORS. Verify with:

```bash
curl -sS -o /dev/null -D - -H 'Origin: https://heromaker.up.railway.app' \
  https://heromaker-backend.up.railway.app/api/creations/ | grep -i access-control-allow-origin
```

Either way, **set `VITE_API_PROXY_TARGET` on the frontend service** to
`http://backend.railway.internal:8000`. It costs nothing in direct mode and is
what keeps same-origin mode working. If it is missing, `start-nginx.sh` now
defaults to that on Railway and logs a warning — the bare `backend` hostname it
used to fall back to only resolves under docker-compose, and an unset value there
is what took `/api/*` down with 504s while the homepage kept returning 200.

Note also that the service worker caches API responses (`NetworkFirst` with an
`api-cache` fallback), so a returning visitor can keep seeing a working site
while new visitors get errors. Always confirm an outage in a private window.

## If you cannot reach the live URL

The host resolves publicly (`heromaker.up.railway.app`). If a request fails:

1. **Sandboxed / corporate network.** Many CI runners and AI-agent sandboxes only
   allow an egress allowlist. The symptom is a failure at the *proxy*, not at the
   app: `curl: (56) CONNECT tunnel failed, response 403`, while DNS still resolves.
   This is a network-policy denial, not an outage — confirm by trying any other
   public host (e.g. `example.com`). If those fail too, it is your network.
2. **Actually down.** DNS resolves and CONNECT succeeds, but you get a 5xx or a
   timeout. Check the Railway dashboard and the deploy workflow's last run.

Working entirely offline is supported: bring the stack up locally as above. The
pipeline steps that call OpenAI and Meshy will fail without outbound access and
valid API keys, but everything else — auth, gallery, creation view, 3D preview —
works against local SQLite and local files.

## Staging

| What | URL | Notes |
|------|-----|-------|
| **HeroMaker (staging app)** | **https://frontend-staging-7cb8.up.railway.app/** | Same four services as production, separate environment. Safe to break. |
| API (same host) | https://frontend-staging-7cb8.up.railway.app/api/creations/ | Same one-public-host arrangement as production. |

Railway project `hero-maker` (`95711b3f-db5c-4521-99a7-c5caeb8005fc`),
environment `staging` (`406e2fde-28f2-4f00-a254-cde5393db6db`). Service IDs:

| Service | ID |
|---------|-----|
| frontend | `a71bc2c6-c912-475c-ab16-a5dbf0ba074e` |
| backend | `3970a673-db5b-4b2d-9456-93acf1da09bf` |
| Postgres | `0697cae9-2052-48fb-95f6-d9d72a6ad018` |
| vrm-converter | `e7afe8a4-ce76-4093-9122-72c498b4874f` |

Deploy a working tree to it with the Railway CLI and a **project token** for the
staging environment:

```bash
RAILWAY_TOKEN=<staging project token> \
  railway up --service=<service id> --detach
```

Two things keep staging from touching production:

- **`S3_PREFIX=staging`** on the staging backend. Both environments share one
  Railway Storage bucket, so without a prefix staging would read and write
  production's objects (see `backend/app/utils/storage.py`).
- **`API_READ_ONLY=true`** on the staging frontend, which makes nginx refuse
  anything but `GET`/`HEAD`/`OPTIONS` on `/api/` (`frontend/nginx.conf`).
  Staging currently reads production's Postgres, so this is what stops a demo
  from deleting a real creation. Verified: `DELETE` -> 403, `GET` -> 200.

Removing the read-only guard requires giving staging its own database first -
see below.

## Refreshing staging with production data

```bash
RAILWAY_API_TOKEN=<workspace token> \
  .venv/bin/python scripts/clone_env_data.py --from production --to staging
```

Files (`--files-only`) copy from anywhere, because S3 is plain HTTPS. The
database half needs raw TCP to Railway's Postgres proxy on a non-443 port, so it
has to run from an unrestricted machine - not from CI or a sandboxed agent. See
the script's docstring for why the failure looks like a successful connection.

## Known gaps in this page

- Staging borrows **production's Postgres**. The clone script exists
  (`scripts/clone_env_data.py`) but its database half cannot run from a
  sandboxed agent - see above - so nobody has run it yet. Until someone does,
  `API_READ_ONLY=true` is the only thing protecting production data.
- Production deploys from `main` via GitHub Actions; staging is deployed by hand
  with `railway up`. There is no staging branch.
