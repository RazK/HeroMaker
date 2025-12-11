# GLB File Viewing Tools - Rigging/Skeleton Visualization

This document lists tools for viewing and inspecting GLB files, especially for checking rigging/skeleton data.

## Online Tools (Browser-based)

### 1. **Don McCurdy's glTF Viewer** ⭐ Recommended
- **URL**: https://gltf-viewer.donmccurdy.com/
- **Features**:
  - Drag-and-drop GLB/GLTF files
  - Shows skeleton/bones overlay
  - Settings panel (gear icon) → Toggle "Show Skeleton"
  - Good for debugging animations and bone hierarchy
- **Best for**: Quick visual inspection of rigging

### 2. **glTF.report**
- **URL**: https://gltf.report/
- **Features**:
  - Detailed technical analysis of GLB/GLTF files
  - Shows file structure, textures, materials
  - May show skeleton information in the analysis
- **Best for**: Technical validation and file structure inspection

### 3. **Bone Mapper 3D Rigging Tool**
- **URL**: https://jonasz-o.itch.io/bone-mapper-3d-rigging-tool
- **Features**:
  - Load FBX or GLB files
  - Visual skeleton editor
  - Smart joint detection
  - Drag-and-drop interface for joint configuration
- **Best for**: Interactive rigging inspection and editing

### 4. **P4 DAM (formerly Helix DAM)**
- **URL**: https://help.perforce.com/helix-core/helix-dam/
- **Features**:
  - Renders GLB files with skeleton visualization
  - Color-coded bones (green = root, blue = tip)
  - Viewer settings → Toggle Skeleton option
- **Best for**: Professional asset management and visualization

## Desktop Tools

### 1. **Blender** (Free, Open Source) ⭐ Recommended for detailed inspection
- **URL**: https://www.blender.org/
- **Features**:
  - Full 3D modeling and animation suite
  - Import GLB files directly
  - View skeleton in Edit Mode or Pose Mode
  - Can manipulate bones, check weights, etc.
- **Best for**: Deep inspection, editing, and validation

### 2. **Three.js Editor**
- **URL**: https://threejs.org/editor/
- **Features**:
  - Web-based but can be run locally
  - Supports GLB import
  - Shows scene hierarchy including skeletons
- **Best for**: Developers familiar with Three.js

## Command-line Tools (Python)

### Check Rigging Programmatically

We've created a Python script to check for rigging data:

```bash
# Check a single GLB file
python research/scripts/check_glb_rigging.py path/to/file.glb

# Verbose output (show all joints)
python research/scripts/check_glb_rigging.py path/to/file.glb --verbose

# Example
python research/scripts/check_glb_rigging.py assets/research/test_data/intermediate_outputs/girl_superhero_rigged.glb --verbose
```

The script uses `pygltflib` to parse the GLB file and reports:
- Whether rigging data exists
- Number of skins
- Number of joints/bones
- Joint names

## Quick Verification

For our Meshy API rigging tests, the `test_rig.py` script now automatically checks for rigging data when downloading GLB files:

```bash
python research/scripts/test_rig.py --download-only
```

This will show:
```
✓ Rigging detected: 1 skin(s), 24 joint(s)
   Joints: LeftToeBase, LeftFoot, LeftLeg, ...
```

## Notes

- **Meshy's online viewer**: As you noted, Meshy's web interface doesn't show rigging info for uploaded rigged GLB files, only for models rigged through their interface.
- **GLB vs GLTF**: GLB is the binary format of glTF. Both contain the same data structure, including skeleton/rigging information.
- **Rigging data structure**: In glTF/GLB, rigging is stored as:
  - `skins`: Define the skeleton structure
  - `nodes`: Represent bones/joints
  - `joints`: Array of node indices that form the skeleton

## Recommended Workflow

1. **Quick check**: Use `check_glb_rigging.py` to verify rigging exists
2. **Visual inspection**: Use Don McCurdy's viewer to see the skeleton overlay
3. **Deep analysis**: Use Blender if you need to inspect bone weights, hierarchy, or make edits
