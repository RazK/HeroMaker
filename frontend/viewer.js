import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1, 3);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('container').appendChild(renderer.domElement);

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

// Pose definitions
const APOSE = {
  "Head": { "x": 71.36318261698293, "y": 0.4241412773754582, "z": 0.7767577363531508 },
  "head_end": { "x": -26.39168018969181, "y": 0.03720568535914297, "z": -0.15867444937338288 },
  "headfront": { "x": 26.450866298759397, "y": 0.037378190383607346, "z": 0.15900464551875823 },
  "Hips": { "x": 7.79339251411141, "y": 0.26695501728665333, "z": 0.23290691342083802 },
  "LeftArm": { "x": 73.12478913062147, "y": 72.20438487974839, "z": -5.224218974655768 },
  "LeftFoot": { "x": -61.195165740150095, "y": -5.358768774238057, "z": -6.105455730603098 },
  "LeftForeArm": { "x": -22.11164133896093, "y": 2.2825876594077688, "z": 14.354930682521493 },
  "LeftHand": { "x": -0.31647784542779367, "y": 18.49713749003286, "z": 27.09596667514471 },
  "LeftLeg": { "x": 17.537915010176185, "y": 7.187154367023984, "z": 3.0345166694034003 },
  "LeftShoulder": { "x": 98.33242946663009, "y": 0.07076058842184585, "z": -94.19890340100162 },
  "LeftToeBase": { "x": -42.887514984174004, "y": -4.503021282797755, "z": -4.170876850248275 },
  "LeftUpLeg": { "x": 168.2178547161373, "y": -8.715069212174619, "z": -9.291325691421868 },
  "neck": { "x": 0.5183128431438504, "y": 0.6928907778591643, "z": -0.6037417610465206 },
  "RightArm": { "x": 70.68756890073249, "y": -71.50845847964705, "z": 3.1437078913726597 },
  "RightFoot": { "x": -63.14598254822018, "y": 5.392330713412872, "z": 10.565461162687043 },
  "RightForeArm": { "x": -20.52903960940714, "y": -4.927802522334809, "z": -17.268727939894898 },
  "RightHand": { "x": -4.4492450037294375, "y": -15.55482472510266, "z": -25.25070803600831 },
  "RightLeg": { "x": 17.14451929638346, "y": -9.361853663151667, "z": -4.804077582980139 },
  "RightShoulder": { "x": 98.33244815297785, "y": 0.0707566242513941, "z": 94.07256321304425 },
  "RightToeBase": { "x": -41.03180406613524, "y": 4.90640510088091, "z": 4.25678344136294 },
  "RightUpLeg": { "x": 168.2378711669004, "y": 9.113690218359093, "z": 9.814189825791622 },
  "Spine": { "x": -0.5105280330185218, "y": -0.2588418323750072, "z": 0.22113832302156203 },
  "Spine01": { "x": 0.000006830346314860216, "y": -1.000516031455257e-8, "z": 2.001032361094423e-8 },
  "Spine02": { "x": -15.613391836920052, "y": 0.1326551804061113, "z": -0.5813851386147403 }
};

const TPOSE = {
  "Head": { "x": 71.36318261698293, "y": 0.4241412773754582, "z": 0.7767577363531508 },
  "head_end": { "x": -26.39168018969181, "y": 0.03720568535914297, "z": -0.15867444937338288 },
  "headfront": { "x": 26.450866298759397, "y": 0.037378190383607346, "z": 0.15900464551875823 },
  "Hips": { "x": 7.79339251411141, "y": 0.26695501728665333, "z": 0.23290691342083802 },
  "LeftArm": { "x": 4, "y": 75.00000000000001, "z": -5.224218974655768 },
  "LeftFoot": { "x": -61.195165740150095, "y": -5.358768774238057, "z": -6.105455730603098 },
  "LeftForeArm": { "x": -22.11164133896093, "y": 2.2825876594077688, "z": 14.354930682521493 },
  "LeftHand": { "x": -0.31647784542779367, "y": 18.49713749003286, "z": 27.09596667514471 },
  "LeftLeg": { "x": 17.537915010176185, "y": 7.187154367023984, "z": 3.0345166694034003 },
  "LeftShoulder": { "x": 98.33242946663009, "y": 0.07076058842184585, "z": -94.19890340100162 },
  "LeftToeBase": { "x": -42.887514984174004, "y": -4.503021282797755, "z": -4.170876850248275 },
  "LeftUpLeg": { "x": 168.2178547161373, "y": -8.715069212174619, "z": -9.291325691421868 },
  "neck": { "x": 0.5183128431438504, "y": 0.6928907778591643, "z": -0.6037417610465206 },
  "RightArm": { "x": 0, "y": -71.50845847964705, "z": 3.1437078913726597 },
  "RightFoot": { "x": -63.14598254822018, "y": 5.392330713412872, "z": 10.565461162687043 },
  "RightForeArm": { "x": -20.52903960940714, "y": -4.927802522334809, "z": -17.268727939894898 },
  "RightHand": { "x": -4.4492450037294375, "y": -15.55482472510266, "z": -25.25070803600831 },
  "RightLeg": { "x": 17.14451929638346, "y": -9.361853663151667, "z": -4.804077582980139 },
  "RightShoulder": { "x": 98.33244815297785, "y": 0.0707566242513941, "z": 94.07256321304425 },
  "RightToeBase": { "x": -41.03180406613524, "y": 4.90640510088091, "z": 4.25678344136294 },
  "RightUpLeg": { "x": 168.2378711669004, "y": 9.113690218359093, "z": 9.814189825791622 },
  "Spine": { "x": -0.5105280330185218, "y": -0.2588418323750072, "z": 0.22113832302156203 },
  "Spine01": { "x": 0.000006830346314860216, "y": -1.000516031455257e-8, "z": 2.001032361094423e-8 },
  "Spine02": { "x": -15.613391836920052, "y": 0.1326551804061113, "z": -0.5813851386147403 }
};

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

// Reset to T-pose
function resetToTPose() {
    applyPose(TPOSE);
}

// Reset to A-pose
function resetToAPose() {
    applyPose(APOSE);
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

// Copy pose JSON to clipboard
function copyPoseJSON() {
    const pose = getCurrentPose();
    if (!pose) return;
    
    const json = JSON.stringify(pose, null, 2);
    navigator.clipboard.writeText(json).then(() => {
        const btn = document.getElementById('copyPoseBtn');
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
    });
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
    document.getElementById('resetTposeBtn').disabled = false;
    document.getElementById('resetAposeBtn').disabled = false;
    document.getElementById('exportPoseBtn').disabled = false;
    document.getElementById('copyPoseBtn').disabled = false;
    document.getElementById('refreshPoseBtn').disabled = false;
    document.getElementById('showAxesToggle').disabled = false;
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

// Debug tool event listeners
document.getElementById('resetTposeBtn').addEventListener('click', resetToTPose);
document.getElementById('resetAposeBtn').addEventListener('click', resetToAPose);
document.getElementById('exportPoseBtn').addEventListener('click', exportPose);
document.getElementById('copyPoseBtn').addEventListener('click', copyPoseJSON);
document.getElementById('refreshPoseBtn').addEventListener('click', updatePoseJSON);
document.getElementById('showAxesToggle').addEventListener('change', (e) => {
    showAxes = e.target.checked;
    updateBoneAxes();
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
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
