TASKS = [
    {
        "name": "image_capture",
        "input": None,
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
        "output": None,
        "depends_on": "convert_vrm"
    }
]

def get_task_by_name(name: str):
    return next((t for t in TASKS if t["name"] == name), None)

def get_next_task(current_task_name: str):
    for i, task in enumerate(TASKS):
        if task["name"] == current_task_name:
            if i + 1 < len(TASKS):
                return TASKS[i + 1]
    return None

def get_first_task():
    return TASKS[0] if TASKS else None

