# HeroMaker Documentation

Welcome to the HeroMaker documentation. This directory contains all design and implementation documentation for the project.

## Quick Start

- **New to the project?** Start with [ARCHITECTURE.md](./ARCHITECTURE.md) for high-level overview
- **Backend Developer?** Read [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md), [API_REFERENCE.md](./API_REFERENCE.md), [TASK_CONFIGURATION.md](./TASK_CONFIGURATION.md)
- **Frontend Developer?** Read [API_REFERENCE.md](./API_REFERENCE.md), [USER_JOURNEYS.md](./USER_JOURNEYS.md)
- **Setting up?** Read [CONFIGURATION.md](./CONFIGURATION.md), [IMPLEMENTATION_STEPS.md](./IMPLEMENTATION_STEPS.md)

## Documentation Structure

### Core Design Documents

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - High-level system architecture, design decisions, and roadmap
- **[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)** - Database schema, tables, indexes, and design notes
- **[TASK_CONFIGURATION.md](./TASK_CONFIGURATION.md)** - Task definitions, file mappings, and execution logic
- **[API_REFERENCE.md](./API_REFERENCE.md)** - Complete API endpoint documentation with request/response examples

### Implementation Guides

- **[USER_JOURNEYS.md](./USER_JOURNEYS.md)** - Detailed user flows showing frontend-backend-database interactions
- **[IMPLEMENTATION_STEPS.md](./IMPLEMENTATION_STEPS.md)** - Step-by-step implementation guide with terminal commands

### Configuration & Operations

- **[CONFIGURATION.md](./CONFIGURATION.md)** - Environment variables, settings, CORS, rate limits
- **[ERROR_HANDLING.md](./ERROR_HANDLING.md)** - Error response format, error codes, retry strategies
- **[INTEGRATIONS.md](./INTEGRATIONS.md)** - External API integration details (ChatGPT, Meshy)

### Legacy/Reference

- **[API_DATABASE_DESIGN.md](./API_DATABASE_DESIGN.md)** - Comprehensive single document (kept for reference, see split docs above)

## For Backend Developers

**Essential Reading:**
1. [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) - Understand the data model
2. [API_REFERENCE.md](./API_REFERENCE.md) - Implement all endpoints
3. [TASK_CONFIGURATION.md](./TASK_CONFIGURATION.md) - Understand task execution
4. [CONFIGURATION.md](./CONFIGURATION.md) - Environment setup
5. [ERROR_HANDLING.md](./ERROR_HANDLING.md) - Error handling patterns
6. [INTEGRATIONS.md](./INTEGRATIONS.md) - External API integration

**Reference:**
- [USER_JOURNEYS.md](./USER_JOURNEYS.md) - See how frontend will use your APIs
- [IMPLEMENTATION_STEPS.md](./IMPLEMENTATION_STEPS.md) - Step-by-step implementation

## For Frontend Developers

**Essential Reading:**
1. [API_REFERENCE.md](./API_REFERENCE.md) - All available endpoints
2. [USER_JOURNEYS.md](./USER_JOURNEYS.md) - User flows and interactions
3. [CONFIGURATION.md](./CONFIGURATION.md) - API base URL, CORS settings
4. [ERROR_HANDLING.md](./ERROR_HANDLING.md) - Error handling patterns

**Reference:**
- [TASK_CONFIGURATION.md](./TASK_CONFIGURATION.md) - Understand task structure
- [ARCHITECTURE.md](./ARCHITECTURE.md) - High-level system understanding

## Documentation Principles

- **File system as source of truth** - Task status inferred from file existence
- **Flat task structure** - Backend returns tasks as flat list, frontend handles grouping
- **User ID in paths** - All file paths include user_id for organization and security
- **Creation ID for files** - VRM files use creation_id, not character_name, to avoid file system issues

## Questions?

If you find gaps in the documentation or need clarification, please update the relevant doc or create an issue.
