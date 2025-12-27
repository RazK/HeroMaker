# HeroMaker Architecture Overview

This document provides the high-level system view that ties together the detailed references in the rest of the documentation set. Use it to understand how the product experience, backend services, storage model, and external integrations collaborate to turn a child's drawing into a downloadable VRM avatar.

## Product Experience at a Glance

HeroMaker exposes three primary states in the frontend experience (see `USER_JOURNEYS.md` for detailed steps):

1. **Create** – A guided workflow that starts by uploading an image (`POST /api/creations/upload`), which creates the creation and then streams progress as backend steps run.
2. **Show** – Presents an individual character with its VRM file, thumbnails, and step history once the pipeline finishes.

The frontend treats the backend as the single source of truth and polls for creation/step progress every ~2 seconds while a hero is being built.

## Component Architecture

| Component | Responsibilities | Tech / Interfaces | Notes |
|-----------|------------------|-------------------|-------|
| Frontend Web Client | Browse gallery, trigger creations, upload scans, display progress/VRM viewer | Any SPA framework (prototype uses Vite-based tooling). Communicates via REST over HTTPS. | Stateless; uses polling instead of websockets for simplicity. |
| Backend API Service | Implements REST endpoints under `/api`, orchestrates step execution, enforces auth/ownership rules | FastAPI + SQLAlchemy + Alembic (see `IMPLEMENTATION.md`). Runs under Uvicorn/Gunicorn. | Keeps business logic in app modules (`api/`, `services/`, `config/`, `utils/`). |
| Pipeline Engine | Encapsulated inside the API service (no separate worker). Executes sequential steps defined in `TASK_CONFIGURATION.md`, spawns Meshy/ChatGPT jobs, and writes outputs to disk. | Python modules plus helper scripts in `research/scripts/`. | Step status is tracked in database with timestamps and progress. |
| Database | Stores users, creations, creation_steps with status, metadata, audit timestamps | PostgreSQL in production, SQLite for dev (`SETUP.md`). | Core tables: `users`, `creations`, `creation_steps`. File paths are not stored here. |
| File Storage | Holds all intermediate and final artifacts (`/data/files/{user_id}/{creation_id}/`) | Local POSIX filesystem in V2; can be swapped for S3-compatible storage later. | Directory structure encodes `user_id` and `creation_id`; files are stored directly in creation directory. |
| External Services | ChatGPT for render + naming, Meshy for 3D pipeline, Blender VRM add-on for final conversion | HTTP APIs (OpenAI, Meshy) + local Blender CLI invoked by `convert_glb_to_vrm.py`. | API polling intervals and retries defined in `SETUP.md` & `INTEGRATIONS.md`. |

## Service Interactions

1. **Creation Kickoff**  
   `POST /api/creations/upload` accepts an image file upload, creates a row in `creations`, initializes all steps as "pending", and allocates a filesystem workspace (`/data/files/{user_id}/{creation_id}/`).

2. **Pipeline Execution**  
   User triggers pipeline via `POST /api/creations/{id}/run` or individual steps via `POST /api/creations/{id}/steps/{step_name}/run`. Steps execute sequentially, with dependencies validated automatically.

3. **Automated Step Chain**  
   Each step definition (`TASK_CONFIGURATION.md`) specifies its dependency and expected output filename. Step status is tracked in the database with timestamps and progress percentages.

4. **External API Jobs**  
   For ChatGPT and Meshy steps, the backend records provider task IDs in `creations.metadata`, polls on a configurable cadence, and updates step progress percentages so the frontend can render progress bars.

5. **Completion**  
   After `convert_vrm` succeeds, the `complete` step sets `current_step` to null and marks the creation `status='completed'`. All files remain in the creation directory.

## Data Model & Storage Strategy

- **Relational Core** – Durable metadata (users, creations, creation_steps with timestamps, status, progress, optional error messages) lives in Postgres/SQLite. See `DATABASE_SCHEMA.md` for exact DDL.
- **Filesystem Storage** – Output artifacts are stored in organized directory structure. Step status is tracked in database, not inferred from files. The backend wraps file operations in helper utilities outlined in `IMPLEMENTATION.md`.
- **Path Convention** – Every path includes the `user_id` (or `debug-user-uuid` in development) and the immutable `creation_id`, e.g. `/data/files/{user_id}/{creation_id}/rendered.png`. VRM files are named `avatar.vrm` in each creation directory.

## Error Handling & Resilience

- REST responses follow the structured format documented in `SETUP.md`.
- Transient Meshy/ChatGPT failures are automatically retried (3 attempts, exponential backoff). Persistent failures set step `status='failed'` and capture context in `creation_steps.error_message`.
- Users can manually retry a step by calling `POST /api/creations/{id}/steps/{step_name}/run`, which resets the step and re-executes it.
- Step state is stored in database, allowing the system to resume from the last incomplete step after restarts.

## Deployment & Environment Strategy

- **Development (V2)** – SQLite, debug auth (auto-assigned user), permissive CORS, local `/data` folder. Uvicorn runs hot-reload, and scripts in `research/scripts/` exercise external APIs with local `.env` secrets.
- **Production (V3+)** – PostgreSQL, OAuth-based auth (JWTs), locked-down CORS origins, proper secret storage, and rate limiting (see `SETUP.md`). File storage can stay on-disk initially but should migrate to shared storage for multi-instance hosting.
- **Background Processes** – No separate worker today; FastAPI process handles both HTTP requests and polling loops. Webhook support from Meshy would allow offloading polling and is a future enhancement.

## External Integrations Summary

- **ChatGPT Vision Models** – Turn cleaned scans into rendered images + suggested names. Requires uploading the `scanned.jpg` as base64 and polling thread runs (`INTEGRATIONS.md`).
- **Meshy API** – Handles the heavy 3D lift. We either use the consolidated `image-to-3d` flow (preferred) or the discrete steps (remesh, retexture, rig, animate). Task IDs chain together; progress is mirrored back into `creations.metadata`.
- **Blender VRM Pipeline** – `convert_glb_to_vrm.py` plus the Blender VRM add-on convert the final GLB into a VRM. Bone validation rules and known limitations are documented in `research/docs/findings_vrm_conversion.md`.

## Roadmap & Open Questions

- **Auth Hardening** – Move from the debug user to proper OAuth + JWT enforcement across endpoints.
- **Scaling Step Execution** – Introduce a worker queue (Celery, RQ, or managed alternative) so long-running Meshy conversions do not block API workers.
- **Webhook Adoption** – Replace Meshy polling with webhook receivers once keys are provisioned, reducing latency and cost.
- **Cloud Storage** – Migrate `assets/` to object storage for durability and CDN-backed downloads.
- **Rigging Quality Assurance** – Automate bone completeness checks prior to VRM conversion (see `research/docs/findings_vrm_conversion.md`) and feed failures back to users with actionable messaging.

For implementation details, cross-reference:

- [API_REFERENCE.md](./API_REFERENCE.md) for endpoint contracts
- [TASK_CONFIGURATION.md](../backend/TASK_CONFIGURATION.md) for the exact step definitions (note: uses "steps" not "tasks")
- [SETUP.md](../backend/SETUP.md) for environment and tuning parameters
- [INTEGRATIONS.md](../backend/INTEGRATIONS.md) for external API call patterns
- [DATABASE_SCHEMA.md](../backend/DATABASE_SCHEMA.md) for persistence details
