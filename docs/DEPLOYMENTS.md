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

## Known gaps in this page

- The Railway **project/service IDs** are not recorded here (they live in the
  GitHub Actions secrets and the Railway dashboard).
- There is no staging environment; `main` deploys straight to production.
