# Database Schema

## Overview

HeroMaker uses a relational database design with three main tables: `users`, `creations`, and `creation_steps`. Step status is tracked in the database, not inferred from file existence.

## Tables

Database schema is defined in `backend/app/models.py` using SQLAlchemy. Main tables:

- **users** - User accounts (id, email, username, etc.)
- **creations** - Creation records (id, user_id, character_name, metadata, etc.)
- **creation_steps** - Step execution tracking (id, creation_id, step_name, status, timestamps, etc.)

**Note:** The `creations` table does NOT have `status`, `current_step`, `completed_at`, or `error_message` columns. These are computed properties:
- `status` - Calculated from `creation_steps` statuses
- `current_step` - First processing step, or first pending step
- `completed_at` - From last step's `completed_at` when all steps completed
- `error_message` - From first failed step's `error_message`

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
  - `creation_steps.metadata` - Step-specific data: Meshy task IDs, OpenAI thread IDs, etc.

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
- `openai_render` → `rendered.png` (input: `processed.jpg`)
- `meshy_3d` → `model.glb` (input: `rendered.png`)
- `meshy_rig` → `rigged.glb` (input: `model.glb`)
- `convert_vrm` → `avatar.vrm` (input: `rigged.glb`)
- `complete` → No output file (marks creation as complete)

**Note:** The `original.jpg` file is saved when uploading via `POST /api/creations/upload`, before any steps run.

## File Structure

Files stored in `/data/files/{user_id}/{creation_id}/` directory structure. See [Step Configuration](./steps.md) for file naming conventions.

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

- [Step Configuration](./steps.md) - Step definitions and file mappings
- [API Reference](../api/reference.md) - Interactive Swagger docs
