STEPS = [
    {
        "name": "image_processing", 
        "input": "original.jpg",
        "output": "processed.jpg",
        "estimated_duration": 1  # Avg: 0.0s from 10 samples (rounded to 1s minimum)
    },
    {
        "name": "chatgpt_render",
        "input": "processed.jpg",
        "output": "rendered.png",
        "depends_on": "image_processing",
        "estimated_duration": 60  # Avg: 540.6s from 5 samples
    },
    {
        "name": "meshy_3d",
        "input": "rendered.png",
        "output": "model.glb",
        "depends_on": "chatgpt_render",
        "estimated_duration": 180  # Avg: 201.2s from 5 samples
    },
    {
        "name": "meshy_rig",
        "input": "model.glb",
        "output": "rigged.glb",
        "depends_on": "meshy_3d",
        "estimated_duration": 30  # Avg: 25.4s from 3 samples
    },
    {
        "name": "convert_vrm",
        "input": "rigged.glb",
        "output": "avatar.vrm",
        "depends_on": "meshy_rig",
        "estimated_duration": 3  # Avg: 2.8s from 3 samples (rounded to 3s)
    },
    {
        "name": "complete",
        "input": "avatar.vrm",
        "output": None,
        "depends_on": "convert_vrm",
        "estimated_duration": 1  # Avg: 0.0s from 3 samples (rounded to 1s minimum)
    }
]

def get_step_by_name(name: str):
    return next((s for s in STEPS if s["name"] == name), None)

def get_next_step(current_step_name: str):
    for i, step in enumerate(STEPS):
        if step["name"] == current_step_name:
            if i + 1 < len(STEPS):
                return STEPS[i + 1]
    return None

def get_first_step():
    return STEPS[0] if STEPS else None

def get_all_step_names():
    return [step["name"] for step in STEPS]

