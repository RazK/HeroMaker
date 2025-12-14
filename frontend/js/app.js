import * as THREE from 'three';
import { Renderer } from './core/Renderer.js';
import { SceneManager } from './core/SceneManager.js';
import { api } from './api.js';

/**
 * Main Application Entry Point
 */
class App {
    constructor() {
        this.renderer = null;
        this.sceneManager = null;
        this.camera = null;
        this.clock = new THREE.Clock();
        this.isRunning = false;
    }
    
    async init() {
        console.log('Initializing HeroMaker...');
        
        // Get container
        const container = document.getElementById('canvas-container');
        if (!container) {
            throw new Error('Canvas container not found');
        }
        
        // Create renderer
        this.renderer = new Renderer(container);
        
        // Create camera
        this.camera = new THREE.PerspectiveCamera(
            50,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 5, 15);
        
        // Create scene manager
        this.sceneManager = new SceneManager(this.renderer, this.camera);
        this.renderer.setCamera(this.camera);
        
        // Initialize API
        try {
            const user = await api.getCurrentUser();
            console.log('Current user:', user);
        } catch (error) {
            console.warn('API initialization failed (using mock mode):', error);
        }
        
        // Register placeholder scenes (will be implemented in Phase 2)
        // For now, create a simple test scene
        this.createTestScene();
        
        // Start render loop
        this.start();
        
        console.log('HeroMaker initialized');
    }
    
    createTestScene() {
        // Create a simple test scene to verify everything works
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0a0a);
        
        // Add basic lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 10, 5);
        scene.add(directionalLight);
        
        // Add a test cube
        const geometry = new THREE.BoxGeometry(2, 2, 2);
        const material = new THREE.MeshStandardMaterial({ color: 0x13a3f3 });
        const cube = new THREE.Mesh(geometry, material);
        cube.position.y = 1;
        scene.add(cube);
        
        // Add a ground plane
        const planeGeometry = new THREE.PlaneGeometry(20, 20);
        const planeMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x1a1a1a,
            metalness: 0.3,
            roughness: 0.8
        });
        const plane = new THREE.Mesh(planeGeometry, planeMaterial);
        plane.rotation.x = -Math.PI / 2;
        plane.receiveShadow = true;
        scene.add(plane);
        
        // Set scene
        this.renderer.setScene(scene);
    }
    
    start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        const animate = () => {
            if (!this.isRunning) return;
            
            const delta = this.clock.getDelta();
            
            // Update scene manager
            if (this.sceneManager) {
                this.sceneManager.update(delta);
            }
            
            // Renderer handles its own loop
            requestAnimationFrame(animate);
        };
        
        this.renderer.start();
        animate();
    }
    
    stop() {
        this.isRunning = false;
        if (this.renderer) {
            this.renderer.stop();
        }
    }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        const app = new App();
        app.init().catch(console.error);
    });
} else {
    const app = new App();
    app.init().catch(console.error);
}
