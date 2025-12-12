# HeroMaker Documentation

Welcome to the HeroMaker documentation. This directory contains all design and implementation documentation organized by role for easy navigation.

## Quick Start

- **New to the project?** Start with [shared/ARCHITECTURE.md](./shared/ARCHITECTURE.md) for high-level overview
- **Backend Developer?** Start with [backend/IMPLEMENTATION.md](./backend/IMPLEMENTATION.md)
- **Frontend Developer?** Start with [frontend/IMPLEMENTATION.md](./frontend/IMPLEMENTATION.md)

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

All frontend development documentation:

- **[IMPLEMENTATION.md](./frontend/IMPLEMENTATION.md)** - ⭐ **Start here** - Complete frontend implementation guide (setup + 3D UI design)
- **[USER_JOURNEYS.md](./frontend/USER_JOURNEYS.md)** - Detailed user flows showing frontend-backend-database interactions

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
2. [TASK_CONFIGURATION.md](./backend/TASK_CONFIGURATION.md) - Understand task execution
3. [API_REFERENCE.md](./shared/API_REFERENCE.md) - Implement all endpoints
4. [IMPLEMENTATION.md](./backend/IMPLEMENTATION.md) - Follow step-by-step implementation

**Reference:**
- [SETUP.md](./backend/SETUP.md) - Environment setup and error handling
- [INTEGRATIONS.md](./backend/INTEGRATIONS.md) - External API integration
- [USER_JOURNEYS.md](./frontend/USER_JOURNEYS.md) - See how frontend uses your APIs
- [ARCHITECTURE.md](./shared/ARCHITECTURE.md) - High-level system overview

---

## For Frontend Developers

**Start Here:**
1. **[IMPLEMENTATION.md](./frontend/IMPLEMENTATION.md)** - Get set up and follow 3D UI implementation guide

**Essential Reading (in order):**
1. [IMPLEMENTATION.md](./frontend/IMPLEMENTATION.md) - Complete 3D UI design and implementation guide
2. [API_REFERENCE.md](./shared/API_REFERENCE.md) - All available endpoints
3. [USER_JOURNEYS.md](./frontend/USER_JOURNEYS.md) - User flows and interactions

**Reference:**
- [TASK_CONFIGURATION.md](./backend/TASK_CONFIGURATION.md) - Understand task structure
- [SETUP.md](./backend/SETUP.md) - Error handling patterns
- [ARCHITECTURE.md](./shared/ARCHITECTURE.md) - High-level system understanding

---

## Documentation Principles

- **File system as source of truth** - Task status inferred from file existence
- **Flat task structure** - Backend returns tasks as flat list, frontend handles grouping
- **User ID in paths** - All file paths include user_id for organization and security
- **Creation ID for files** - VRM files use creation_id, not character_name, to avoid file system issues

---

## Questions?

If you find gaps in the documentation or need clarification, please update the relevant doc or create an issue.
