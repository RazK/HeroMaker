---
name: Meshy API Research Testing Plan
overview: Create a comprehensive research and testing plan to explore Meshy API capabilities for the HeroMaker pipeline, including individual endpoint testing, sequential workflow validation, and documentation of findings.
todos:
  - id: research_docs
    content: Research Meshy API documentation and create endpoint mapping document
    status: pending
  - id: setup_test_env
    content: Create test environment setup scripts and reusable Meshy API client
    status: pending
  - id: test_image_to_3d
    content: Create and run image-to-3D model testing script
    status: pending
  - id: test_remesh
    content: Create and run remesh testing script
    status: pending
  - id: test_texture
    content: Create and run texturing testing script
    status: pending
  - id: test_rig
    content: Create and run rigging testing script
    status: pending
  - id: test_animate
    content: Create and run animations testing script
    status: pending
  - id: test_full_pipeline
    content: Test complete sequential workflow end-to-end
    status: pending
  - id: assess_quality
    content: Assess output quality at each step and create quality report
    status: pending
  - id: create_documentation
    content: Create integration guide and findings summary documentation
    status: pending
---

# Meshy API Research & Testing Plan

## Objectives

1. Understand Meshy API capabilities for all pipeline steps (image-to-3D, remesh, texturing, rigging, animations)
2. Test complete sequential workflow end-to-end
3. Document API parameters, response formats, timing, and limitations
4. Create reusable scripts for integration into the pipeline
5. Assess output quality at each step

## Workflow Process

**IMPORTANT**: This research follows an iterative, approval-based workflow:

1. Complete ONE step at a time
2. NEVER progress to the next step without explicit user approval
3. After each step: share results, ask user to try things out if needed, and review/update the plan
4. User must approve before moving to next step

## Phase 1: API Research & Documentation Discovery

### 1.1 Meshy API Documentation Review

- **Location**: `research/meshy_api_docs.md`
- **Status**: ⏳ Pending - First step to execute
- **Tasks**:
  - Review official Meshy API documentation
  - Document all available endpoints relevant to pipeline
  - Identify authentication methods
  - Document rate limits and pricing
  - Note any webhook vs polling mechanisms
  - Document supported file formats (input/output)
  - List all available parameters for each endpoint
- **After completion**: Share findings, get user approval before proceeding

### 1.2 API Endpoint Mapping

- **Location**: `research/meshy_endpoints.md`
- **Status**: ⏳ Pending - Requires approval after 1.1
- **Map pipeline steps to Meshy endpoints**:
  - Step 3: Image-to-3D → `POST /api/v2/image-to-3d` (or equivalent)
  - Step 4: Remesh → `POST /api/v2/remesh` (or equivalent)
  - Step 5: Texturing → `POST /api/v2/texture` (or equivalent)
  - Step 6: Rigging → `POST /api/v2/rig` (or equivalent)
  - Step 7: Animations → `POST /api/v2/animate` (or equivalent)
- Document exact endpoint URLs, methods, and required headers

## Phase 2: Test Infrastructure Setup

### 2.1 Create Test Environment

- **Location**: `research/scripts/`
- **Files to create**:
  - `setup_test_env.py` - Setup test directories and validate API key
  - `meshy_client.py` - Reusable Meshy API client wrapper
  - `test_utils.py` - Helper functions for file handling, polling, etc.
  - `.env.example` - Template for API key configuration
- **Ready to test**: `cd /Users/razkarl/projects/HeroMaker && python3 research/scripts/setup_test_env.py`

### 2.2 Test Data Preparation

- **Location**: `assets/research/test_data/`
- **Tasks**:
  - Organize existing test images from `assets/meshy/`
  - Create test data structure:
    ```
    assets/research/test_data/
    ├── input_images/
    │   ├── test_character_1.png
    │   └── test_character_2.png
    ├── intermediate_outputs/
    └── final_outputs/
    ```
- **Ready to test**: `cd /Users/razkarl/projects/HeroMaker && ls -la assets/research/test_data/input_images/`


## Phase 3: Individual Endpoint Testing

### 3.1 Image-to-3D Model Testing

- **Script**: `scripts/research/test_image_to_3d.py`
- **Tests**:
  - Submit image and receive task ID
  - Test polling mechanism for status checks
  - Test different image formats (PNG, JPG)
  - Test different image sizes/resolutions
  - Test available parameters (quality, style, etc.)
  - Download and validate GLB output
  - Measure processing time
  - Test error cases (invalid image, wrong format, etc.)
- **Output**: Document findings in `research/findings_image_to_3d.md`
- **Ready to test**: `cd /Users/razkarl/projects/HeroMaker && python3 research/scripts/test_image_to_3d.py`

### 3.2 Remesh Testing

- **Script**: `scripts/research/test_remesh.py`
- **Tests**:
  - Upload GLB from step 3.1
  - Test remesh parameters (target polygon count, quality)
  - Test polling for completion
  - Download remeshed GLB
  - Compare input/output (polygon count, file size)
  - Measure processing time
  - Test with different GLB files
- **Output**: Document findings in `research/findings_remesh.md`
- **Ready to test**: `cd /Users/razkarl/projects/HeroMaker && python3 research/scripts/test_remesh.py`

### 3.3 Texturing Testing

- **Script**: `scripts/research/test_texture.py`
- **Tests**:
  - Upload remeshed GLB from step 3.2
  - Test texturing parameters (style, quality, resolution)
  - Test with/without reference images
  - Poll for completion
  - Download textured GLB
  - Validate texture quality
  - Measure processing time
- **Output**: Document findings in `research/findings_texture.md`
- **Ready to test**: `cd /Users/razkarl/projects/HeroMaker && python3 research/scripts/test_texture.py`

### 3.4 Rigging Testing

- **Script**: `scripts/research/test_rig.py`
- **Tests**:
  - Upload textured GLB from step 3.3
  - Test rigging parameters (rig type, bone structure)
  - Poll for completion
  - Download rigged GLB
  - Validate armature/bone structure
  - Test if rig is compatible with VRM conversion
  - Measure processing time
- **Output**: Document findings in `research/findings_rig.md`
- **Ready to test**: `cd /Users/razkarl/projects/HeroMaker && python3 research/scripts/test_rig.py`

### 3.5 Animations Testing

- **Script**: `scripts/research/test_animate.py`
- **Tests**:
  - Upload rigged GLB from step 3.4
  - Test animation parameters (animation type, duration)
  - Test available animation presets
  - Poll for completion
  - Download animated GLB
  - Validate animation data
  - Measure processing time
- **Output**: Document findings in `research/findings_animate.md`
- **Ready to test**: `cd /Users/razkarl/projects/HeroMaker && python3 research/scripts/test_animate.py`

## Phase 4: Sequential Workflow Testing

### 4.1 Complete Pipeline Test

- **Script**: `scripts/research/test_full_pipeline.py`
- **Tests**:
  - Execute all steps sequentially using outputs from previous steps
  - Track total processing time
  - Validate file chain: image → 3D → remesh → texture → rig → animate
  - Test error recovery (what happens if step fails mid-pipeline)
  - Test pause/resume capability (if supported)
- **Output**: Document workflow findings in `research/findings_full_pipeline.md`
- **Ready to test**: `cd /Users/razkarl/projects/HeroMaker && python3 research/scripts/test_full_pipeline.py`

### 4.2 Workflow Variations Testing

- **Script**: `scripts/research/test_workflow_variations.py`
- **Tests**:
  - Test skipping optional steps (e.g., can we go 3D → texture without remesh?)
  - Test different parameter combinations
  - Test with multiple test images
  - Compare quality: full pipeline vs shortcuts

## Phase 5: Quality Assessment

### 5.1 Output Quality Analysis

- **Script**: `scripts/research/assess_quality.py`
- **Analysis**:
  - Visual inspection of outputs at each step
  - File size comparisons
  - Polygon count analysis
  - Texture resolution assessment
  - Animation smoothness
  - VRM conversion compatibility
- **Output**: Quality report in `research/quality_assessment.md`

## Phase 6: Documentation & Integration Prep

### 6.1 API Client Library

- **File**: `scripts/research/meshy_client.py` (enhance from Phase 2)
- **Features**:
  - Complete wrapper for all Meshy endpoints
  - Automatic polling with configurable intervals
  - Error handling and retry logic
  - File upload/download helpers
  - Status tracking utilities

### 6.2 Integration Guide

- **File**: `research/integration_guide.md`
- **Content**:
  - How to use meshy_client.py in pipeline
  - Parameter recommendations for each step
  - Error handling best practices
  - Estimated processing times
  - Cost considerations
  - Known limitations and workarounds

### 6.3 Findings Summary

- **File**: `research/meshy_api_findings_summary.md`
- **Content**:
  - Executive summary of capabilities
  - API endpoint reference
  - Parameter reference
  - Processing time estimates
  - Quality assessment summary
  - Limitations and edge cases
  - Recommendations for pipeline integration

## Deliverables

1. **Research Documentation**:

   - API documentation notes
   - Endpoint mapping
   - Individual step findings (5 files)
   - Full pipeline findings
   - Quality assessment
   - Integration guide
   - Summary document

2. **Test Scripts**:

   - Setup utilities
   - Individual endpoint test scripts (5 scripts)
   - Full pipeline test script
   - Workflow variation tests
   - Quality assessment script

3. **Reusable Code**:

   - `meshy_client.py` - Production-ready API client
   - Test utilities for future use

4. **Test Results**:

   - Sample outputs at each step
   - Processing time logs
   - Error case documentation

## Success Criteria

✅ All 5 Meshy API endpoints tested individually

✅ Complete sequential workflow tested end-to-end

✅ API parameters, responses, and timing documented

✅ Reusable client library created

✅ Quality of outputs assessed

✅ Integration guide prepared

✅ Ready to implement in pipeline scripts (Step 1.4-1.8)