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
        }
    });
    
    if (hasSkeleton) {
        skeletonHelper = new THREE.SkeletonHelper(model);
        skeletonHelper.visible = showSkeleton;
        scene.add(skeletonHelper);
    }
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

            // Add new model
            model = gltf.scene;
            scene.add(model);
            
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

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}
animate();

// Handle resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

