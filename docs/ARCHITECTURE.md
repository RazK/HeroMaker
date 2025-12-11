# HeroMaker Architecture Overview

This document provides the high-level system view that ties together the detailed references in the rest of the documentation set. Use it to understand how the product experience, backend services, storage model, and external integrations collaborate to turn a child's drawing into a downloadable VRM avatar.

## Product Experience at a Glance

HeroMaker exposes three primary states in the frontend experience (see `USER_JOURNEYS.md` for detailed steps):

1. **Browse** – Lists completed public characters (`GET /api/characters`) so users can explore the gallery.
2. **Create** – A guided workflow that starts a creation (`POST /api/creations`), walks the user through webcam capture, and then streams progress as backend tasks run.
3. **Show** – Presents an individual character with its VRM file, thumbnails, and task history once the pipeline finishes.

The frontend treats the backend as the single source of truth and polls for creation/task progress every ~2 seconds while a hero is being built.

## Component Architecture

| Component | Responsibilities | Tech / Interfaces | Notes |
|-----------|------------------|-------------------|-------|
| Frontend Web Client | Browse gallery, trigger creations, upload scans, display progress/VRM viewer | Any SPA framework (prototype uses Vite-based tooling). Communicates via REST over HTTPS. | Stateless; uses polling instead of websockets for simplicity. |
| Backend API Service | Implements REST endpoints under `/api`, orchestrates task execution, enforces auth/ownership rules | FastAPI + SQLAlchemy + Alembic (see `IMPLEMENTATION_STEPS.md`). Runs under Uvicorn/Gunicorn. | Keeps business logic in app modules (`api/`, `services/`, `config/`, `utils/`). |
| Task Engine | Encapsulated inside the API service (no separate worker). Executes sequential tasks defined in `TASK_CONFIGURATION.md`, spawns Meshy/ChatGPT jobs, and writes outputs to disk. | Python modules plus helper scripts in `research/scripts/`. | Task completion is inferred from filesystem state instead of a queue table. |
| Database | Stores users, creations, status, metadata, audit timestamps | PostgreSQL in production, SQLite for dev (`CONFIGURATION.md`). | Only two core tables (`users`, `creations`). File paths are not stored here. |
| File Storage | Holds all intermediate and final artifacts (`assets/temp` and `assets/permanent`) | Local POSIX filesystem in V2; can be swapped for S3-compatible storage later. | Directory structure encodes `user_id` and `creation_id`; moving temp → permanent marks completion. |
| External Services | ChatGPT for render + naming, Meshy for 3D pipeline, Blender VRM add-on for final conversion | HTTP APIs (OpenAI, Meshy) + local Blender CLI invoked by `convert_glb_to_vrm.py`. | API polling intervals and retries defined in `CONFIGURATION.md` & `INTEGRATIONS.md`. |

## Service Interactions

1. **Creation Kickoff**  
   `POST /api/creations` inserts a row in `creations`, seeds the task list, and allocates a filesystem workspace (`assets/temp/{user}/{creation}`).

2. **User-Driven Tasks**  
   `webcam_scan` accepts a processed frame upload. Everything afterwards is backend-driven: as soon as the required input file exists, the service fires the next task.

3. **Automated Task Chain**  
   Each task definition (`TASK_CONFIGURATION.md`) specifies its dependency and expected output filename. When the task finishes, the existence of that file becomes the single source of truth for “completed.”

4. **External API Jobs**  
   For ChatGPT and Meshy steps, the backend records provider task IDs in `creations.metadata`, polls on a configurable cadence, and writes progress percentages so the frontend can render sub-status bars (`USER_JOURNEYS.md` Journey 3).

5. **Completion & Publishing**  
   After `convert_vrm` succeeds, the `complete` task moves the entire directory tree to `assets/permanent`, nulls `current_task`, and marks the creation `status='completed'`. Gallery endpoints read directly from these permanent directories.

## Data Model & Storage Strategy

- **Relational Core** – Only durable metadata (users, creations, timestamps, status, task pointers, optional error messages) lives in Postgres/SQLite. See `DATABASE_SCHEMA.md` for exact DDL.
- **Filesystem Truth** – Output artifacts determine task status, keep storage cheap, and simplify recovery (“if the file exists, the task completed”). The backend wraps file operations in helper utilities outlined in `IMPLEMENTATION_STEPS.md` Step 3.
- **Path Convention** – Every path includes the `user_id` (or `debug` in development) and the immutable `creation_id`, e.g. `assets/temp/debug/{creation_id}/rendered.png`. VRM files explicitly use `{creation_id}.vrm` to stay stable even if a user renames the character.

## Error Handling & Resilience

- REST responses follow the structured format documented in `ERROR_HANDLING.md`.
- Transient Meshy/ChatGPT failures are automatically retried (3 attempts, exponential backoff). Persistent failures set `status='failed'` and capture context in `creations.error_message`.
- Users can manually retry a task via `POST /api/creations/{id}/tasks/{name}/retry`, which clears the error and restarts the pipeline from the failed step.
- Because task state is inferred from files, the system can survive API restarts without extra bookkeeping—on boot, it simply scans for the next missing output and resumes.

## Deployment & Environment Strategy

- **Development (V2)** – SQLite, debug auth (auto-assigned user), permissive CORS, local assets folder. Uvicorn runs hot-reload, and scripts in `research/scripts/` exercise external APIs with local `.env` secrets.
- **Production (V3+)** – PostgreSQL, OAuth-based auth (JWTs), locked-down CORS origins, proper secret storage, and rate limiting (see `CONFIGURATION.md`). File storage can stay on-disk initially but should migrate to shared storage for multi-instance hosting.
- **Background Processes** – No separate worker today; FastAPI process handles both HTTP requests and polling loops. Webhook support from Meshy would allow offloading polling and is a future enhancement.

## External Integrations Summary

- **ChatGPT Vision Models** – Turn cleaned scans into rendered images + suggested names. Requires uploading the `scanned.jpg` as base64 and polling thread runs (`INTEGRATIONS.md`).
- **Meshy API** – Handles the heavy 3D lift. We either use the consolidated `image-to-3d` flow (preferred) or the discrete steps (remesh, retexture, rig, animate). Task IDs chain together; progress is mirrored back into `creations.metadata`.
- **Blender VRM Pipeline** – `convert_glb_to_vrm.py` plus the Blender VRM add-on convert the final GLB into a VRM. Bone validation rules and known limitations are documented in `research/docs/findings_vrm_conversion.md`.

## Roadmap & Open Questions

- **Auth Hardening** – Move from the debug user to proper OAuth + JWT enforcement across endpoints.
- **Scaling Task Execution** – Introduce a worker queue (Celery, RQ, or managed alternative) so long-running Meshy conversions do not block API workers.
- **Webhook Adoption** – Replace Meshy polling with webhook receivers once keys are provisioned, reducing latency and cost.
- **Cloud Storage** – Migrate `assets/` to object storage for durability and CDN-backed downloads.
- **Rigging Quality Assurance** – Automate bone completeness checks prior to VRM conversion (see `research/docs/findings_vrm_conversion.md`) and feed failures back to users with actionable messaging.

For implementation details, cross-reference:

- [USER_JOURNEYS.md](./USER_JOURNEYS.md) for end-to-end flows
- [API_REFERENCE.md](./API_REFERENCE.md) for endpoint contracts
- [TASK_CONFIGURATION.md](./TASK_CONFIGURATION.md) for the exact task graph
- [CONFIGURATION.md](./CONFIGURATION.md) for environment and tuning parameters
- [INTEGRATIONS.md](./INTEGRATIONS.md) for external API call patterns
- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) for persistence details
