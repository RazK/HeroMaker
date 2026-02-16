# HeroMaker Accounts & Services

All external accounts in one place. **Never commit actual API keys here** — keys live in `.env` (gitignored) or Railway dashboard.

---

## OpenAI
- **Email**: raz@blinkaid.com
- **Dashboard**: https://platform.openai.com
- **Used for**: Image generation (GPT-Image-1)
- **Models**: `gpt-image-1` (primary), `gpt-image-1-mini` (fallback)
- **Env vars**: `OPENAI_API_KEY` (AI calls), `OPENAI_ADMIN_KEY` (balance check only)
- **Key stored in**: `.env` (local), Railway backend env vars (prod)
- **Balance**: No API for remaining credits — check https://platform.openai.com/settings/organization/billing/credit-grants

## Meshy
- **Email**: raz@blinkaid.com (1895 credits) ← active account used by HeroMaker
- **Email**: raz@yosigal.com (100 credits) ← separate account, not connected
- **Dashboard**: https://app.meshy.ai
- **Used for**: 3D model generation from images (GLB output)
- **Env var**: `MESHY_API_KEY` (belongs to raz@blinkaid.com)
- **Key stored in**: `.env` (local), Railway backend env vars (prod)

## Railway
- **Email**: Raz@yosigal.com
- **Dashboard**: https://railway.app
- **Used for**: Production hosting
- **Plan**: HOBBY
- **Services**:
  - `backend` — FastAPI
  - `frontend` — nginx
  - `vrm-converter` — Blender
  - `Postgres` — managed PostgreSQL
  - `heromaker-files-*` — S3-compatible storage bucket
- **S3 env vars**: `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`
- **DB env var**: `DATABASE_URL` (via Railway variable reference `${{Postgres.DATABASE_URL}}`)
- **PAT env var**: `RAILWAY_API_TOKEN` (Personal Access Token for balance check)

## GitHub
- **Email**: Raz@yosigal.com
- **Username**: RazK
- **Repo**: https://github.com/razkarl/HeroMaker
- **Used for**: Source code, GitHub Actions CI/CD, GHCR container registry
- **GHCR images**:
  - `ghcr.io/razkarl/heromaker/backend:latest`
  - `ghcr.io/razkarl/heromaker/frontend:latest`
  - `ghcr.io/razkarl/heromaker/vrm-converter:latest`

---

## Where Keys Live

| Key | Local | Production |
|---|---|---|
| `OPENAI_API_KEY` | `.env` | Railway backend env vars |
| `OPENAI_ADMIN_KEY` | `.env` | not needed in prod |
| `MESHY_API_KEY` | `.env` | Railway backend env vars |
| `JWT_SECRET_KEY` | `.env` | Railway backend env vars |
| `RAILWAY_API_TOKEN` | `.env` | not needed in prod |
| `S3_ACCESS_KEY_ID` | `.env` (commented out) | Railway backend env vars |
| `S3_SECRET_ACCESS_KEY` | `.env` (commented out) | Railway backend env vars |
| `DATABASE_URL` | `.env` (SQLite path) | Railway backend env vars (PostgreSQL) |

> `.env` is gitignored. See `.env.example` for variable names without values.
