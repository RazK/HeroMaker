# Database Schema

## Overview

HeroMaker uses a relational database design with three main tables: `users`, `creations`, and `creation_steps`. Step status is tracked in the database, not inferred from file existence.

## Tables

### Users Table

```sql
CREATE TABLE users (
    id VARCHAR PRIMARY KEY,
    email VARCHAR(255) UNIQUE,
    google_id VARCHAR(255) UNIQUE,
    username VARCHAR(255),
    password_hash VARCHAR(255),  -- For future non-OAuth auth
    is_admin BOOLEAN DEFAULT false,
    subscription_tier VARCHAR(50) DEFAULT 'free',  -- free, pro, enterprise
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_google_id ON users(google_id);
```

### Creations Table

```sql
CREATE TABLE creations (
    id VARCHAR PRIMARY KEY,
    user_id VARCHAR REFERENCES users(id),
    character_name VARCHAR(255),
    name VARCHAR(255),  -- Person's name (for original image)
    age INTEGER,  -- Person's age (for original image)
    is_public BOOLEAN DEFAULT true,
    metadata JSON,  -- Store any extra data (API task IDs, etc.)
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_creations_user_id ON creations(user_id);
CREATE INDEX idx_creations_created_at ON creations(created_at DESC);
```

**Note:** The `creations` table does NOT have `status`, `current_task`, `completed_at`, or `error_message` columns. These are computed properties:
- `status` - Calculated from `creation_steps` statuses
- `current_step` - First processing step, or first pending step
- `completed_at` - From last step's `completed_at` when all steps completed
- `error_message` - From first failed step's `error_message`

### Creation Steps Table

```sql
CREATE TABLE creation_steps (
    id VARCHAR PRIMARY KEY,
    creation_id VARCHAR REFERENCES creations(id) ON DELETE CASCADE,
    step_name VARCHAR(100) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',  -- pending, processing, completed, failed
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    estimated_duration INTEGER,  -- seconds
    estimated_progress INTEGER,  -- 0-100, nullable
    estimated_completion_time TIMESTAMP,  -- Calculated completion time
    error_message TEXT,
    metadata JSON,  -- Step-specific metadata (e.g., API task IDs)
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_creation_steps_creation_id ON creation_steps(creation_id);
CREATE INDEX idx_creation_steps_step_name ON creation_steps(step_name);
CREATE INDEX idx_creation_steps_status ON creation_steps(status);
```

## Design Notes

- **Step status is stored in database**
  - Each step has its own row in `creation_steps` table
  - Status is explicitly tracked: `pending`, `processing`, `completed`, `failed`
  - File existence is NOT used to infer status (files may exist but step status may be different)

- **Creation status is computed from steps**
  - `pending` - All steps are pending
  - `processing` - At least one step is processing
  - `completed` - All steps are completed
  - `failed` - At least one step failed

- **Metadata fields (JSON)**
  - `creations.metadata` - Stores flexible data: API task IDs, progress percentages, generated names
  - `creation_steps.metadata` - Step-specific data: Meshy task IDs, ChatGPT thread IDs, etc.

## File System Structure

```
/data/
  files/
    {user_id}/
      {creation_id}/
        original.jpg
        processed.jpg
        rendered.png
        model.glb
        rigged.glb
        avatar.vrm
  db/
    heromaker.db
```

**Note:** Files are stored directly in the creation directory. There is no `temp` vs `permanent` distinction - files stay in the same location throughout the pipeline.

## File Naming Convention

Each step produces a specific output file:

**Step to File Mapping:**
- `image_processing` → `processed.jpg` (input: `original.jpg`)
- `chatgpt_render` → `rendered.png` (input: `processed.jpg`)
- `meshy_3d` → `model.glb` (input: `rendered.png`)
- `meshy_rig` → `rigged.glb` (input: `model.glb`)
- `convert_vrm` → `avatar.vrm` (input: `rigged.glb`)
- `complete` → No output file (marks creation as complete)

**Note:** The `original.jpg` file is saved when uploading via `POST /api/creations/upload`, before any steps run.

## User ID in Paths

- All file paths include `user_id` for organization and security
- For V2 debug mode: uses `user_id = "debug-user-uuid"`
- Path structure: `/data/files/{user_id}/{creation_id}/`

**Benefits:**
- Better organization
- Easy to find all files for a user
- Easy to delete user data
- Better security (path includes user_id)
- Scales better (not all files in one directory)

## File Naming Decisions

**VRM files are named `avatar.vrm` in each creation directory**

**Rationale:**
- Prevents file system issues if character name changes
- Creation ID is immutable, character name can change
- All file operations reference creation_id, not character_name
- Avoids bugs from file system operations assuming name is correct

## Status Field Values

**Creation Status (computed):**
- `pending` - All steps are pending
- `processing` - At least one step is processing
- `completed` - All steps are completed
- `failed` - At least one step failed

**Step Status (stored in database):**
- `pending` - Step has not started
- `processing` - Step is currently running
- `completed` - Step finished successfully
- `failed` - Step failed (check `error_message`)

## Query Patterns

**Common Queries:**

```sql
-- Get user's active creations
SELECT * FROM creations 
WHERE user_id = ? 
AND id IN (
    SELECT DISTINCT creation_id FROM creation_steps 
    WHERE status IN ('pending', 'processing')
);

-- Get completed public characters for gallery
SELECT * FROM creations 
WHERE is_public = true 
AND id IN (
    SELECT creation_id FROM creation_steps 
    GROUP BY creation_id 
    HAVING COUNT(*) = SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)
)
ORDER BY created_at DESC;

-- Get creation with all steps
SELECT c.*, cs.* 
FROM creations c
LEFT JOIN creation_steps cs ON c.id = cs.creation_id
WHERE c.id = ?;

-- Get steps by status
SELECT * FROM creation_steps 
WHERE status = ?;
```

## Related Documentation

- [TASK_CONFIGURATION.md](./TASK_CONFIGURATION.md) - Step definitions and file mappings
- [API_REFERENCE.md](../shared/API_REFERENCE.md) - API endpoints that query this schema
- [IMPLEMENTATION.md](./IMPLEMENTATION.md) - How the database is used in practice
