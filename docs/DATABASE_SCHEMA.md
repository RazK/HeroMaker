# Database Schema

## Overview

HeroMaker uses a simplified database design with two main tables: `users` and `creations`. The file system serves as the source of truth for task completion status.

## Tables

### Users Table

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    character_name VARCHAR(255),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL,  -- pending, processing, completed, failed, cancelled
    current_task VARCHAR(100),  -- NULL if completed or no current step
    is_public BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP,  -- Set when status = completed
    error_message TEXT,
    metadata JSONB  -- Store any extra data (generated name, API task IDs, etc.)
);

CREATE INDEX idx_creations_status ON creations(status);
CREATE INDEX idx_creations_user_id ON creations(user_id);
CREATE INDEX idx_creations_public_completed ON creations(is_public, status) WHERE status = 'completed';
CREATE INDEX idx_creations_created_at ON creations(created_at DESC);
```

## Design Notes

- **Creations table tracks both in-progress creations and completed characters**
  - Status field determines state: "processing" = active creation, "completed" = finished character
  - Single table eliminates need for separate jobs/characters tables

- **File system is source of truth for task completion status**
  - Task status inferred from file existence in file system
  - No separate transformations/steps table needed
  - Simple logic: if file exists, task is done

- **Metadata field (JSONB)**
  - Stores flexible data: API task IDs, progress percentages, generated names
  - Allows querying without schema changes
  - Example: `{"meshy_task_id": "task_123", "progress_percentage": 65, "generated_name": "Super Hero"}`

## File System Structure

```
assets/
  temp/
    {user_id}/
      {creation_id}/
        scan.jpg
        scanned.jpg
        rendered.png
        model.glb
        remeshed.glb
        textured.glb
        rigged.glb
        animated.glb
        selected.glb
        {creation_id}.vrm
  permanent/
    {user_id}/
      {creation_id}/
        (same files, moved here on completion)
```

## File Naming Convention

Each task produces a specific output file. File existence indicates task completion.

**Task to File Mapping:**
- `webcam_scan` → `scan.jpg`
- `image_processing` → `scanned.jpg`
- `chatgpt_render` → `rendered.png`
- `meshy_3d` → `model.glb`
- `meshy_remesh` → `remeshed.glb`
- `meshy_texture` → `textured.glb`
- `meshy_rig` → `rigged.glb`
- `meshy_animate` → `animated.glb`
- `select_glb` → `selected.glb` (or reference animated.glb)
- `convert_vrm` → `{creation_id}.vrm` (uses creation ID, not character name, to avoid file system issues)

## User ID in Paths

- All file paths include user_id for organization and security
- For V2 debug mode: use `user_id = "debug"` when user_id is NULL
- Path structure: `assets/{temp|permanent}/{user_id}/{creation_id}/`

**Benefits:**
- Better organization
- Easy to find all files for a user
- Easy to delete user data
- Better security (path includes user_id)
- Scales better (not all files in one directory)

## File Naming Decisions

**VRM files use `{creation_id}.vrm`, not `{character_name}.vrm`**

**Rationale:**
- Prevents file system issues if character name changes
- Creation ID is immutable, character name can change
- All file operations reference creation_id, not character_name
- Avoids bugs from file system operations assuming name is correct

## Status Field Values

**Creation Status:**
- `pending` - Created but not started
- `processing` - Active creation, tasks running
- `completed` - All tasks done, character ready
- `failed` - Task failed, can retry
- `cancelled` - User cancelled creation

**Task Status (inferred from files):**
- `pending` - Task not started (file doesn't exist)
- `processing` - Task running (current_task matches, file doesn't exist yet)
- `completed` - Task done (file exists)
- `failed` - Task failed (error_message set, file doesn't exist)

## Query Patterns

**Common Queries:**

```sql
-- Get user's active creations
SELECT * FROM creations 
WHERE user_id = ? AND status = 'processing';

-- Get completed public characters for gallery
SELECT * FROM creations 
WHERE status = 'completed' AND is_public = true 
ORDER BY created_at DESC;

-- Get creation with current task
SELECT * FROM creations 
WHERE id = ? AND current_task = ?;

-- Get creations by status
SELECT * FROM creations 
WHERE status = ?;
```

## Related Documentation

- [TASK_CONFIGURATION.md](./TASK_CONFIGURATION.md) - Task definitions and file mappings
- [API_REFERENCE.md](./API_REFERENCE.md) - API endpoints that query this schema
- [USER_JOURNEYS.md](./USER_JOURNEYS.md) - See how database is used in practice
