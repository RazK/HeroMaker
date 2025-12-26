import { Suspense, useRef, useEffect, useState, ErrorInfo, Component } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import './ModelPreview.css';

interface ModelPreviewProps {
  url: string;
  walkingUrl?: string | null;
  riggedUrl?: string | null;
  className?: string;
  isRigged?: boolean;
}

// Error boundary for model loading errors - must be outside Canvas
class ModelErrorBoundary extends Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; fallback?: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ModelPreview] Error loading model:', error, errorInfo);
  }

  componentDidUpdate(prevProps: { children: React.ReactNode }) {
    // Reset error state when children change (new URL)
    if (prevProps.children !== this.props.children) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          height: '100%',
          color: '#999',
          fontSize: '14px',
          minHeight: '400px'
        }}>
          Model file not available
        </div>
      );
    }
    return this.props.children;
  }
}

function Model({ url, showSkeleton, isRotating, resetTrigger, isAnimated, isAnimationPlaying }: { url: string; showSkeleton?: boolean; isRotating: boolean; resetTrigger: number; isAnimated: boolean; isAnimationPlaying: boolean }) {
  const gltf = useLoader(GLTFLoader, url);
  const meshRef = useRef<THREE.Group>(null);
  const skeletonGroupRef = useRef<THREE.Group | null>(null);
  const bonesRef = useRef<THREE.Bone[] | null>(null);
  const modelScaleRef = useRef<number | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<THREE.AnimationAction[]>([]);

  useEffect(() => {
    // Reset model rotation when resetTrigger changes
    if (meshRef.current && resetTrigger > 0) {
      meshRef.current.rotation.y = 0;
    }
  }, [resetTrigger]);

  // Setup animation mixer when animations exist and isAnimated is true
  useEffect(() => {
    if (gltf.animations.length > 0 && isAnimated && gltf.scene) {
      mixerRef.current = new THREE.AnimationMixer(gltf.scene);
      actionsRef.current = [];
      gltf.animations.forEach((clip) => {
        const action = mixerRef.current?.clipAction(clip);
        if (action) {
          action.loop = THREE.LoopRepeat;
          actionsRef.current.push(action);
          if (isAnimationPlaying) {
            action.play();
          }
        }
      });
    } else {
      if (mixerRef.current) {
        mixerRef.current.stopAllAction();
        mixerRef.current = null;
      }
      actionsRef.current = [];
    }
    return () => {
      if (mixerRef.current) {
        mixerRef.current.stopAllAction();
        mixerRef.current = null;
      }
      actionsRef.current = [];
    };
  }, [gltf, isAnimated]);

  // Pause/play animation based on isAnimationPlaying
  useEffect(() => {
    if (mixerRef.current && isAnimated && actionsRef.current.length > 0) {
      actionsRef.current.forEach(action => {
        if (isAnimationPlaying) {
          action.paused = false;
          if (!action.isRunning()) {
            action.play();
          }
        } else {
          action.paused = true;
        }
      });
    }
  }, [isAnimationPlaying, isAnimated]);

  useFrame((_state, delta) => {
    if (meshRef.current && isRotating) {
      // Slow rotation for both 3D model and rigged scenes
      meshRef.current.rotation.y += 0.005;
    }
    // Update animation mixer (only if playing)
    if (mixerRef.current && isAnimated && isAnimationPlaying) {
      mixerRef.current.update(delta);
    }
    // Update skeleton cones positions to follow bone movements
    // Convert bone world positions to local positions relative to scene (same as model)
    // Must account for scene rotation, scale, and position when converting
    if (showSkeleton && skeletonGroupRef.current && bonesRef.current && gltf.scene) {
      bonesRef.current.forEach((bone, index) => {
        const cone = skeletonGroupRef.current?.children[index] as THREE.Mesh | undefined;
        if (cone) {
          const worldPos = new THREE.Vector3();
          bone.getWorldPosition(worldPos);
          
          // Convert world position to local position relative to scene
          // Use worldToLocal to properly account for all transformations
          const localPos = gltf.scene.worldToLocal(worldPos.clone());
          
          cone.position.copy(localPos);
          
        }
      });
    }
  });

  useEffect(() => {
    // Center and scale the model - make it larger to fill more of the viewport
    if (gltf.scene && meshRef.current) {
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      // Increased scale from 2 to 3.5 to make model appear larger/closer
      const scale = 3.5 / maxDim;


      gltf.scene.scale.multiplyScalar(scale);
      gltf.scene.position.sub(center.multiplyScalar(scale));
      
      // Store the actual final scene scale (not the multiplier) for skeleton cone sizing
      // Use the X component as it should be uniform after scaling
      modelScaleRef.current = gltf.scene.scale.x;

    }
  }, [gltf]);

  useEffect(() => {
    // Add skeleton visualization with cones on bones
    if (showSkeleton && gltf.scene && !skeletonGroupRef.current) {
      const timeoutId = setTimeout(() => {
        gltf.scene.traverse((object) => {
          if (object instanceof THREE.SkinnedMesh && object.skeleton) {
            const skeleton = object.skeleton;
            const skeletonGroup = new THREE.Group();
            bonesRef.current = skeleton.bones;
            
            // Ensure the model mesh renders before the skeleton (lower renderOrder)
            if (object.renderOrder === undefined || object.renderOrder >= 1000) {
              object.renderOrder = 0;
            }
            
            // Create cones for each bone - treat them exactly like the model
            // Bones are already in the scaled scene, so we use their world positions
            // Convert world positions to local positions relative to the scene
            const modelScale = modelScaleRef.current ?? 1.0;
            
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/b89e3547-7de1-4c89-94c3-53229b5a026e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ModelPreview.tsx:85',message:'Creating skeleton cones (SIMPLIFIED)',data:{modelScale,sceneScaleX:gltf.scene.scale.x,scenePositionX:gltf.scene.position.x,scenePositionY:gltf.scene.position.y,scenePositionZ:gltf.scene.position.z,boneCount:skeleton.bones.length},timestamp:Date.now(),sessionId:'debug-session',runId:'simplified',hypothesisId:'B'})}).catch(()=>{});
            // #endregion
            
            skeleton.bones.forEach((bone) => {
              // Get bone world position (already scaled and positioned)
              const worldPos = new THREE.Vector3();
              bone.getWorldPosition(worldPos);
              
              // Convert world position to local position relative to scene
              // Since scene has scale and position, we need to account for that
              const localPos = worldPos.clone();
              localPos.sub(gltf.scene.position);
              localPos.divide(gltf.scene.scale);
              
              // Calculate bone length from joint to joint
              let boneLength = 0.04 * modelScale; // Default fallback size
              let childLocalPos: THREE.Vector3 | null = null;
              
              if (bone.children.length > 0 && bone.children[0] instanceof THREE.Bone) {
                const childBone = bone.children[0] as THREE.Bone;
                const childWorldPos = new THREE.Vector3();
                childBone.getWorldPosition(childWorldPos);
                childLocalPos = childWorldPos.clone();
                childLocalPos.sub(gltf.scene.position);
                childLocalPos.divide(gltf.scene.scale);
                
                // Calculate distance between bone and child bone (bone length)
                const direction = new THREE.Vector3().subVectors(childLocalPos, localPos);
                boneLength = direction.length();
              }
              
              // Create cone geometry - height spans full bone length, radius proportional
              const coneRadius = Math.max(0.005 * modelScale, boneLength * 0.1); // 10% of bone length, minimum 0.005
              const coneHeight = boneLength;
              
              const coneGeometry = new THREE.ConeGeometry(coneRadius, coneHeight, 8);
              const coneMaterial = new THREE.MeshBasicMaterial({ 
                color: 0x00ff00, 
                transparent: true,
                opacity: 0.9,
                depthTest: false,  // Render on top of model
                depthWrite: false  // Don't write to depth buffer
              });
              const cone = new THREE.Mesh(coneGeometry, coneMaterial);
              cone.renderOrder = 1000;  // Ensure cones render after the model
              
              cone.position.copy(localPos);
              
              
              // Orient cone along bone direction (if bone has a child bone)
              if (childLocalPos) {
                const direction = new THREE.Vector3().subVectors(childLocalPos, localPos);
                if (direction.length() > 0) {
                  direction.normalize();
                  cone.lookAt(localPos.clone().add(direction));
                  cone.rotateX(Math.PI / 2); // Rotate to align cone axis with bone direction
                }
              }
              
              skeletonGroup.add(cone);
            });
            
            // Set render order on the group itself to ensure it renders after the model
            skeletonGroup.renderOrder = 1000;
            
            skeletonGroupRef.current = skeletonGroup;
            gltf.scene.add(skeletonGroup);
            
            console.log('[ModelPreview] Skeleton cones created:', skeleton.bones.length);
          }
        });
      }, 300);

      return () => {
        clearTimeout(timeoutId);
        if (skeletonGroupRef.current && gltf.scene) {
          gltf.scene.remove(skeletonGroupRef.current);
          skeletonGroupRef.current.children.forEach((child) => {
            if (child instanceof THREE.Mesh) {
              child.geometry.dispose();
              if (child.material instanceof THREE.Material) {
                child.material.dispose();
              }
            }
          });
          skeletonGroupRef.current = null;
        }
      };
    }
  }, [gltf, showSkeleton]);

  return <primitive object={gltf.scene} ref={meshRef} />;
}

function CameraController({ 
  homePosition, 
  homeTarget,
  resetTrigger
}: { 
  homePosition: [number, number, number];
  homeTarget: [number, number, number];
  resetTrigger: number;
}) {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  const homePositionRef = useRef<THREE.Vector3>(new THREE.Vector3(...homePosition));
  const homeTargetRef = useRef<THREE.Vector3>(new THREE.Vector3(...homeTarget));
  const initialRotationRef = useRef<number>(0);

  useEffect(() => {
    // Store home position and target
    homePositionRef.current.set(...homePosition);
    homeTargetRef.current.set(...homeTarget);
    // Store initial rotation (should be 0)
    initialRotationRef.current = 0;
  }, [homePosition, homeTarget]);

  useEffect(() => {
    // Reset camera to home position when resetTrigger changes
    if (controlsRef.current && resetTrigger > 0) {
      camera.position.set(...homePosition);
      controlsRef.current.target.set(...homeTarget);
      controlsRef.current.update();
    }
  }, [resetTrigger, camera, homePosition, homeTarget]);

  return (
    <OrbitControls 
      ref={controlsRef}
      enablePan={true} 
      enableZoom={true} 
      enableRotate={true}
      minDistance={1.5}
      maxDistance={homePosition[2] > 7 ? 15 : 8}
      target={homeTarget}
      minPolarAngle={0}
      maxPolarAngle={Math.PI}
    />
  );
}

export function ModelPreview({ url, walkingUrl, riggedUrl, className = '', isRigged = false }: ModelPreviewProps) {
  const [isPlaying, setIsPlaying] = useState(true); // Controls both rotation and animation
  const [resetTrigger, setResetTrigger] = useState(0);
  
  // Always use walkingUrl if available (animated), otherwise use riggedUrl or url (static)
  const modelUrl = walkingUrl || riggedUrl || url;
  const isAnimated = !!walkingUrl; // True if we're showing the animated model
  
  // For model.glb: back off by another 20% (from 3.6 to 4.32)
  // For rigged.glb: camera higher and angled down to look from above
  const cameraPosition: [number, number, number] = isRigged 
    ? [0, 2, 8.0]  // Higher Y (2) to look down, further back Z (8.0)
    : [0, 0, 4.32];   // Another 20% further back (3.6 * 1.2 = 4.32)
  
  const cameraTarget: [number, number, number] = isRigged 
    ? [0, 1.6, 0] 
    : [0, 0, 0];

  const handleTogglePlay = () => {
    // Toggle both rotation and animation together
    setIsPlaying(!isPlaying);
  };

  const handleResetCamera = () => {
    setResetTrigger(prev => prev + 1);
  };

  return (
    <ModelErrorBoundary key={modelUrl}>
      <div className={`model-preview-container ${className}`}>
        <Canvas camera={{ position: cameraPosition, fov: 50 }}>
          <Suspense fallback={null}>
            <ambientLight intensity={0.5} />
            <directionalLight position={[10, 10, 5]} intensity={1} />
            <pointLight position={[-10, -10, -5]} intensity={0.5} />
            <Model url={modelUrl} showSkeleton={isRigged && !isAnimated} isRotating={isPlaying} resetTrigger={resetTrigger} isAnimated={isAnimated} isAnimationPlaying={isPlaying} />
            <CameraController 
              homePosition={cameraPosition}
              homeTarget={cameraTarget}
              resetTrigger={resetTrigger}
            />
          </Suspense>
        </Canvas>
        <div className="model-preview-overlay">
          <span>Drag to rotate • Scroll to zoom</span>
        </div>
        <button 
          className="model-preview-rotation-toggle"
          onClick={handleTogglePlay}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="10" y1="8" x2="10" y2="16"/>
              <line x1="14" y1="8" x2="14" y2="16"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <polygon points="10 8 16 12 10 16 10 8"/>
            </svg>
          )}
        </button>
        <button 
          className="model-preview-reset-camera"
          onClick={handleResetCamera}
          title="Reset camera to home position"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
            <path d="M21 3v5h-5"/>
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
            <path d="M3 21v-5h5"/>
          </svg>
        </button>
      </div>
    </ModelErrorBoundary>
  );
}






