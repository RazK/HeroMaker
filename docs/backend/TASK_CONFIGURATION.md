# Step Configuration

## Overview

Steps are defined by their input/output file patterns and dependencies. Step status is tracked in the `creation_steps` database table, not inferred from file existence.

## Step Definitions

```python
STEPS = [
    {
        "name": "image_processing", 
        "input": "original.jpg",
        "output": "processed.jpg",
        "estimated_duration": 1  # seconds
    },
    {
        "name": "chatgpt_render",
        "input": "processed.jpg",
        "output": "rendered.png",
        "depends_on": "image_processing",
        "estimated_duration": 54  # seconds
    },
    {
        "name": "meshy_3d",
        "input": "rendered.png",
        "output": "model.glb",
        "depends_on": "chatgpt_render",
        "estimated_duration": 309  # seconds
    },
    {
        "name": "meshy_rig",
        "input": "model.glb",
        "output": "rigged.glb",
        "depends_on": "meshy_3d",
        "estimated_duration": 43  # seconds
    },
    {
        "name": "convert_vrm",
        "input": "rigged.glb",
        "output": "avatar.vrm",
        "depends_on": "meshy_rig",
        "estimated_duration": 3  # seconds
    },
    {
        "name": "complete",
        "input": "avatar.vrm",
        "output": None,  # No output file
        "depends_on": "convert_vrm",
        "estimated_duration": 1  # seconds
    }
]
```

**Note:** The `original.jpg` file is saved when uploading via `POST /api/creations/upload`, before any steps run. There is no `image_capture` step.

## Step Execution Logic

1. **Check dependencies**
   - Verify input file exists (or depends_on step completed)
   - If dependency not met, return error

2. **Execute step**
   - For file-based steps: Process input file, create output file
   - For API steps: Call external API, poll for completion, download result
   - See [INTEGRATIONS.md](./INTEGRATIONS.md) for external API details

3. **Save output file**
   - Save to: `{FILES_ROOT}/{user_id}/{creation_id}/{output_file}` (e.g., `/app/data/files/{user_id}/{creation_id}/{output_file}`)

4. **Update database**
   - Update step status in `creation_steps` table: `pending` → `processing` → `completed` or `failed`
   - Store step metadata (API task IDs, progress) in `creation_steps.metadata`
   - Update `started_at`, `completed_at`, `estimated_progress`, `estimated_completion_time`

5. **Auto-trigger next step**
   - If dependencies are met, automatically start next step
   - Continue until all steps complete or error occurs

## Step Status Tracking

**Step status is stored in the `creation_steps` database table:**
- `pending` - Step has not started
- `processing` - Step is currently running
- `completed` - Step finished successfully (output file created)
- `failed` - Step failed (error_message set)

**Status is NOT inferred from file existence:**
- File existence does not determine status
- Status is explicitly set in the database
- Files may exist but step status may be different (e.g., if step was reset)

## Step Dependencies

Steps form a dependency chain:
```
image_processing (processed.jpg) 
  → chatgpt_render (rendered.png) 
  → meshy_3d (model.glb) 
  → meshy_rig (rigged.glb) 
  → convert_vrm (avatar.vrm) 
  → complete (no output)
```

**Dependency Resolution:**
- Steps can only execute when their dependency step is completed
- Dependency completion = dependency step has `status = 'completed'` in database
- Steps execute sequentially based on dependencies

## File Storage

**File Path Structure:**
- Base path: `/data/files/{user_id}/{creation_id}/`
- All step output files are stored in the same directory
- No distinction between "temp" and "permanent" - files stay in place

**File Naming:**
- Each step produces a specific output filename
- Files are named consistently: `original.jpg`, `processed.jpg`, `rendered.png`, `model.glb`, `rigged.glb`, `avatar.vrm`

## Step Consolidation

**Flexibility:**
Steps are defined by input/output files, not hardcoded. If Meshy API consolidates endpoints:

**Note:** The `meshy_3d` step already includes remeshing and texturing as part of Meshy's image-to-3D conversion, so separate remesh/texture steps are not needed.

**Impact:**
- Update `STEPS` configuration in `backend/app/config/steps.py`
- Update step names and file outputs
- Backend service layer handles API calls (easy to update)
- Database schema supports any step names (no migration needed)
- Frontend adapts to new step list automatically

## Related Documentation

- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) - How steps are tracked in database
- [API_REFERENCE.md](../shared/API_REFERENCE.md) - Step execution endpoints
- [INTEGRATIONS.md](./INTEGRATIONS.md) - External API integration details
