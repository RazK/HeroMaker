import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1, 3);

const renderer = new THREE.WebGLRenderer({ antialias: true });
const container = document.getElementById('container');
const containerWidth = container.clientWidth;
const containerHeight = container.clientHeight;
renderer.setSize(containerWidth, containerHeight);
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.update();

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 10, 5);
scene.add(directionalLight);

// Variables
let model = null;
let skeletonHelper = null;
let showSkeleton = false;
let bones = [];
let boneMap = new Map();
let selectedBone = null;
let originalRotations = new Map();
let boneAxes = [];
let showAxes = false;
let skinnedMesh = null;
let initialPose = null; // Store the initial pose (close to A-pose)

// Create skeleton helper
function createSkeletonHelper() {
    if (skeletonHelper) {
        scene.remove(skeletonHelper);
        skeletonHelper = null;
    }
    
    if (!model) return;
    
    // Check if model has a skeleton
    let hasSkeleton = false;
    model.traverse((child) => {
        if (child.isSkinnedMesh && child.skeleton) {
            hasSkeleton = true;
            skinnedMesh = child;
        }
    });
    
    if (hasSkeleton) {
        skeletonHelper = new THREE.SkeletonHelper(model);
        skeletonHelper.visible = showSkeleton;
        scene.add(skeletonHelper);
    }
}

// Extract bone hierarchy
function extractBones() {
    bones = [];
    boneMap.clear();
    originalRotations.clear();
    initialPose = {};
    
    if (!model) return;
    
    model.traverse((child) => {
        if (child.isBone) {
            bones.push(child);
            boneMap.set(child.name, child);
            // Store original rotation
            const toDegrees = (rad) => rad * 180 / Math.PI;
            originalRotations.set(child.name, {
                x: child.rotation.x,
                y: child.rotation.y,
                z: child.rotation.z
            });
            // Store initial pose in degrees (for JSON)
            initialPose[child.name] = {
                x: toDegrees(child.rotation.x),
                y: toDegrees(child.rotation.y),
                z: toDegrees(child.rotation.z)
            };
        }
    });
    
    // Sort bones by name for easier navigation
    bones.sort((a, b) => a.name.localeCompare(b.name));
    
    updateBoneList();
    updatePoseJSON();
    enableDebugTools();
}

// Update bone list UI
function updateBoneList() {
    const boneList = document.getElementById('bone-list');
    boneList.innerHTML = '';
    
    bones.forEach(bone => {
        const item = document.createElement('div');
        item.className = 'bone-item';
        item.textContent = bone.name;
        item.addEventListener('click', () => selectBone(bone));
        boneList.appendChild(item);
    });
}

// Select bone
function selectBone(bone) {
    // Update UI selection
    document.querySelectorAll('.bone-item').forEach(item => {
        item.classList.remove('selected');
        if (item.textContent === bone.name) {
            item.classList.add('selected');
        }
    });
    
    selectedBone = bone;
    updateBoneControls();
}

// Update bone rotation controls
function updateBoneControls() {
    const controlsDiv = document.getElementById('bone-controls');
    
    if (!selectedBone) {
        controlsDiv.innerHTML = '<p class="no-bone-selected">Select a bone to adjust</p>';
        return;
    }
    
    const rot = selectedBone.rotation;
    const toDegrees = (rad) => (rad * 180 / Math.PI).toFixed(1);
    const toRadians = (deg) => deg * Math.PI / 180;
    
    controlsDiv.innerHTML = `
        <div class="rotation-control">
            <label>X Rotation: <span class="rotation-value" id="rotXValue">${toDegrees(rot.x)}°</span></label>
            <input type="range" id="rotX" min="-180" max="180" value="${toDegrees(rot.x)}" step="1">
        </div>
        <div class="rotation-control">
            <label>Y Rotation: <span class="rotation-value" id="rotYValue">${toDegrees(rot.y)}°</span></label>
            <input type="range" id="rotY" min="-180" max="180" value="${toDegrees(rot.y)}" step="1">
        </div>
        <div class="rotation-control">
            <label>Z Rotation: <span class="rotation-value" id="rotZValue">${toDegrees(rot.z)}°</span></label>
            <input type="range" id="rotZ" min="-180" max="180" value="${toDegrees(rot.z)}" step="1">
        </div>
    `;
    
    // Add event listeners
    ['X', 'Y', 'Z'].forEach(axis => {
        const slider = document.getElementById(`rot${axis}`);
        const valueSpan = document.getElementById(`rot${axis}Value`);
        
        slider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            valueSpan.textContent = `${value}°`;
            selectedBone.rotation[axis.toLowerCase()] = toRadians(value);
            
            // Update skeleton if it exists
            if (skinnedMesh && skinnedMesh.skeleton) {
                skinnedMesh.skeleton.update();
            }
            
            // Update axes if showing
            if (showAxes) {
                updateBoneAxes();
            }
            
            // Update pose JSON
            updatePoseJSON();
        });
    });
}

// Apply pose to model
function applyPose(pose) {
    if (!model || bones.length === 0) return;
    
    const toRadians = (deg) => deg * Math.PI / 180;
    bones.forEach(bone => {
        const bonePose = pose[bone.name];
        if (bonePose) {
            bone.rotation.set(
                toRadians(bonePose.x),
                toRadians(bonePose.y),
                toRadians(bonePose.z)
            );
        }
    });
    
    if (skinnedMesh && skinnedMesh.skeleton) {
        skinnedMesh.skeleton.update();
    }
    
    if (selectedBone) {
        updateBoneControls();
    }
    
    updatePoseJSON();
    if (showAxes) {
        updateBoneAxes();
    }
}

// Get current pose as JSON
function getCurrentPose() {
    if (!model || bones.length === 0) return null;
    
    const pose = {};
    bones.forEach(bone => {
        const toDegrees = (rad) => rad * 180 / Math.PI;
        pose[bone.name] = {
            x: toDegrees(bone.rotation.x),
            y: toDegrees(bone.rotation.y),
            z: toDegrees(bone.rotation.z)
        };
    });
    return pose;
}

// Update pose JSON display
function updatePoseJSON() {
    const pose = getCurrentPose();
    const display = document.getElementById('pose-json-display');
    if (pose) {
        display.textContent = JSON.stringify(pose, null, 2);
    } else {
        display.textContent = '';
    }
}

// Export current pose
// Export pose as JSON file
function exportPose() {
    const pose = getCurrentPose();
    if (!pose) return;
    
    const json = JSON.stringify(pose, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pose.json';
    a.click();
    URL.revokeObjectURL(url);
}

// Show/hide bone axes
function updateBoneAxes() {
    // Remove existing axes
    boneAxes.forEach(axis => scene.remove(axis));
    boneAxes = [];
    
    if (!showAxes || !model) return;
    
    bones.forEach(bone => {
        const length = 0.1;
        const origin = new THREE.Vector3();
        bone.getWorldPosition(origin);
        
        // X axis (red)
        const xAxis = new THREE.ArrowHelper(
            new THREE.Vector3(1, 0, 0),
            origin,
            length,
            0xff0000
        );
        xAxis.rotation.copy(bone.getWorldQuaternion(new THREE.Quaternion()));
        scene.add(xAxis);
        boneAxes.push(xAxis);
        
        // Y axis (green)
        const yAxis = new THREE.ArrowHelper(
            new THREE.Vector3(0, 1, 0),
            origin,
            length,
            0x00ff00
        );
        yAxis.rotation.copy(bone.getWorldQuaternion(new THREE.Quaternion()));
        scene.add(yAxis);
        boneAxes.push(yAxis);
        
        // Z axis (blue)
        const zAxis = new THREE.ArrowHelper(
            new THREE.Vector3(0, 0, 1),
            origin,
            length,
            0x0000ff
        );
        zAxis.rotation.copy(bone.getWorldQuaternion(new THREE.Quaternion()));
        scene.add(zAxis);
        boneAxes.push(zAxis);
    });
}

// Enable debug tools
function enableDebugTools() {
    document.getElementById('debug-panel').classList.add('active');
    document.getElementById('exportPoseBtn').disabled = false;
    document.getElementById('refreshPoseBtn').disabled = false;
    document.getElementById('showAxesToggle').disabled = false;
    document.getElementById('savePresetBtn').disabled = false;
    document.getElementById('presetSelect').disabled = false;
    updatePresetSelect();
}

// Load model
document.getElementById('loadBtn').addEventListener('click', () => {
    const loader = new GLTFLoader();
    loader.load(
        'http://localhost:3000/api/model/example',
        (gltf) => {
            // Remove old model
            if (model) {
                scene.remove(model);
            }
            if (skeletonHelper) {
                scene.remove(skeletonHelper);
            }
            updateBoneAxes(); // Remove old axes

            // Add new model
            model = gltf.scene;
            scene.add(model);
            
            // Extract bones
            extractBones();
            
            // Create skeleton helper
            createSkeletonHelper();

            // Enable skeleton toggle
            document.getElementById('skeletonToggle').disabled = false;
            
            // Enable debug tools
            enableDebugTools();
        },
        undefined,
        (error) => {
            console.error('Error loading model:', error);
        }
    );
});

// Toggle skeleton
document.getElementById('skeletonToggle').addEventListener('change', (e) => {
    showSkeleton = e.target.checked;
    if (skeletonHelper) {
        skeletonHelper.visible = showSkeleton;
    } else if (model && showSkeleton) {
        createSkeletonHelper();
        if (skeletonHelper) {
            skeletonHelper.visible = true;
        }
    }
});

// Pose presets storage (server-based)
let posePresets = {};

// Load presets from server
async function loadPresetsFromServer() {
    try {
        const response = await fetch('/api/poses');
        if (!response.ok) {
            console.warn('Failed to load poses from server');
            return;
        }
        const poseNames = await response.json();
        
        // Load each pose
        posePresets = {};
        for (const name of poseNames) {
            try {
                const poseResponse = await fetch(`/api/poses/${encodeURIComponent(name)}`);
                if (poseResponse.ok) {
                    posePresets[name] = await poseResponse.json();
                }
            } catch (e) {
                console.error(`Error loading pose ${name}:`, e);
            }
        }
        updatePresetSelect();
    } catch (e) {
        console.error('Error loading presets from server:', e);
    }
}

// Save preset to server
async function savePresetToServer(name, pose) {
    try {
        const response = await fetch('/api/poses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, pose })
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to save pose');
        }
        return await response.json();
    } catch (e) {
        console.error('Error saving pose to server:', e);
        throw e;
    }
}

// Delete preset from server
async function deletePresetFromServer(name) {
    try {
        const response = await fetch(`/api/poses/${encodeURIComponent(name)}`, {
            method: 'DELETE'
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to delete pose');
        }
        return await response.json();
    } catch (e) {
        console.error('Error deleting pose from server:', e);
        throw e;
    }
}

// Update preset select dropdown
function updatePresetSelect() {
    const select = document.getElementById('presetSelect');
    const currentValue = select.value; // Save current selection
    select.innerHTML = '<option value="">Select a preset...</option>';
    
    Object.keys(posePresets).sort().forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
    });
    
    // Restore selection if it still exists
    if (currentValue && posePresets[currentValue]) {
        select.value = currentValue;
    }
    
    // Update button states based on current selection
    updatePresetButtonStates();
}

// Update preset button states
function updatePresetButtonStates() {
    const select = document.getElementById('presetSelect');
    const hasSelection = select.value !== '' && posePresets[select.value];
    document.getElementById('deletePresetBtn').disabled = !hasSelection;
}

// Save current pose as preset (server)
async function savePreset() {
    const name = document.getElementById('presetName').value.trim();
    if (!name) {
        alert('Please enter a preset name');
        return;
    }
    
    const pose = getCurrentPose();
    if (!pose) {
        alert('No model loaded');
        return;
    }
    
    try {
        await savePresetToServer(name, pose);
        posePresets[name] = pose;
        updatePresetSelect();
        document.getElementById('presetName').value = '';
        
        // Select the newly saved preset
        document.getElementById('presetSelect').value = name;
        updatePresetButtonStates();
    } catch (e) {
        alert('Error saving pose: ' + e.message);
    }
}

// Load selected preset
function loadPreset() {
    const select = document.getElementById('presetSelect');
    const name = select.value;
    
    if (!name) {
        console.warn('No preset selected');
        return;
    }
    
    if (!posePresets[name]) {
        console.error('Preset not found:', name, 'Available presets:', Object.keys(posePresets));
        return;
    }
    
    if (!model || bones.length === 0) {
        console.warn('No model loaded, cannot apply pose');
        return;
    }
    
    console.log('Loading preset:', name);
    console.log('Preset data:', posePresets[name]);
    applyPose(posePresets[name]);
}

// Delete selected preset
async function deletePreset() {
    const select = document.getElementById('presetSelect');
    const name = select.value;
    if (!name || !posePresets[name]) {
        alert('No preset selected');
        return;
    }
    
    if (!confirm(`Delete preset "${name}"?`)) {
        return;
    }
    
    try {
        await deletePresetFromServer(name);
        delete posePresets[name];
        updatePresetSelect();
        updatePresetButtonStates();
    } catch (e) {
        alert('Error deleting pose: ' + e.message);
    }
}

// Initialize presets
loadPresetsFromServer();

// Debug tool event listeners
document.getElementById('exportPoseBtn').addEventListener('click', exportPose);
document.getElementById('refreshPoseBtn').addEventListener('click', updatePoseJSON);
document.getElementById('showAxesToggle').addEventListener('change', (e) => {
    showAxes = e.target.checked;
    updateBoneAxes();
});

// Preset event listeners
document.getElementById('savePresetBtn').addEventListener('click', savePreset);
document.getElementById('deletePresetBtn').addEventListener('click', deletePreset);
document.getElementById('presetSelect').addEventListener('change', () => {
    updatePresetButtonStates();
    // Auto-load when preset is selected
    const select = document.getElementById('presetSelect');
    if (select.value) {
        loadPreset();
    }
});
document.getElementById('presetName').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        savePreset();
    }
});

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    
    // Update bone axes positions if showing
    if (showAxes && boneAxes.length > 0) {
        updateBoneAxes();
    }
    
    renderer.render(scene, camera);
}
animate();

// Handle resize
function handleResize() {
    const container = document.getElementById('container');
    if (!container) return;
    
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    if (width > 0 && height > 0) {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    }
}

window.addEventListener('resize', handleResize);
// Also trigger resize when panes are resized (using ResizeObserver if available)
if (window.ResizeObserver) {
    const container = document.getElementById('container');
    if (container) {
        const resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(container);
    }
}

// Image loading
let loadedImage = null;

document.getElementById('loadImageBtn').addEventListener('click', () => {
    document.getElementById('imageUpload').click();
});

document.getElementById('imageUpload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            const container = document.getElementById('image-container');
            container.innerHTML = '';
            container.appendChild(img);
            loadedImage = img;
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});
