# HeroMaker Documentation

Welcome to the HeroMaker documentation. This directory contains all design and implementation documentation organized by role for easy navigation.

## Quick Start

- **New to the project?** Start with [shared/ARCHITECTURE.md](./shared/ARCHITECTURE.md) for high-level overview
- **Backend Developer?** Start with [backend/IMPLEMENTATION.md](./backend/IMPLEMENTATION.md)
- **Frontend Developer?** Frontend is being rebuilt - see [API_REFERENCE.md](./shared/API_REFERENCE.md) for API contract

---

## Documentation Structure

### Backend Documentation (`backend/`)

All backend development documentation:

- **[IMPLEMENTATION.md](./backend/IMPLEMENTATION.md)** - ⭐ **Start here** - Complete backend implementation guide (setup + step-by-step)
- **[DATABASE_SCHEMA.md](./backend/DATABASE_SCHEMA.md)** - Database schema, tables, indexes, and design notes
- **[TASK_CONFIGURATION.md](./backend/TASK_CONFIGURATION.md)** - Task definitions, file mappings, and execution logic
- **[SETUP.md](./backend/SETUP.md)** - Environment variables, error handling, and operational configuration
- **[INTEGRATIONS.md](./backend/INTEGRATIONS.md)** - External API integration details (ChatGPT, Meshy)

### Frontend Documentation (`frontend/`)

**Note:** Frontend is currently being rebuilt. Previous frontend documentation may be outdated.

- **[IMPLEMENTATION.md](./frontend/IMPLEMENTATION.md)** - Previous frontend implementation guide (may be outdated)
- **[USER_JOURNEYS.md](./frontend/USER_JOURNEYS.md)** - Previous user flows (may be outdated)

### Shared Documentation (`shared/`)

Documentation relevant to both backend and frontend:

- **[API_REFERENCE.md](./shared/API_REFERENCE.md)** - ⭐ **API Contract** - Complete API endpoint documentation (used by both frontend and backend)
- **[ARCHITECTURE.md](./shared/ARCHITECTURE.md)** - High-level system architecture, design decisions, and roadmap
- **[legacy/API_DATABASE_DESIGN.md](./shared/legacy/API_DATABASE_DESIGN.md)** - Original comprehensive document (archived, see split docs for current)

---

## For Backend Developers

**Start Here:**
1. **[IMPLEMENTATION.md](./backend/IMPLEMENTATION.md)** - Get set up and follow step-by-step implementation

**Essential Reading (in order):**
1. [DATABASE_SCHEMA.md](./backend/DATABASE_SCHEMA.md) - Understand the data model
2. [TASK_CONFIGURATION.md](./backend/TASK_CONFIGURATION.md) - Understand step execution (note: uses "steps" not "tasks")
3. [API_REFERENCE.md](./shared/API_REFERENCE.md) - All available endpoints
4. [IMPLEMENTATION.md](./backend/IMPLEMENTATION.md) - Follow step-by-step implementation

**Reference:**
- [SETUP.md](./backend/SETUP.md) - Environment setup and error handling
- [INTEGRATIONS.md](./backend/INTEGRATIONS.md) - External API integration
- [USER_JOURNEYS.md](./frontend/USER_JOURNEYS.md) - See how frontend uses your APIs
- [ARCHITECTURE.md](./shared/ARCHITECTURE.md) - High-level system overview

---

## For Frontend Developers

**Note:** Frontend is currently being rebuilt. Use the API reference to build the new frontend.

**Essential Reading:**
1. [API_REFERENCE.md](./shared/API_REFERENCE.md) - Complete API endpoint documentation
2. [ARCHITECTURE.md](./shared/ARCHITECTURE.md) - High-level system understanding

**Reference:**
- [TASK_CONFIGURATION.md](./backend/TASK_CONFIGURATION.md) - Understand step structure (note: uses "steps" not "tasks")
- [SETUP.md](./backend/SETUP.md) - Error handling patterns
- [DATABASE_SCHEMA.md](./backend/DATABASE_SCHEMA.md) - Data model understanding

---

## Documentation Principles

- **Step-based pipeline** - Backend uses "steps" not "tasks" (e.g., `image_processing`, `chatgpt_render`, `meshy_3d`)
- **Step status tracking** - Step status stored in database with timestamps and progress tracking
- **User ID in paths** - All file paths include user_id for organization and security
- **Creation ID for files** - VRM files use creation_id, not character_name, to avoid file system issues

---

## Questions?

If you find gaps in the documentation or need clarification, please update the relevant doc or create an issue.
