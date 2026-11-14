import { ReactNode, Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
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
export function PartsStage({ url, apart, tinted = false, spin = false, jointed = false, moving = false,
  play }: {
  url: string;
  /** How far apart (0 together - 1 apart). With `play`, the target the parts ease to. */
  apart: number;
  tinted?: boolean;
  /** Turn slowly by itself instead of by dragging: on a carousel slide a
   *  drag is a swipe (HeroLive), as it is over the live hero. */
  spin?: boolean;
  /** The parts were cut with joints (Hi3D ball joints): limbs may move. */
  jointed?: boolean;
  /** Swing the arms and legs about their joint centres. */
  moving?: boolean;
  /** The toy view (ActionFigure.tsx): front-facing, framed to fill the
   *  stage, animated instead of dragged. Each counter bump plays its action
   *  once; `idle` sways and now and then strikes a small pose; `loop` plays
   *  together > apart > hover > together > pose by itself. */
  play?: { poseKey: number; spinKey: number; idle: boolean; loop: boolean };
}) {
  return (
    <Canvas camera={{ position: [0, 0, CAMERA_Z], fov: 40 }} dpr={[1, 2]}>
      <hemisphereLight args={['#ffffff', '#b9aee0', 2.2]} />
      <directionalLight position={[2, 3, 4]} intensity={2.4} />
      <directionalLight position={[-3, 1, -2]} intensity={1} />
      <Suspense fallback={<Html center><div className="tb-ring tb-parts-loading" style={{ ['--p' as string]: '25%' }}><span>…</span></div></Html>}>
        {play
          ? <Parts url={url} apart={apart} tinted={tinted} moving={false} jointed={jointed} play={play} />
          : <Turntable on={spin}><Parts url={url} apart={apart} tinted={tinted} moving={jointed && moving} jointed={jointed} /></Turntable>}
      </Suspense>
      {/* Zoom out only: the parts are framed to fit pulled fully apart, so a
          pinch never crops them at the stage's edges. */}
      {!spin && !play && <OrbitControls enablePan={false} minDistance={CAMERA_Z} maxDistance={6} />}
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
function Parts({ url, apart, tinted, moving, jointed, play }: {
  url: string; apart: number; tinted: boolean; moving: boolean; jointed: boolean;
  play?: { poseKey: number; spinKey: number; idle: boolean; loop: boolean };
}) {
  const gltf = useLoader(GLTFLoader, url);
  const { root, parts, size } = useMemo(() => {
    // The model, centred at the origin inside a wrapper the toy view scales
    // and turns; the admin sheet keeps a fixed scale sized for the parts
    // fully pulled apart (each moves out by up to OUT of its distance from
    // the middle), so the slider never pushes one off screen.
    const model = gltf.scene.clone(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
    const root = new THREE.Group();
    root.add(model);
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
    if (!play) root.scale.setScalar(1.75 / (Math.max(size.x, size.y, size.z || 1) * (1 + OUT)));
    return { root, parts: list, size };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf]);

  const tints = useRef<THREE.Material[]>([]);
  useEffect(() => {
    tints.current = parts.map((_, i) => new THREE.MeshStandardMaterial({ color: PART_TINTS[i % PART_TINTS.length], roughness: 0.7 }));
    return () => tints.current.forEach((m) => m.dispose());
  }, [parts]);

  useEffect(() => {
    parts.forEach((p, i) => {
      if (!play) p.pivot.position.copy(p.home).addScaledVector(p.out, apart);
      p.mesh.material = tinted ? tints.current[i] : p.material;
      p.pieces.forEach((piece, k) => { piece.material = tinted ? tints.current[i] : p.pieceMaterials[k]; });
    });
  }, [parts, apart, tinted, play]);

  const toy = useToy(play, parts, root, size, apart, jointed);

  // The toy's moves: the arms swing down from the T-pose and up again, one
  // after the other, and the legs step, each about its own joint centre.
  // Stopping eases every limb back to where it was cut.
  const t = useRef(0);
  useFrame((_, dt) => {
    if (toy) return;
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

/* ---------- The toy view: front-facing, framed to fill, playing by itself ---------- */

type Pose = Partial<Record<'arm-r' | 'arm-l' | 'leg-r' | 'leg-l', [number, number]>>; // [about x, about z]
/**
 * Poses a ball-jointed toy can strike from its T-pose. Angles stay inside
 * what a printed ball joint swings (arms about 35 degrees, legs about 20):
 * the view shows what the toy can really do, not a puppet. arm-r turns down
 * for negative z, arm-l for positive.
 */
const POSES: Pose[] = [
  { 'arm-r': [0, -0.6], 'arm-l': [0, 0.6] },                                      // arms down
  { 'arm-r': [0, 0.6], 'arm-l': [0, 0.55] },                                      // wave hello
  { 'arm-r': [0, 0.55], 'arm-l': [0, -0.55], 'leg-r': [0, 0.18], 'leg-l': [0, -0.18] }, // hero, arms up
  { 'arm-r': [0.5, -0.45], 'arm-l': [-0.5, 0.45], 'leg-r': [0.35, 0], 'leg-l': [-0.35, 0] }, // walking
  { 'arm-r': [-0.6, -0.2], 'arm-l': [0, 0.6], 'leg-l': [0.3, 0] },                // punch
];
const SMALL: Pose[] = [
  { 'arm-r': [0, -0.15], 'arm-l': [0, 0.15] },
  { 'arm-r': [0, 0.2] },
  { 'arm-l': [0, -0.2] },
  {},
];
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * The toy view's motion, one frame at a time: the parts ease to the apart
 * target, the wrapper is scaled so the figure fills the stage (zooming out as
 * the parts spread), the figure sways and breathes, a spin is one full turn,
 * a pose eases every limb to its angles. `loop` runs its own timeline.
 */
function useToy(play: { poseKey: number; spinKey: number; idle: boolean; loop: boolean } | undefined,
  parts: Part[], root: THREE.Group, size: THREE.Vector3, apart: number, jointed: boolean): boolean {
  const viewport = useThree((st) => st.viewport);
  const st = useRef({ t: 0, a: 0, pose: 0 as number, small: 3, nextSmall: 4, spinAt: -10, pk: -1, sk: -1 });
  useFrame((_, dtRaw) => {
    if (!play) return;
    const dt = Math.min(dtRaw, 0.05);
    const s = st.current;
    s.t += dt;
    if (s.pk !== play.poseKey) { if (s.pk >= 0) s.pose = (s.pose + 1) % POSES.length || 1; s.pk = play.poseKey; }
    if (s.sk !== play.spinKey) { if (s.sk >= 0) s.spinAt = s.t; s.sk = play.spinKey; }

    // The loop (option B): 0-1.6 s together, 1.6-2.6 come apart, 2.6-4.4 hover,
    // 4.4-5.4 together, 5.4-7.4 a pose, then again.
    let target = apart;
    let loopPose: number | null = null;
    let hover = 0;
    if (play.loop) {
      const L = s.t % 7.4;
      target = L < 1.6 ? 0 : L < 2.6 ? ease((L - 1.6) / 1.0) : L < 4.4 ? 1 : L < 5.4 ? 1 - ease((L - 4.4) / 1.0) : 0;
      hover = L >= 2.2 && L < 4.8 ? Math.sin(Math.min(1, (L - 2.2) / 0.4) * Math.PI / 2) * Math.min(1, (4.8 - L) / 0.4) : 0;
      loopPose = L >= 5.2 ? 2 + Math.floor(s.t / 7.4) % 3 : null;
    }
    s.a = THREE.MathUtils.damp(s.a, target, 6, dt);

    // Parts: out from the middle by `a`, and (hovering) bobbing each on its own beat.
    parts.forEach((p, i) => {
      p.pivot.position.copy(p.home).addScaledVector(p.out, s.a);
      if (hover) p.pivot.position.y += hover * 0.02 * size.y * Math.sin(s.t * 3 + i * 1.7);
    });

    // Framed to fill: the figure as tall as the stage allows (as the hero on
    // the 3D slide), its T-pose as wide, zooming out as the parts spread.
    const grow = 1 + OUT * s.a;
    const fit = Math.min((viewport.height * 0.86) / (size.y * grow), (viewport.width * 0.94) / (Math.max(size.x, 1e-6) * grow));
    root.scale.setScalar(fit);

    // Facing the viewer: a gentle sway (never its back) and breathing, plus a
    // full turn when asked.
    const spinP = ease((s.t - s.spinAt) / 1.8);
    const spinning = s.t - s.spinAt < 1.8;
    root.rotation.y = (play.idle || play.loop ? 0.22 * Math.sin(s.t * 0.6) : 0) + (spinning ? spinP * Math.PI * 2 : 0);
    root.position.y = (play.idle ? 0.012 * Math.sin(s.t * 1.7) : 0) * viewport.height;

    // Limbs: the asked-for pose; idle, now and then a small one.
    if (play.idle && s.t > s.nextSmall) { s.small = (s.small + 1 + Math.floor(Math.random() * 2)) % SMALL.length; s.nextSmall = s.t + 3.5 + Math.random() * 2; }
    const pose = loopPose !== null ? POSES[loopPose] : (s.pose === 0 && play.idle ? SMALL[s.small] : POSES[s.pose]);
    for (const p of parts) {
      if (!p.limb || !jointed) continue;
      const [x, z] = pose[p.limb] || [0, 0];
      const r = p.pivot.rotation;
      r.x = THREE.MathUtils.damp(r.x, x, 5, dt);
      r.z = THREE.MathUtils.damp(r.z, z, 5, dt);
    }
  });
  return !!play;
}
