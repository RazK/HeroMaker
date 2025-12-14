import * as THREE from 'three';
import { CameraController } from './CameraController.js';

/**
 * SceneManager - Orchestrates scene switching and lifecycle
 */
export class SceneManager {
    constructor(renderer, camera) {
        this.renderer = renderer;
        this.camera = camera;
        this.cameraController = new CameraController(camera);
        this.currentScene = null;
        this.currentSceneName = null;
        this.scenes = new Map();
        
        // Scene transition state
        this.isTransitioning = false;
        this.transitionDuration = 1.5;
    }
    
    /**
     * Register a scene
     */
    registerScene(name, sceneInstance) {
        this.scenes.set(name, sceneInstance);
    }
    
    /**
     * Switch to a scene with smooth transition
     */
    async switchTo(sceneName, transitionData = {}) {
        if (this.isTransitioning) {
            console.warn('Scene transition already in progress');
            return;
        }
        
        if (!this.scenes.has(sceneName)) {
            console.error(`Scene "${sceneName}" not found`);
            return;
        }
        
        this.isTransitioning = true;
        
        // Get target scene
        const targetScene = this.scenes.get(sceneName);
        
        // Fade out current scene
        if (this.currentScene && this.currentScene.onExit) {
            await this.currentScene.onExit();
        }
        
        // Get camera config for target scene
        const cameraConfig = CameraController.getSceneConfig(sceneName);
        
        // Update camera FOV if needed
        if (this.camera instanceof THREE.PerspectiveCamera) {
            this.camera.fov = cameraConfig.fov;
            this.camera.updateProjectionMatrix();
        }
        
        // Set camera target
        this.cameraController.setTarget(
            cameraConfig.position,
            cameraConfig.rotation,
            this.transitionDuration
        );
        
        // Switch scene
        this.currentScene = targetScene;
        this.currentSceneName = sceneName;
        this.renderer.setScene(targetScene.getThreeScene());
        
        // Initialize target scene
        if (targetScene.onEnter) {
            await targetScene.onEnter(transitionData);
        }
        
        // Wait for transition to complete
        await this.waitForTransition();
        
        this.isTransitioning = false;
    }
    
    /**
     * Wait for camera transition to complete
     */
    waitForTransition() {
        return new Promise((resolve) => {
            const checkTransition = () => {
                if (!this.cameraController.isTransitioning) {
                    resolve();
                } else {
                    requestAnimationFrame(checkTransition);
                }
            };
            checkTransition();
        });
    }
    
    /**
     * Update (call in animation loop)
     */
    update(delta) {
        // Update camera controller
        this.cameraController.update(delta);
        
        // Update current scene
        if (this.currentScene && this.currentScene.update) {
            this.currentScene.update(delta);
        }
    }
    
    /**
     * Get current scene name
     */
    getCurrentScene() {
        return this.currentSceneName;
    }
}
