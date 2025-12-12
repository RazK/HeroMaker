# Task Configuration

## Overview

Tasks are defined by their input/output file patterns and dependencies. The file system is the source of truth - if a file exists, the task is complete.

## Task Definitions

```python
TASKS = [
    {
        "name": "image_capture",
        "input": None,  # No input (user action: webcam capture or file upload)
        "output": "scan.jpg"
    },
    {
        "name": "image_processing", 
        "input": "scan.jpg",
        "output": "scanned.jpg",
        "depends_on": "image_capture"
    },
    {
        "name": "chatgpt_render",
        "input": "scanned.jpg",
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
        "name": "meshy_remesh",
        "input": "model.glb",
        "output": "remeshed.glb",
        "depends_on": "meshy_3d"
    },
    {
        "name": "meshy_texture",
        "input": "remeshed.glb",
        "output": "textured.glb",
        "depends_on": "meshy_remesh"
    },
    {
        "name": "meshy_rig",
        "input": "textured.glb",
        "output": "rigged.glb",
        "depends_on": "meshy_texture"
    },
    {
        "name": "meshy_animate",
        "input": "rigged.glb",
        "output": "animated.glb",
        "depends_on": "meshy_rig"
    },
    {
        "name": "select_glb",
        "input": "animated.glb",
        "output": "selected.glb",
        "depends_on": "meshy_animate"
    },
    {
        "name": "convert_vrm",
        "input": "selected.glb",
        "output": "{creation_id}.vrm",  # Use creation_id, not character_name
        "depends_on": "select_glb"
    },
    {
        "name": "complete",
        "input": "{creation_id}.vrm",
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
image_capture → image_processing → chatgpt_render → meshy_3d → meshy_remesh → 
meshy_texture → meshy_rig → meshy_animate → select_glb → convert_vrm → complete
```

**Dependency Resolution:**
- Tasks can only execute when their dependency is complete
- Dependency completion = input file exists
- Tasks execute sequentially based on dependencies

## Task Consolidation

**Flexibility:**
Tasks are defined by input/output files, not hardcoded. If Meshy API consolidates endpoints:

**Example:** If `image-to-3d` + `remesh` + `texture` become a single endpoint:

```python
{
    "name": "meshy_3d_complete",  # Combined 3D + remesh + texture
    "input": "rendered.png",
    "output": "model_textured.glb",
    "depends_on": "chatgpt_render"
}
```

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


