# VRM Conversion Testing Findings

## Overview

Testing GLB to VRM conversion using Blender VRM addon with Meshy-rigged models.

## Test Results

### Successful Conversions
- **girl_superhero.vrm**: Successfully converted (5.47 MB)
  - Has complete bone hierarchy (24 joints including Spine01)
  - All required and optional bones present
  - Conversion time: ~1.6-2.0 seconds

### Failed Conversions
- **crayon_superhero**: Failed to convert
  - Missing `Spine01` bone (chest bone in VRM)
  - Has 22 joints instead of 24
  - Blender VRM addon requires `chest` bone despite VRM spec allowing it to be optional

## Key Findings

### 1. Bone Hierarchy Requirements

**Required Bones (must exist):**
- `Hips` → hips
- `Spine02` → spine
- `neck` → neck
- `Head` → head
- All limb bones (arms, legs, hands, feet)

**Optional Bones (per VRM spec, but Blender addon requires some):**
- `Spine01` → chest (VRM spec: optional, **Blender addon: REQUIRED**)
- `Spine` → upperChest (optional)
- `LeftShoulder` / `RightShoulder` (optional)
- `LeftToeBase` / `RightToeBase` (optional)

### 2. Blender VRM Addon Limitation

**Critical Issue**: The Blender VRM addon implementation does not fully support the VRM specification's optional bone fallbacks.

- **VRM Spec**: `chest` bone is optional. If missing, `spine` becomes parent of `upperChest`
- **Blender Addon**: Requires `chest` bone even with `ignore_warning=True`
- **Result**: Conversion fails silently when `chest` (Spine01) is missing, even though VRM spec allows it

**Error Message:**
```
[VRM Add-on:WARNING] Validation error: Required VRM Human Bone "Chest" is not assigned.
```

The addon reports "Export success!" but does not create the output file when `chest` is missing.

### 3. Meshy Rigging Quality

- Some Meshy-rigged models have incomplete bone hierarchies (22 joints vs 24)
- Missing bones typically include `Spine01` (chest)
- This appears to depend on model structure and clarity
- Models with clearer humanoid form tend to get complete rigs

## Recommendations

### Immediate Actions

1. **Require Complete Rigs for VRM Conversion**
   - Validate bone completeness before attempting conversion
   - Models need 24+ joints including `Spine01` for successful VRM conversion
   - Document this requirement in pipeline

2. **Improve Rigging Quality**
   - Use `height_meters` parameter in Meshy rigging API calls
   - Validate input models have clear humanoid structure before rigging
   - Consider re-rigging models that produce incomplete skeletons

3. **Error Handling**
   - Check for required bones before conversion attempt
   - Provide clear error messages when bones are missing
   - Document which bones are required vs optional

### Future Improvements

1. **Alternative VRM Export Tools**
   - Research other VRM export tools that better support optional bones
   - Consider using VRM SDK or other conversion libraries

2. **Bone Completion Fix**
   - Investigate if missing bones can be added programmatically in Blender
   - Consider post-processing incomplete rigs to add missing bones

3. **Rigging Parameter Optimization**
   - Test different `height_meters` values to improve rig quality
   - Document best practices for input models to ensure complete rigs

## Code Changes Summary

### Improvements Made

1. **`convert_glb_to_vrm.py`**
   - ✅ Separated required vs optional bones (clearer structure)
   - ✅ Added validation for required bones (fails fast with clear errors)
   - ✅ Better comments explaining VRM spec and fallbacks
   - ⚠️ Added fallback attempt for chest bone (doesn't work due to Blender addon limitation)

2. **`test_vrm_conversion.py`** (new)
   - ✅ Comprehensive test script for VRM conversion
   - ✅ Bone validation before conversion
   - ✅ Clear error messages and warnings
   - ✅ Supports testing individual files or all rigged GLBs

3. **`test_utils.py`**
   - ✅ Added `validate_vrm_file()` function for basic VRM validation

### Code Quality Assessment

**Overall**: ✅ **Improved**

**Positive Changes:**
- Better code organization (required vs optional bones)
- Clearer error messages and validation
- Comprehensive test script
- Better documentation in code comments

**Areas for Cleanup:**
- The fallback code in `convert_glb_to_vrm.py` (lines 120-137) attempts to work around Blender addon limitation but doesn't work
- Consider removing or clearly documenting why the fallback exists even though it doesn't work
- Could be simplified since the fallback doesn't actually help

## Test Commands

```bash
# Test all rigged GLB files
python research/scripts/test_vrm_conversion.py

# Test specific file
python research/scripts/test_vrm_conversion.py --glb crayon_superhero_rigged.glb
```

## Next Steps

1. ✅ Document findings (this document)
2. ⏳ Update rigging calls to use `height_meters` parameter
3. ⏳ Test if `height_meters` improves rig completeness
4. ⏳ Consider removing non-functional fallback code or documenting it clearly
5. ⏳ Research alternative VRM export methods
