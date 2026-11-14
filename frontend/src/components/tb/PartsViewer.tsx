import { ReactNode, Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';

/** Colours to tell the parts apart: the plates, then the sun and grape. */
const PART_TINTS = ['#e9e3ff', '#ffe9a8', '#cff5ea', '#ffdcc7', '#d6ecff', '#ffd6e7', '#ffc233', '#5b3df5'];
/** How far a part travels when fully pulled apart, as a share of its distance from the middle. */
const OUT = 0.6;
/** Where the camera stands; zooming is clamped so it never comes closer (all of it always fits). */
const CAMERA_Z = 2.6;

/**
 * A hero cut into printable parts (backend print_split.py), in 3D: `apart`
 * (0-1) pulls the parts away from the middle, `tinted` colours each part its
 * own, and `moving` swings the arms and legs about their joints, the way the
 * printed toy moves (only when `jointed`: the parts were cut with joints).
 * Used by the admin split sheet (PrintSplit.tsx) and the hero page's action
 * figure slide (ActionFigure.tsx). Its own chunk: three's React bindings load
 * only when parts are shown.
 */
export function PartsStage({ url, apart, tinted = false, spin = false, jointed = false, moving = false }: {
  url: string;
  apart: number;
  tinted?: boolean;
  /** Turn slowly by itself instead of by dragging: on a carousel slide a
   *  drag is a swipe (HeroLive), as it is over the live hero. */
  spin?: boolean;
  /** The parts were cut with joints (Hi3D ball joints): limbs may move. */
  jointed?: boolean;
  /** Swing the arms and legs about their joint centres. */
  moving?: boolean;
}) {
  return (
    <Canvas camera={{ position: [0, 0, CAMERA_Z], fov: 40 }} dpr={[1, 2]}>
      <hemisphereLight args={['#ffffff', '#b9aee0', 2.2]} />
      <directionalLight position={[2, 3, 4]} intensity={2.4} />
      <directionalLight position={[-3, 1, -2]} intensity={1} />
      <Suspense fallback={<Html center><div className="tb-ring tb-parts-loading" style={{ ['--p' as string]: '25%' }}><span>…</span></div></Html>}>
        <Turntable on={spin}><Parts url={url} apart={apart} tinted={tinted} moving={jointed && moving} /></Turntable>
      </Suspense>
      {/* Zoom out only: the parts are framed to fit pulled fully apart, so a
          pinch never crops them at the stage's edges. */}
      {!spin && <OrbitControls enablePan={false} minDistance={CAMERA_Z} maxDistance={6} />}
    </Canvas>
  );
}

export default PartsStage;

/** A slow turn, one round in about 14 s, so every side of the parts shows. */
function Turntable({ on, children }: { on: boolean; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (on && group.current) group.current.rotation.y += dt * 0.45;
  });
  return <group ref={group}>{children}</group>;
}

type Limb = 'arm-r' | 'arm-l' | 'leg-r' | 'leg-l' | null;
interface Part {
  mesh: THREE.Mesh;
  /** Joint pieces (a ball or a socket) that belong to this part and move with it. */
  pieces: THREE.Mesh[];
  pieceMaterials: (THREE.Material | THREE.Material[])[];
  /** Holds the part at its joint centre (parent space): rotating it turns the part about the joint. */
  pivot: THREE.Group;
  home: THREE.Vector3;
  out: THREE.Vector3;
  limb: Limb;
  material: THREE.Material | THREE.Material[];
}

/**
 * Which part is which, read from where the parts sit in a T-pose (Y up, the
 * figure facing +Z): the arms are the parts far out to the sides; of the
 * rest, the torso is the one the arms meet, and the legs hang below it. A
 * limb's joint is the centre of its bounding box's face towards the torso:
 * the inner end of an arm, the top of a leg. Anything not recognised stays
 * still.
 */
function classify(boxes: THREE.Box3[]): { limb: Limb; joint: THREE.Vector3 }[] {
  const all = boxes.reduce((b, x) => b.union(x), new THREE.Box3());
  const half = Math.max(1e-6, (all.max.x - all.min.x) / 2);
  const mid = all.getCenter(new THREE.Vector3());
  const centres = boxes.map((b) => b.getCenter(new THREE.Vector3()));
  const isArm = centres.map((c) => Math.abs(c.x - mid.x) > 0.45 * half);
  const inner = (j: number) => new THREE.Vector3(centres[j].x > mid.x ? boxes[j].min.x : boxes[j].max.x, centres[j].y, centres[j].z);
  const reach = (i: number) => boxes.reduce((s, _, j) => (isArm[j] ? s + boxes[i].distanceToPoint(inner(j)) : s), 0);
  // The torso: of the middle parts, the one nearest the arms' inner ends
  // (no arms: the middle one by height).
  const middle = boxes.map((_, i) => i).filter((i) => !isArm[i]);
  let torso = -1;
  if (middle.length && isArm.some(Boolean)) torso = middle.reduce((best, i) => (best < 0 || reach(i) < reach(best) ? i : best), -1);
  else if (middle.length) {
    const byY = [...middle].sort((a, b) => centres[b].y - centres[a].y);
    torso = byY[Math.floor(byY.length / 2)];
  }
  return boxes.map((b, i) => {
    const c = centres[i];
    if (isArm[i]) return { limb: c.x > mid.x ? 'arm-r' : 'arm-l', joint: inner(i) };
    // A leg: below the torso's middle, its top no higher than a bit into the torso.
    if (torso >= 0 && i !== torso && c.y < centres[torso].y
        && b.max.y <= centres[torso].y + 0.25 * (boxes[torso].max.y - boxes[torso].min.y)) {
      return { limb: c.x > mid.x ? 'leg-r' : 'leg-l', joint: new THREE.Vector3(c.x, b.max.y, c.z) };
    }
    return { limb: null, joint: c.clone() };
  });
}

/** The split model, centred and sized, each part pushed out from the middle by `apart`. */
function Parts({ url, apart, tinted, moving }: { url: string; apart: number; tinted: boolean; moving: boolean }) {
  const gltf = useLoader(GLTFLoader, url);
  const { root, parts } = useMemo(() => {
    const root = gltf.scene.clone(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // Sized for the parts fully pulled apart (each moves out by up to OUT of
    // its distance from the middle), so the slider never pushes one off screen.
    const scale = 1.75 / (Math.max(size.x, size.y, size.z || 1) * (1 + OUT));
    root.position.copy(center.clone().multiplyScalar(-scale));
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);
    const all: THREE.Mesh[] = [];
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) all.push(o as THREE.Mesh); });
    // Split parts can come without normals, and unlit-from-every-side is
    // what three.js draws then: a dark silhouette.
    all.forEach((m) => { if (!m.geometry.getAttribute('normal')) m.geometry.computeVertexNormals(); });
    // Hi3D sends each joint's ball and socket as meshes of their own
    // (connector_###_ball_male / _female). They are not parts: each goes with
    // the body part it sits in, or it floats off on its own when pulled apart.
    const meshes = all.filter((m) => !isPiece(m));
    const pieces = all.filter(isPiece);
    const boxes = meshes.map((m) => new THREE.Box3().setFromObject(m));
    const roles = classify(boxes);
    const middle = boxes.reduce((b, x) => b.union(x), new THREE.Box3()).getCenter(new THREE.Vector3());
    const list: Part[] = meshes.map((mesh, i) => {
      const parent = mesh.parent!;
      // The joint, in the parent's space: a pivot stands there and the part hangs off it.
      const joint = parent.worldToLocal(roles[i].joint.clone());
      const pivot = new THREE.Group();
      pivot.position.copy(joint);
      parent.add(pivot);
      pivot.updateMatrixWorld(true);
      pivot.attach(mesh);
      // Pulling apart moves the pivot (and so the part) out from the middle, in the parent's units.
      const push = boxes[i].getCenter(new THREE.Vector3()).sub(middle);
      if (push.lengthSq() < 1e-9) push.set(0, 1, 0);
      const from = boxes[i].getCenter(new THREE.Vector3());
      const to = from.clone().addScaledVector(push, OUT);
      const out = parent.worldToLocal(to).sub(parent.worldToLocal(from));
      return { mesh, pivot, pieces: [], pieceMaterials: [], home: joint.clone(), out, limb: roles[i].limb, material: mesh.material };
    });
    pieces.forEach((piece) => {
      const owner = ownerOf(new THREE.Box3().setFromObject(piece), boxes, roles.map((r) => r.limb), /_male\b/i.test(piece.name));
      if (owner < 0) return;
      list[owner].pivot.attach(piece);  // keeps it where it is, now moving with its part
      list[owner].pieces.push(piece);
      list[owner].pieceMaterials.push(piece.material);
    });
    return { root, parts: list };
  }, [gltf]);

  const tints = useRef<THREE.Material[]>([]);
  useEffect(() => {
    tints.current = parts.map((_, i) => new THREE.MeshStandardMaterial({ color: PART_TINTS[i % PART_TINTS.length], roughness: 0.7 }));
    return () => tints.current.forEach((m) => m.dispose());
  }, [parts]);

  useEffect(() => {
    parts.forEach((p, i) => {
      p.pivot.position.copy(p.home).addScaledVector(p.out, apart);
      p.mesh.material = tinted ? tints.current[i] : p.material;
      p.pieces.forEach((piece, k) => { piece.material = tinted ? tints.current[i] : p.pieceMaterials[k]; });
    });
  }, [parts, apart, tinted]);

  // The toy's moves: the arms swing down from the T-pose and up again, one
  // after the other, and the legs step, each about its own joint centre.
  // Stopping eases every limb back to where it was cut.
  const t = useRef(0);
  useFrame((_, dt) => {
    t.current = moving ? t.current + dt : 0;
    const s = t.current * 2.4;
    const on = moving ? 1 : 0;
    for (const p of parts) {
      const r = p.pivot.rotation;
      if (p.limb === 'arm-r') r.z = THREE.MathUtils.damp(r.z, on * -(0.55 + 0.55 * Math.sin(s)), 8, dt);
      else if (p.limb === 'arm-l') r.z = THREE.MathUtils.damp(r.z, on * (0.55 + 0.55 * Math.sin(s + Math.PI)), 8, dt);
      else if (p.limb === 'leg-r') r.x = THREE.MathUtils.damp(r.x, on * 0.45 * Math.sin(s), 8, dt);
      else if (p.limb === 'leg-l') r.x = THREE.MathUtils.damp(r.x, on * -0.45 * Math.sin(s), 8, dt);
    }
  });

  return <primitive object={root} />;
}

/** A joint piece, not a part: Hi3D names them connector_###_ball_male / _female. */
function isPiece(m: THREE.Mesh): boolean {
  return /^connector_/i.test(m.name) || /^connector_/i.test(m.parent?.name || '');
}

/**
 * The body part a joint piece belongs to: the one its box overlaps most (it
 * sits in the cut between two parts, and overlaps the one it is part of more),
 * else the nearest. A ball (male) goes with a limb when a limb overlaps it
 * about as much as the other part does: balls are on the limbs.
 */
function ownerOf(box: THREE.Box3, boxes: THREE.Box3[], limbs: Limb[], male: boolean): number {
  if (!boxes.length) return -1;
  const overlap = boxes.map((b) => {
    const i = box.clone().intersect(b);
    if (i.isEmpty()) return 0;
    const s = i.getSize(new THREE.Vector3());
    return s.x * s.y * s.z;
  });
  const best = overlap.reduce((m, v, i) => (v > overlap[m] ? i : m), 0);
  if (overlap[best] > 0) {
    if (male && !limbs[best]) {
      const limb = overlap.reduce((m, v, i) => (limbs[i] && v > 0 && (m < 0 || v > overlap[m]) ? i : m), -1);
      if (limb >= 0 && overlap[limb] >= 0.5 * overlap[best]) return limb;
    }
    return best;
  }
  const centre = box.getCenter(new THREE.Vector3());
  return boxes.reduce((m, b, i) => (b.distanceToPoint(centre) < boxes[m].distanceToPoint(centre) ? i : m), 0);
}
