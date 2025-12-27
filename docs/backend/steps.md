# Step Configuration

## Overview

Steps are defined by their input/output file patterns and dependencies. Step status is tracked in the `creation_steps` database table, not inferred from file existence.

## Step Definitions

Step definitions are in `backend/app/config/steps.py`. The pipeline consists of 6 steps:

1. `image_processing` → `processed.jpg`
2. `openai_render` → `rendered.png`
3. `meshy_3d` → `model.glb`
4. `meshy_rig` → `rigged.glb`
5. `convert_vrm` → `avatar.vrm`
6. `complete` → (no output file)

**Note:** The `original.jpg` file is saved when uploading via `POST /api/creations/upload`, before any steps run.

## Step Execution Logic

1. **Check dependencies**
   - Verify input file exists (or depends_on step completed)
   - If dependency not met, return error

2. **Execute step**
   - For file-based steps: Process input file, create output file
   - For API steps: Call external API, poll for completion, download result
   - See [integrations.md](./integrations.md) for external API details

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
  → openai_render (rendered.png) 
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

- [Database Schema](./database.md) - How steps are tracked in database
- [API Reference](../api/reference.md) - Step execution endpoints
- [Integrations](./integrations.md) - External API integration details
