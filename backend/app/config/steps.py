from typing import List

STEPS = [
    {
        "name": "image_processing",
        "display_name": "Image Processing",
        "input": "original.jpg",
        "output": "processed.jpg",
        "estimated_duration": 1,
        "credit_cost": 0,
        "timeout": 60
    },
    {
        "name": "openai_render",
        "display_name": "AI Rendering",
        "input": "processed.jpg",
        "output": "rendered.png",
        "estimated_duration": 54,
        "credit_cost": 2,
        "timeout": 300
    },
    {
        "name": "meshy_3d",
        "display_name": "3D Modeling",
        "input": "rendered.png",
        "output": "model.glb",
        "estimated_duration": 309,
        "credit_cost": 5,
        "timeout": 1800
    },
    {
        "name": "meshy_rig",
        "display_name": "Rigging & Animation",
        "input": "model.glb",
        "output": "rigged.glb",
        "estimated_duration": 43,
        "credit_cost": 2,
        "timeout": 1800
    },
    {
        "name": "convert_vrm",
        "display_name": "VRM Conversion",
        "input": "rigged.glb",
        "output": "avatar.vrm",
        "estimated_duration": 3,
        "credit_cost": 1,
        "timeout": 300
    },
]
# Total creation cost: 10 credits

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


def calculate_steps_cost(step_names: List[str]) -> int:
    """Calculate total credit cost for a list of steps."""
    return sum(get_step_cost(name) for name in step_names)


def get_step_cost(step_name: str) -> int:
    """Get credit cost for a single step."""
    step = get_step_by_name(step_name)
    return step.get("credit_cost", 0) if step else 0


def get_last_step():
    """Get the last step in the pipeline."""
    return STEPS[-1] if STEPS else None


def is_last_step(step_name: str) -> bool:
    """Check if a step is the last step in the pipeline."""
    last = get_last_step()
    return last is not None and last["name"] == step_name


def get_steps_config():
    """Get step configuration for frontend (name, display_name, credit_cost, output)."""
    return [
        {
            "name": step["name"],
            "display_name": step["display_name"],
            "credit_cost": step["credit_cost"],
            "output_file": step["output"],
        }
        for step in STEPS
    ]