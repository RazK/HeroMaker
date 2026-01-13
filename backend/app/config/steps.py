STEPS = [
    {
        "name": "image_processing",
        "input": "original.jpg",
        "output": "processed.jpg",
        "estimated_duration": 1,  # Avg: 0.00s from 62 samples (rounded to 1s minimum)
        "token_cost": 0
    },
    {
        "name": "openai_render",
        "input": "processed.jpg",
        "output": "rendered.png",
        "depends_on": "image_processing",
        "estimated_duration": 54,  # Avg: 53.98s from 62 samples
        "token_cost": 2
    },
    {
        "name": "meshy_3d",
        "input": "rendered.png",
        "output": "model.glb",
        "depends_on": "openai_render",
        "estimated_duration": 309,  # Avg: 308.78s from 62 samples
        "token_cost": 5
    },
    {
        "name": "meshy_rig",
        "input": "model.glb",
        "output": "rigged.glb",
        "depends_on": "meshy_3d",
        "estimated_duration": 43,  # Avg: 43.01s from 51 samples
        "token_cost": 2
    },
    {
        "name": "convert_vrm",
        "input": "rigged.glb",
        "output": "avatar.vrm",
        "depends_on": "meshy_rig",
        "estimated_duration": 3,  # Avg: 2.61s from 51 samples (rounded to 3s)
        "token_cost": 1
    },
    {
        "name": "complete",
        "input": "avatar.vrm",
        "output": None,
        "depends_on": "convert_vrm",
        "estimated_duration": 1,  # Avg: 0.00s from 51 samples (rounded to 1s minimum)
        "token_cost": 0
    }
]
# Total creation cost: 10 tokens

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


def get_total_creation_cost() -> int:
    """Calculate total token cost for a full creation pipeline."""
    return sum(step.get("token_cost", 0) for step in STEPS)

