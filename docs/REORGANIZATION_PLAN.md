# Documentation Reorganization Plan

## Current Issues

1. **Flat structure** - All docs in root, hard to find what you need
2. **Redundant file** - `API_DATABASE_DESIGN.md` already split, should be archived
3. **No clear separation** - Backend and frontend docs mixed together
4. **No quick-start guides** - Developers need to read multiple files to get started

## Proposed Structure

```
docs/
├── README.md                    # Main index with navigation
├── backend/
│   ├── QUICKSTART.md            # NEW: Backend kickoff guide
│   ├── DATABASE_SCHEMA.md       # Moved from root
│   ├── API_REFERENCE.md         # Moved from root
│   ├── TASK_CONFIGURATION.md    # Moved from root
│   ├── IMPLEMENTATION_STEPS.md   # Moved from root
│   ├── INTEGRATIONS.md          # Moved from root
│   ├── CONFIGURATION.md         # Moved from root
│   └── ERROR_HANDLING.md        # Moved from root
├── frontend/
│   ├── QUICKSTART.md            # NEW: Frontend kickoff guide
│   ├── UI_DESIGN.md             # Renamed from FRONTEND_UI_DESIGN.md
│   └── USER_JOURNEYS.md         # Moved from root (frontend-focused)
└── shared/
    ├── ARCHITECTURE.md          # Moved from root (shared reference)
    └── legacy/
        └── API_DATABASE_DESIGN.md  # Moved from root/legacy
```

## Benefits

1. **Clear separation** - Backend and frontend docs in separate folders
2. **Quick-start guides** - Developers can start immediately
3. **Better navigation** - Logical grouping by role
4. **Shared docs** - Architecture and common concepts in shared/
5. **Cleaner root** - Only README.md in root

## Migration Steps

1. Create folder structure
2. Move files to appropriate folders
3. Update all internal links
4. Create QUICKSTART.md files
5. Update README.md with new structure
6. Move API_DATABASE_DESIGN.md to legacy

## File Moves

### Backend Folder
- `DATABASE_SCHEMA.md` → `backend/DATABASE_SCHEMA.md`
- `API_REFERENCE.md` → `backend/API_REFERENCE.md`
- `TASK_CONFIGURATION.md` → `backend/TASK_CONFIGURATION.md`
- `IMPLEMENTATION_STEPS.md` → `backend/IMPLEMENTATION_STEPS.md`
- `INTEGRATIONS.md` → `backend/INTEGRATIONS.md`
- `CONFIGURATION.md` → `backend/CONFIGURATION.md`
- `ERROR_HANDLING.md` → `backend/ERROR_HANDLING.md`

### Frontend Folder
- `FRONTEND_UI_DESIGN.md` → `frontend/UI_DESIGN.md` (renamed)
- `USER_JOURNEYS.md` → `frontend/USER_JOURNEYS.md`

### Shared Folder
- `ARCHITECTURE.md` → `shared/ARCHITECTURE.md`

### Legacy
- `API_DATABASE_DESIGN.md` → `shared/legacy/API_DATABASE_DESIGN.md`
- `legacy/API_DATABASE_DESIGN.md` → Remove (duplicate)

## New Files to Create

### backend/QUICKSTART.md
Quick-start guide for backend developers:
- Prerequisites
- Setup steps
- Essential reading order
- First endpoint to implement
- Testing checklist

### frontend/QUICKSTART.md
Quick-start guide for frontend developers:
- Prerequisites
- Setup steps
- Essential reading order
- First scene to implement
- API mocking setup

## Link Updates Required

All markdown files with internal links need updating:
- `./API_REFERENCE.md` → `../backend/API_REFERENCE.md` (from frontend)
- `./DATABASE_SCHEMA.md` → `../backend/DATABASE_SCHEMA.md`
- etc.

## Alternative: Keep Flat Structure

If folder nesting is too complex, alternative structure:

```
docs/
├── README.md
├── BACKEND_QUICKSTART.md      # NEW
├── FRONTEND_QUICKSTART.md     # NEW
├── ARCHITECTURE.md
├── DATABASE_SCHEMA.md
├── API_REFERENCE.md
├── TASK_CONFIGURATION.md
├── IMPLEMENTATION_STEPS.md
├── INTEGRATIONS.md
├── CONFIGURATION.md
├── ERROR_HANDLING.md
├── UI_DESIGN.md               # Renamed
├── USER_JOURNEYS.md
└── legacy/
    └── API_DATABASE_DESIGN.md
```

This keeps all links simple but less organized.
