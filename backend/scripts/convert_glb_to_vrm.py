import bpy
import sys
import math

def clean_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()

def find_armature():
    for obj in bpy.context.scene.objects:
        if obj.type == 'ARMATURE':
            return obj
    return None

def force_t_pose(armature):
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='POSE')
    
    # Reset all bone rotations to 0 (assuming the rig was built in T-Pose but has dirty rotations)
    for bone in armature.pose.bones:
        bone.rotation_mode = 'QUATERNION'
        bone.rotation_quaternion = (1, 0, 0, 0)
        bone.scale = (1, 1, 1)
        bone.location = (0, 0, 0)
    
    bpy.ops.object.mode_set(mode='OBJECT')

def bake_pose(armature):
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='POSE')
    
    # Select all bones
    bpy.ops.pose.select_all(action='SELECT')
    
    # Apply Pose as Rest Pose
    bpy.ops.pose.armature_apply()
    
    bpy.ops.object.mode_set(mode='OBJECT')

def map_vrm_bones(armature):
    # Ensure VRM extension exists
    if not hasattr(armature.data, "vrm_addon_extension"):
        print("Error: VRM Addon not found or not loaded properly on armature data.")
        return False
        
    ext = armature.data.vrm_addon_extension
    print(f"Setting VRM Spec Version from {ext.spec_version} to 0.0")
    ext.spec_version = "0.0"
        
    vrm0 = ext.vrm0
    human_bones = vrm0.humanoid.human_bones

    # Set minimal metadata to ensure valid export
    vrm0.meta.title = "Converted Avatar"
    vrm0.meta.author = "HeroMaker Pipeline"
    vrm0.meta.version = "1.0"
    
    # Clear existing mappings
    human_bones.clear()
    
    # Define mapping: VRM Bone Name -> Mixamo Bone Name
    # Note: 'neck' in the input file was lowercase
    
    # Required bones - must exist for valid VRM
    required_mapping = {
        "hips": "Hips",
        "spine": "Spine02", # Connected to Hips
        "neck": "neck",
        "head": "Head",
        "leftUpperArm": "LeftArm",
        "leftLowerArm": "LeftForeArm",
        "leftHand": "LeftHand",
        "rightUpperArm": "RightArm",
        "rightLowerArm": "RightForeArm",
        "rightHand": "RightHand",
        "leftUpperLeg": "LeftUpLeg",
        "leftLowerLeg": "LeftLeg",
        "leftFoot": "LeftFoot",
        "rightUpperLeg": "RightUpLeg",
        "rightLowerLeg": "RightLeg",
        "rightFoot": "RightFoot"
    }
    
    # Optional bones - VRM spec allows fallbacks if missing
    # If chest missing: spine becomes parent of upperChest
    # If upperChest missing: chest/spine becomes parent of neck/shoulders
    # If shoulders missing: arms connect directly to upperChest/spine
    # If toes missing: feet are end bones
    optional_mapping = {
        "chest": "Spine01",  # Optional: fallback to spine
        "upperChest": "Spine",  # Optional: fallback to chest/spine
        "leftShoulder": "LeftShoulder",  # Optional: fallback to upperChest/spine
        "rightShoulder": "RightShoulder",  # Optional: fallback to upperChest/spine
        "leftToes": "LeftToeBase",  # Optional: fallback to foot
        "rightToes": "RightToeBase"  # Optional: fallback to foot
    }
    
    # Check required bones first
    missing_required = []
    for vrm_name, mixamo_name in required_mapping.items():
        if mixamo_name not in armature.data.bones:
            missing_required.append(f"{vrm_name} ({mixamo_name})")
    
    if missing_required:
        print(f"Error: Missing required bones: {', '.join(missing_required)}")
        return False
    
    # Map required bones
    for vrm_name, mixamo_name in required_mapping.items():
        hb = human_bones.add()
        hb.bone = vrm_name
        # Handle deprecation: value -> bone_name
        if hasattr(hb.node, "bone_name"):
             hb.node.bone_name = mixamo_name
        else:
             hb.node.value = mixamo_name
        print(f"Mapped {vrm_name} -> {mixamo_name}")
    
    # Map optional bones (skip if missing - VRM spec allows fallbacks)
    # NOTE: Blender VRM addon requires 'chest' (Spine01) even though VRM spec says it's optional
    # If chest is missing, conversion will fail despite ignore_warning=True
    # This is a limitation of the Blender addon, not the VRM format
    for vrm_name, mixamo_name in optional_mapping.items():
        if mixamo_name in armature.data.bones:
            hb = human_bones.add()
            hb.bone = vrm_name
            # Handle deprecation: value -> bone_name
            if hasattr(hb.node, "bone_name"):
                 hb.node.bone_name = mixamo_name
            else:
                 hb.node.value = mixamo_name
            print(f"Mapped {vrm_name} -> {mixamo_name}")
        else:
            if vrm_name == "chest":
                print(f"Warning: Optional bone '{mixamo_name}' ({vrm_name}) not found")
                print(f"         Blender VRM addon requires this bone - conversion will likely fail")
            else:
                print(f"Info: Optional bone '{mixamo_name}' ({vrm_name}) not found - VRM spec allows fallback")

def main():
    # Args: blender --bg --python script.py -- input.glb output.vrm
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        print("Usage: blender ... -- input.glb output.vrm")
        return

    if len(argv) < 2:
        print("Error: Input and Output paths required.")
        return

    input_path = argv[0]
    output_path = argv[1]
    
    print(f"Processing: {input_path}")
    
    clean_scene()
    
    # Import GLB
    bpy.ops.import_scene.gltf(filepath=input_path)
    
    armature = find_armature()
    if not armature:
        print("Error: No armature found.")
        return

    # Select everything
    bpy.ops.object.select_all(action='SELECT')
    
    # 1. Apply Object Transforms (Location/Rotation/Scale)
    print("Applying Object Transforms...")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    
    # 2. Force T-Pose (Reset pose bones)
    print("Forcing T-Pose...")
    force_t_pose(armature)
    
    # 3. Bake Pose (Apply Pose to Rest Pose)
    print("Baking Rest Pose...")
    bake_pose(armature)
    
    # 4. Map Bones
    print("Mapping VRM Bones...")
    map_vrm_bones(armature)
    
    # 5. Export VRM
    print(f"Exporting to {output_path}...")
    export_success = False
    try:
        # Explicitly pass the armature name and ignore warnings
        # Note: ignore_warning=True allows export even with missing optional bones
        bpy.ops.export_scene.vrm(
            filepath=output_path,
            armature_object_name=armature.name,
            ignore_warning=True
        )
        # Check if file was actually created
        import os
        if os.path.exists(output_path):
            print("Export success!")
            export_success = True
        else:
            print("Warning: Export reported success but file not found")
    except Exception as e:
        print(f"Export failed: {e}")
        # Try alternate operator name if it changed in recent versions
        try:
            print("Retrying with alternate operator...")
            bpy.ops.vrm.export_vrm(filepath=output_path)
            import os
            if os.path.exists(output_path):
                print("Export success (retry)!")
                export_success = True
        except Exception as e2:
             print(f"Export retry failed: {e2}")
    
    if not export_success:
        print("Error: VRM export did not create output file")
        # Check if there are validation errors that prevented export
        # The VRM addon may fail silently if required bones are missing
        # even though the spec says they're optional
        print("Note: VRM addon may require 'chest' bone despite VRM spec allowing it to be optional")

if __name__ == "__main__":
    main()
