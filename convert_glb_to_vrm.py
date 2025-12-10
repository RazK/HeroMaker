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
    mapping = {
        "hips": "Hips",
        "spine": "Spine02", # Connected to Hips
        "chest": "Spine01",
        "upperChest": "Spine", # Connected to Neck/Shoulders
        "neck": "neck",
        "head": "Head",
        "leftShoulder": "LeftShoulder",
        "leftUpperArm": "LeftArm",
        "leftLowerArm": "LeftForeArm",
        "leftHand": "LeftHand",
        "rightShoulder": "RightShoulder",
        "rightUpperArm": "RightArm",
        "rightLowerArm": "RightForeArm",
        "rightHand": "RightHand",
        "leftUpperLeg": "LeftUpLeg",
        "leftLowerLeg": "LeftLeg",
        "leftFoot": "LeftFoot",
        "leftToes": "LeftToeBase",
        "rightUpperLeg": "RightUpLeg",
        "rightLowerLeg": "RightLeg",
        "rightFoot": "RightFoot",
        "rightToes": "RightToeBase"
    }
    
    # Populate mapping
    for vrm_name, mixamo_name in mapping.items():
        # Check if bone exists in armature
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
            print(f"Warning: Bone '{mixamo_name}' not found for VRM slot '{vrm_name}'")

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
    try:
        # Explicitly pass the armature name and ignore warnings
        bpy.ops.export_scene.vrm(
            filepath=output_path,
            armature_object_name=armature.name,
            ignore_warning=True
        )
        print("Export success!")
    except Exception as e:
        print(f"Export failed: {e}")
        # Try alternate operator name if it changed in recent versions
        try:
            print("Retrying with alternate operator...")
            bpy.ops.vrm.export_vrm(filepath=output_path)
             
        except Exception as e2:
             print(f"Export retry failed: {e2}")

if __name__ == "__main__":
    main()
