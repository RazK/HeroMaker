# Task Configuration

## Overview

Tasks are defined by their input/output file patterns and dependencies. The file system is the source of truth - if a file exists, the task is complete.

## Task Definitions

```python
TASKS = [
    {
        "name": "image_capture",
        "input": None,  # No input (user action: webcam capture or file upload)
        "output": "original.jpg"
    },
    {
        "name": "image_processing", 
        "input": "original.jpg",
        "output": "processed.jpg",
        "depends_on": "image_capture"
    },
    {
        "name": "chatgpt_render",
        "input": "processed.jpg",
        "output": "rendered.png",
        "depends_on": "image_processing"
    },
    {
        "name": "meshy_3d",
        "input": "rendered.png",
        "output": "model.glb",
        "depends_on": "chatgpt_render"
    },
    {
        "name": "meshy_rig",
        "input": "model.glb",
        "output": "rigged.glb",
        "depends_on": "meshy_3d"
    },
    {
        "name": "convert_vrm",
        "input": "rigged.glb",
        "output": "avatar.vrm",
        "depends_on": "meshy_rig"
    },
    {
        "name": "complete",
        "input": "avatar.vrm",
        "output": None,  # No output, just marks completion
        "depends_on": "convert_vrm"
    }
]
```

## Task Execution Logic

1. **Check dependencies**
   - Verify input file exists (or depends_on task completed)
   - If dependency not met, wait or return error

2. **Execute task**
   - For file-based tasks: Process input file, create output file
   - For API tasks: Call external API, poll for completion, download result
   - See [INTEGRATIONS.md](./INTEGRATIONS.md) for external API details

3. **Save output file**
   - Save to: `assets/temp/{user_id}/{creation_id}/{output_file}`
   - File existence = task completed

4. **Update database**
   - Update `current_task` in creations table
   - Store task metadata (API task IDs, progress) in metadata JSONB

5. **Auto-trigger next task**
   - If dependencies are met, automatically start next task
   - Continue until all tasks complete or error occurs

## File System as Source of Truth

**Task Status Inference:**
- `pending` - Output file doesn't exist, task not in current_task
- `processing` - Output file doesn't exist, task is current_task
- `completed` - Output file exists
- `failed` - Error message set, output file doesn't exist

**Benefits:**
- No database synchronization needed
- Simple logic: if file exists, task is done
- Easy to debug: check file system directly
- Resilient: can recover from database issues by checking files

## Task Dependencies

Tasks form a dependency graph:
```
image_capture (original.jpg) → image_processing (processed.jpg) → chatgpt_render (rendered.png) → meshy_3d (model.glb) → meshy_rig (rigged.glb) → convert_vrm (avatar.vrm) → complete
```

**Dependency Resolution:**
- Tasks can only execute when their dependency is complete
- Dependency completion = input file exists
- Tasks execute sequentially based on dependencies

## Task Consolidation

**Flexibility:**
Tasks are defined by input/output files, not hardcoded. If Meshy API consolidates endpoints:

**Note:** The `meshy_3d` step already includes remeshing and texturing as part of Meshy's image-to-3D conversion, so separate remesh/texture steps are not needed.

**Impact:**
- Update `TASKS` configuration
- Update task names and file outputs
- Backend service layer handles API calls (easy to update)
- No database schema changes needed
- Frontend adapts to new task list automatically

## Related Documentation

- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) - How tasks are tracked in database
- [API_REFERENCE.md](../shared/API_REFERENCE.md) - Task execution endpoints
- [INTEGRATIONS.md](./INTEGRATIONS.md) - External API integration details
- [USER_JOURNEYS.md](../frontend/USER_JOURNEYS.md) - See tasks in action


