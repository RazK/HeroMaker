import * as THREE from 'three';

/**
 * CameraController - Handles camera movements and smooth interpolations
 */
export class CameraController {
    constructor(camera) {
        this.camera = camera;
        this.targetPosition = new THREE.Vector3();
        this.targetRotation = new THREE.Euler();
        this.isTransitioning = false;
        this.transitionDuration = 1.5; // seconds
        this.transitionProgress = 0;
        this.easing = this.easeInOutCubic;
        
        // Initialize with current camera position
        this.targetPosition.copy(camera.position);
        this.targetRotation.copy(camera.rotation);
    }
    
    /**
     * Smooth interpolation function (ease-in-out cubic)
     */
    easeInOutCubic(t) {
        return t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }
    
    /**
     * Set camera target position and rotation
     */
    setTarget(position, rotation, duration = null) {
        this.targetPosition.copy(position);
        if (rotation) {
            this.targetRotation.copy(rotation);
        }
        
        if (duration !== null) {
            this.transitionDuration = duration;
        }
        
        this.isTransitioning = true;
        this.transitionProgress = 0;
    }
    
    /**
     * Update camera position (call in animation loop)
     */
    update(delta) {
        if (!this.isTransitioning) return;
        
        this.transitionProgress += delta / this.transitionDuration;
        
        if (this.transitionProgress >= 1) {
            // Transition complete
            this.camera.position.copy(this.targetPosition);
            this.camera.rotation.copy(this.targetRotation);
            this.isTransitioning = false;
            this.transitionProgress = 1;
        } else {
            // Interpolate position
            const eased = this.easing(this.transitionProgress);
            this.camera.position.lerp(this.targetPosition, eased);
            
            // Interpolate rotation
            this.camera.rotation.x = THREE.MathUtils.lerp(
                this.camera.rotation.x,
                this.targetRotation.x,
                eased
            );
            this.camera.rotation.y = THREE.MathUtils.lerp(
                this.camera.rotation.y,
                this.targetRotation.y,
                eased
            );
            this.camera.rotation.z = THREE.MathUtils.lerp(
                this.camera.rotation.z,
                this.targetRotation.z,
                eased
            );
        }
    }
    
    /**
     * Get camera configuration for a scene
     */
    static getSceneConfig(sceneName) {
        const configs = {
            lobby: {
                position: new THREE.Vector3(0, 5, 15),
                rotation: new THREE.Euler(-0.3, 0, 0),
                fov: 50
            },
            studio: {
                position: new THREE.Vector3(0, 10, 12),
                rotation: new THREE.Euler(-0.5, 0, 0),
                fov: 60
            },
            stage: {
                position: new THREE.Vector3(0, 2, 7),
                rotation: new THREE.Euler(0, 0, 0),
                fov: 50
            }
        };
        
        return configs[sceneName] || configs.lobby;
    }
}
