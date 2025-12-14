import * as THREE from 'three';

/**
 * Renderer - Three.js WebGL renderer setup and management
 */
export class Renderer {
    constructor(container) {
        this.container = container;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.clock = new THREE.Clock();
        this.animationId = null;
        
        this.init();
    }
    
    init() {
        // Create WebGL renderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true
        });
        
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        // Append canvas to container
        this.container.appendChild(this.renderer.domElement);
        
        // Create default scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a0a);
        
        // Handle window resize
        window.addEventListener('resize', () => this.handleResize());
    }
    
    setScene(scene) {
        this.scene = scene;
    }
    
    setCamera(camera) {
        this.camera = camera;
    }
    
    handleResize() {
        if (!this.camera || !this.renderer) return;
        
        const width = window.innerWidth;
        const height = window.innerHeight;
        
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
    
    start() {
        const animate = () => {
            this.animationId = requestAnimationFrame(animate);
            
            const delta = this.clock.getDelta();
            
            // Render scene
            if (this.scene && this.camera) {
                this.renderer.render(this.scene, this.camera);
            }
        };
        
        animate();
    }
    
    stop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }
    
    dispose() {
        this.stop();
        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement && this.renderer.domElement.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
        }
    }
}
