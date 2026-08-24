import { Suspense, useRef, useEffect, useState, useMemo, ErrorInfo, Component } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneWithSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';
import './ModelPreview.css';

interface ModelPreviewProps {
  url: string;
  walkingUrl?: string | null;
  riggedUrl?: string | null;
  className?: string;
  isRigged?: boolean;
  interactive?: boolean;  // When false, disable mouse controls (for card previews)
  /** Called once with a still of the rendered model, for use as a thumbnail. */
  onSnapshot?: (dataUrl: string) => void;
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


/**
 * How much empty space to leave around the model. 1.0 is edge-to-edge; higher
 * values pull the camera back. Overridable per-page via ?frame= while we settle
 * on a value.
 */
const DEFAULT_FRAME_MARGIN = 1.12;

function frameMargin(): number {
  if (typeof window !== 'undefined') {
    const q = new URLSearchParams(window.location.search).get('frame');
    const parsed = q ? Number(q) : NaN;
    if (Number.isFinite(parsed) && parsed > 0.5 && parsed < 4) return parsed;
  }
  return DEFAULT_FRAME_MARGIN;
}

/**
 * Distance at which `box` exactly fills the viewport, for this camera's field
 * of view AND aspect ratio.
 *
 * The previous version used max(size.z * 2, size.y * 1.5, 3) with no aspect
 * term, so on a narrow stage - a phone - the model was pushed far further away
 * than it needed to be and rendered tiny inside a mostly empty canvas.
 */
function fitDistance(camera: THREE.PerspectiveCamera, size: THREE.Vector3): number {
  const vFov = (camera.fov * Math.PI) / 180;
  const fitHeight = size.y / 2 / Math.tan(vFov / 2);
  const fitWidth = size.x / 2 / (Math.tan(vFov / 2) * camera.aspect);
  // Half the depth keeps the near face of the model out of the camera.
  return Math.max(fitHeight, fitWidth) * frameMargin() + size.z / 2;
}

/**
 * Grabs a single still of the canvas once the model has settled.
 *
 * The rigged model has no image on disk, so without this its rail tile has to
 * borrow the AI render and ends up identical to the tile next to it. The stage
 * has already loaded and drawn the model, so a snapshot costs one readback
 * rather than a second download.
 */
/** Set once the model has loaded and the camera has framed it. */
const modelFramedRef = { current: false };

/**
 * Trim the transparent surround off a canvas readback.
 *
 * The stage is landscape and the character is an upright figure in the middle
 * of it, so a raw snapshot is mostly empty pixels. Dropped into a portrait rail
 * tile it letterboxed down to a figure a few pixels tall. Cropping to what was
 * actually drawn means the tile shows the hero at tile size.
 *
 * Returns null if the readback is blank or unreadable, so the caller can fall
 * back to the full frame.
 */
function cropToSubject(source: HTMLCanvasElement): string | null {
  const w = source.width;
  const h = source.height;
  if (!w || !h) return null;

  const work = document.createElement('canvas');
  work.width = w;
  work.height = h;
  const ctx = work.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }

  let top = h, left = w, right = -1, bottom = -1;
  // Ignore near-transparent pixels: anti-aliased edges and any faint clear
  // colour would otherwise defeat the crop entirely.
  const ALPHA_FLOOR = 12;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] <= ALPHA_FLOOR) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left || bottom < top) return null;

  const pad = Math.round(Math.max(right - left, bottom - top) * 0.06);
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(w - 1, right + pad);
  bottom = Math.min(h - 1, bottom + pad);

  const out = document.createElement('canvas');
  out.width = right - left + 1;
  out.height = bottom - top + 1;
  const outCtx = out.getContext('2d');
  if (!outCtx) return null;
  outCtx.drawImage(work, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

function SnapshotOnce({ onSnapshot }: { onSnapshot?: (d: string) => void }) {
  const { gl, scene, camera } = useThree();
  const framesRef = useRef(0);
  const doneRef = useRef(false);

  useFrame(() => {
    if (doneRef.current || !onSnapshot) return;
    // Counting frames alone is not enough: a 7 MB model is still downloading
    // at frame 8, so the readback came back blank against real data. Wait
    // until the model has been measured and framed, then let a few frames
    // settle so lighting and the animation pose are in place.
    if (!modelFramedRef.current) return;
    if (++framesRef.current < 10) return;
    doneRef.current = true;
    try {
      gl.render(scene, camera);
      // PNG, not JPEG: the canvas is transparent, and JPEG has no alpha, so
      // the model would arrive on a black rectangle.
      const data = cropToSubject(gl.domElement) ?? gl.domElement.toDataURL('image/png');
      // A blank readback is worse than no thumbnail: it leaves an empty tile
      // where the borrowed render at least showed the character.
      if (data.length > 5000) onSnapshot(data);
    } catch {
      /* tainted or context-lost canvases simply produce no thumbnail */
    }
  });

  return null;
}

function Model({ url, showSkeleton, isRotating, resetTrigger, isAnimated, isAnimationPlaying }: { url: string; showSkeleton?: boolean; isRotating: boolean; resetTrigger: number; isAnimated: boolean; isAnimationPlaying: boolean }) {
  const gltf = useLoader(GLTFLoader, url);
  const { camera } = useThree();
  const meshRef = useRef<THREE.Group>(null);
  const skeletonGroupRef = useRef<THREE.Group | null>(null);
  const bonesRef = useRef<THREE.Bone[] | null>(null);
  const modelScaleRef = useRef<number | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<THREE.AnimationAction[]>([]);
  const clonedSceneRef = useRef<THREE.Group | null>(null);
  
  // Clone the scene on first render to avoid mutating the cached original
  // Use SkeletonUtils.clone for proper SkinnedMesh and animation support
  const scene = useMemo(() => {
    modelFramedRef.current = false;
    const cloned = cloneWithSkeleton(gltf.scene) as THREE.Group;
    clonedSceneRef.current = cloned;
    return cloned;
  }, [gltf.scene]);

  useEffect(() => {
    // Reset model rotation when resetTrigger changes
    if (meshRef.current && resetTrigger > 0) {
      meshRef.current.rotation.y = 0;
    }
  }, [resetTrigger]);

  // Setup animation mixer when animations exist and isAnimated is true
  useEffect(() => {
    if (gltf.animations.length > 0 && isAnimated && scene) {
      mixerRef.current = new THREE.AnimationMixer(scene);
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
  }, [gltf.animations, scene, isAnimated]);

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
    if (showSkeleton && skeletonGroupRef.current && bonesRef.current && scene) {
      bonesRef.current.forEach((bone, index) => {
        const cone = skeletonGroupRef.current?.children[index] as THREE.Mesh | undefined;
        if (cone) {
          const worldPos = new THREE.Vector3();
          bone.getWorldPosition(worldPos);
          
          // Convert world position to local position relative to scene
          // Use worldToLocal to properly account for all transformations
          const localPos = scene.worldToLocal(worldPos.clone());
          
          cone.position.copy(localPos);
          
        }
      });
    }
  });

  useEffect(() => {
    // Center and scale the model to fit in view
    if (scene && meshRef.current) {
      // Get original bounding box (precise=true for skinned meshes)
      const box = new THREE.Box3().setFromObject(scene, true);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      
      // Scale to fit in view
      const scale = 2.5 / maxDim;
      scene.scale.multiplyScalar(scale);
      
      // Center the model at origin (all axes)
      const scaledCenter = center.clone().multiplyScalar(scale);
      scene.position.set(-scaledCenter.x, -scaledCenter.y, -scaledCenter.z);
      
      // Now compute where the model's visual center actually is after positioning
      // Recalculate bounding box after transformations
      // Use precise=true to compute actual skinned mesh vertex positions
      scene.updateMatrixWorld(true);
      const finalBox = new THREE.Box3().setFromObject(scene, true);
      const finalCenter = finalBox.getCenter(new THREE.Vector3());
      
      // Store the center for CameraController to use
      modelCenterRef.current.copy(finalCenter);
      modelFramedRef.current = true;
      
      // Position camera based on bounding box dimensions
      const finalSize = finalBox.getSize(new THREE.Vector3());
      // Camera Y at center of box, Z at distance proportional to box size
      const cameraY = finalCenter.y;
      const cameraZ = fitDistance(camera as THREE.PerspectiveCamera, finalSize);
      camera.position.set(0, cameraY, cameraZ);
      
      // Store the home camera position for reset
      homeCameraPositionRef.current.set(0, cameraY, cameraZ);
      
      // Programmatically pan the camera to look at the model's actual center
      camera.lookAt(finalCenter);
      
      // Store the actual final scene scale for skeleton cone sizing
      modelScaleRef.current = scene.scale.x;
    }
  }, [scene, camera, isAnimated]);
  
  // For animated models, recenter camera after animation has started
  useEffect(() => {
    if (isAnimated && mixerRef.current && scene) {
      // Wait a moment for animation to update the mesh positions
      const timeoutId = setTimeout(() => {
        scene.updateMatrixWorld(true);
        const animatedBox = new THREE.Box3().setFromObject(scene, true);
        const animatedCenter = animatedBox.getCenter(new THREE.Vector3());
        
        // Store the center and re-position camera based on animated bounds
        modelCenterRef.current.copy(animatedCenter);
        
        const animatedSize = animatedBox.getSize(new THREE.Vector3());
        const cameraY = animatedCenter.y;
        const cameraZ = fitDistance(camera as THREE.PerspectiveCamera, animatedSize);
        camera.position.set(0, cameraY, cameraZ);
        
        // Store the home camera position for reset
        homeCameraPositionRef.current.set(0, cameraY, cameraZ);
        
        camera.lookAt(animatedCenter);
      }, 100);
      
      return () => clearTimeout(timeoutId);
    }
  }, [isAnimated, scene, camera]);

  useEffect(() => {
    // Add skeleton visualization with cones on bones
    if (showSkeleton && scene && !skeletonGroupRef.current) {
      const timeoutId = setTimeout(() => {
        scene.traverse((object) => {
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
            
            skeleton.bones.forEach((bone) => {
              // Get bone world position (already scaled and positioned)
              const worldPos = new THREE.Vector3();
              bone.getWorldPosition(worldPos);
              
              // Convert world position to local position relative to scene
              // Since scene has scale and position, we need to account for that
              const localPos = worldPos.clone();
              localPos.sub(scene.position);
              localPos.divide(scene.scale);
              
              // Calculate bone length from joint to joint
              let boneLength = 0.04 * modelScale; // Default fallback size
              let childLocalPos: THREE.Vector3 | null = null;
              
              if (bone.children.length > 0 && bone.children[0] instanceof THREE.Bone) {
                const childBone = bone.children[0] as THREE.Bone;
                const childWorldPos = new THREE.Vector3();
                childBone.getWorldPosition(childWorldPos);
                childLocalPos = childWorldPos.clone();
                childLocalPos.sub(scene.position);
                childLocalPos.divide(scene.scale);
                
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
            scene.add(skeletonGroup);
          }
        });
      }, 300);

      return () => {
        clearTimeout(timeoutId);
        if (skeletonGroupRef.current && scene) {
          scene.remove(skeletonGroupRef.current);
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
  }, [scene, showSkeleton]);

  return <primitive object={scene} ref={meshRef} />;
}

// Shared ref for the calculated model center and home camera position
const modelCenterRef = { current: new THREE.Vector3(0, 0, 0) };
const homeCameraPositionRef = { current: new THREE.Vector3(0, 0, 5) };

function CameraController({ 
  homePosition: _homePosition, 
  homeTarget,
  resetTrigger,
  interactive = true
}: { 
  homePosition: [number, number, number];
  homeTarget: [number, number, number];
  resetTrigger: number;
  interactive?: boolean;
}) {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  const hasSetInitialTarget = useRef(false);

  // Update controls target to match model center
  useFrame(() => {
    if (controlsRef.current && !hasSetInitialTarget.current) {
      // Check if model center has been calculated (not at origin)
      const center = modelCenterRef.current;
      if (center.x !== 0 || center.y !== 0 || center.z !== 0) {
        controlsRef.current.target.copy(center);
        controlsRef.current.update();
        hasSetInitialTarget.current = true;
      }
    }
  });

  useEffect(() => {
    // Reset when resetTrigger changes
    if (controlsRef.current && resetTrigger > 0) {
      // Use stored home position (calculated when model was centered)
      camera.position.copy(homeCameraPositionRef.current);
      controlsRef.current.target.copy(modelCenterRef.current);
      controlsRef.current.update();
    }
  }, [resetTrigger, camera]);

  // Don't render controls if not interactive
  if (!interactive) {
    return null;
  }

  return (
    <OrbitControls 
      ref={controlsRef}
      enablePan={true} 
      enableZoom={true} 
      enableRotate={true}
      minDistance={1.5}
      maxDistance={12}
      target={homeTarget}
      minPolarAngle={0}
      maxPolarAngle={Math.PI}
    />
  );
}

export function ModelPreview({ url, walkingUrl, riggedUrl, className = '', isRigged = false, interactive = true, onSnapshot }: ModelPreviewProps) {
  const [isPlaying, setIsPlaying] = useState(true); // Controls both rotation and animation
  const [resetTrigger, setResetTrigger] = useState(0);
  
  // Always use walkingUrl if available (animated), otherwise use riggedUrl or url (static)
  const modelUrl = walkingUrl || riggedUrl || url;
  const isAnimated = !!walkingUrl; // True if we're showing the animated model
  
  // Camera position - model will auto-center and camera will lookAt the center
  const cameraPosition: [number, number, number] = [0, 0, 5];
  const cameraTarget: [number, number, number] = [0, 0, 0];

  const handleTogglePlay = () => {
    // Toggle both rotation and animation together
    setIsPlaying(!isPlaying);
  };

  const handleResetCamera = () => {
    setResetTrigger(prev => prev + 1);
  };

  return (
    <ModelErrorBoundary key={modelUrl}>
      <div className={`model-preview-container ${className}${!interactive ? ' model-preview-non-interactive' : ''}`}>
        <Canvas
          camera={{ position: cameraPosition, fov: 50 }}
          /* Required for toDataURL: without it the drawing buffer is cleared
             before we can read it back. */
          gl={{ preserveDrawingBuffer: Boolean(onSnapshot) }}
        >
          <SnapshotOnce onSnapshot={onSnapshot} />
          <Suspense fallback={null}>
            <ambientLight intensity={0.5} />
            <directionalLight position={[10, 10, 5]} intensity={1} />
            <pointLight position={[-10, -10, -5]} intensity={0.5} />
            <Model url={modelUrl} showSkeleton={isRigged && !isAnimated} isRotating={isPlaying} resetTrigger={resetTrigger} isAnimated={isAnimated} isAnimationPlaying={isPlaying} />
            <CameraController 
              homePosition={cameraPosition}
              homeTarget={cameraTarget}
              resetTrigger={resetTrigger}
              interactive={interactive}
            />
          </Suspense>
        </Canvas>
        {interactive && (
          <>
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
          </>
        )}
      </div>
    </ModelErrorBoundary>
  );
}






