import { PointerEvent, ReactNode, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { spreadPlan } from './partsSpread';
import { ARROW_COLOURS, curl } from './partsArrows';
import { loadStage, StageModule } from './stage';

/** Colours to tell the parts apart: the plates, then the sun and grape. */
const PART_TINTS = ['#e9e3ff', '#ffe9a8', '#cff5ea', '#ffdcc7', '#d6ecff', '#ffd6e7', '#ffc233', '#5b3df5'];
/** Where the camera stands; zooming is clamped so it never comes closer (all of it always fits). */
const CAMERA_Z = 2.6;
const CAMERA_FOV = 40;
/** The share of the view the parts may fill when pulled fully apart. */
const FILL = 0.94;
/** How long taking the toy apart (or putting it together) takes, in seconds, when eased. */
const EASE_S = 0.9;
/** Swaying, the toy faces front and turns at most this far each way (25 degrees), once in SWAY_S seconds. */
const SWAY = THREE.MathUtils.degToRad(25);
const SWAY_S = 9;
const SWAY_SAMPLES = [-1, -0.5, 0, 0.5, 1].map((k) => k * SWAY);
/** Turned by a drag, it waits this long (ms) and then eases back to the front. */
const BACK_MS = 2500;
/** How far (px) the toy keeps from what it must not pass under. */
const AVOID_MARGIN = 10;
const SVG = 'http://www.w3.org/2000/svg';

/**
 * A hero cut into printable parts (backend print_split.py), in 3D: `apart`
 * (0-1) pulls each part away along its own joint (partsSpread.ts: the head
 * up, an arm the way it points, the body still), `tinted` colours each part
 * its own, and `moving` swings the arms and legs about their joints, the way the
 * printed toy moves (only when `jointed`: the parts were cut with joints).
 * `ease` glides to a new `apart` instead of jumping (the hero page's Take
 * apart button), and `arrows` draws a curly arrow from each piece's ball to
 * the socket it clicks into while the pieces are apart.
 * Used by the admin split sheet (PrintSplit.tsx) and the hero page's action
 * figure slide (ActionFigure.tsx). Its own chunk: three's React bindings load
 * only when parts are shown.
 */
export function PartsStage({ url, apart, tinted = false, spin = false, jointed = false, moving = false, ease = false, arrows = false, sway = false, avoid }: {
  url: string;
  apart: number;
  /** Face the front and sway gently, like a toy on a shelf (the hero page's
   *  toy slide). A drag on the toy turns it, and it eases back. */
  sway?: boolean;
  /** A box on the screen the toy must never pass under (the drawing's card):
   *  the toy is drawn as large as it can be while clear of it. */
  avoid?: () => DOMRect | null;
  /** Glide to a new `apart`, rather than jump (a slider jumps). */
  ease?: boolean;
  /** Arrows from each piece's ball to its socket, while apart. */
  arrows?: boolean;
  tinted?: boolean;
  /** Turn slowly by itself instead of by dragging: on a carousel slide a
   *  drag is a swipe (HeroLive), as it is over the live hero. */
  spin?: boolean;
  /** The parts were cut with joints (Hi3D ball joints): limbs may move. */
  jointed?: boolean;
  /** Swing the arms and legs about their joint centres. */
  moving?: boolean;
}) {
  // The hero page's light (games/hero-moves/src/look.ts), from the hero
  // stage module the hero page loads anyway: the toy is lit like its hero.
  const [look, setLook] = useState<StageModule | null | false>(null);
  useEffect(() => {
    let alive = true;
    loadStage().then((m) => { if (alive) setLook(typeof m.applyLook === 'function' ? m : false); }, () => { if (alive) setLook(false); });
    return () => { alive = false; };
  }, []);
  const overlay = useRef<SVGSVGElement>(null);
  // A drag that starts on the toy turns it (and is not a swipe of the carousel).
  const turn = useRef({ user: 0, dragging: false, x: 0, released: -1e9 });
  const onToy = (e: PointerEvent<HTMLDivElement>) => {
    const b = e.currentTarget.dataset.toyBounds?.split(',').map(Number);
    if (!b) return false;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
  };
  const drag = sway ? {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      if (!onToy(e)) return;
      e.stopPropagation();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* fine */ }
      turn.current.dragging = true;
      turn.current.x = e.clientX;
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      if (!turn.current.dragging) return;
      e.stopPropagation();
      turn.current.user += (e.clientX - turn.current.x) * 0.012;
      turn.current.x = e.clientX;
    },
    onPointerUp: (e: PointerEvent<HTMLDivElement>) => {
      if (!turn.current.dragging) return;
      e.stopPropagation();
      turn.current.dragging = false;
      turn.current.released = performance.now();
    },
  } : {};
  const canvas = (
    <Canvas camera={{ position: [0, 0, CAMERA_Z], fov: CAMERA_FOV }} dpr={[1, 2]}>
      {look && <HeroLook look={look} />}
      {/* The hero stage module did not load: plain light, so the parts still show. */}
      {look === false && (<>
        <hemisphereLight args={['#ffffff', '#b9aee0', 2.2]} />
        <directionalLight position={[2, 3, 4]} intensity={2.4} />
        <directionalLight position={[-3, 1, -2]} intensity={1} />
      </>)}
      <Suspense fallback={<Html center><div className="tb-ring tb-parts-loading" style={{ ['--p' as string]: '25%' }}><span>…</span></div></Html>}>
        <Turntable on={spin}><Parts url={url} apart={apart} ease={ease} tinted={tinted} moving={jointed && moving} look={look || null}
          overlay={arrows || sway ? overlay : null} sway={sway} turn={turn} avoid={avoid} /></Turntable>
      </Suspense>
      {/* Zoom out only: the parts are framed to fit pulled fully apart, so a
          pinch never crops them at the stage's edges. */}
      {!spin && <OrbitControls enablePan={false} minDistance={CAMERA_Z} maxDistance={6} />}
    </Canvas>
  );
  if (!arrows && !sway) return canvas;
  // The arrows: an SVG over the canvas, its paths written every frame from the
  // joints projected to the screen (Parts), so they stay on the turning pieces.
  return (
    <div className="tb-parts-stage" {...drag} onPointerCancel={drag.onPointerUp}>
      {canvas}
      <svg ref={overlay} className="tb-parts-arrows" aria-hidden="true" />
    </div>
  );
}

export default PartsStage;

/** The hero page's lights, room, tone mapping and exposure, on this canvas. */
function HeroLook({ look }: { look: StageModule }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => look.applyLook({ THREE, RoomEnvironment }, gl, scene), [look, gl, scene]);
  return null;
}

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
  /** The part this one clicks into (-1: it is the body), and where: its socket, in that part's pivot space. */
  parent: number;
  socket: THREE.Vector3 | null;
}

/**
 * Which part is which, read from where the parts sit in a T-pose (Y up, the
 * figure facing +Z): the arms are the parts far out to the sides; of the
 * rest, the torso is the one the arms meet, and the legs hang below it.
 * Anything not recognised does not swing. (Where a limb's joint is comes from
 * partsSpread.ts: the end of the part that lies against the body.)
 */
function classify(boxes: THREE.Box3[]): Limb[] {
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
    if (isArm[i]) return c.x > mid.x ? 'arm-r' : 'arm-l';
    // A leg: below the torso's middle, its top no higher than a bit into the torso.
    if (torso >= 0 && i !== torso && c.y < centres[torso].y
        && b.max.y <= centres[torso].y + 0.25 * (boxes[torso].max.y - boxes[torso].min.y)) {
      return c.x > mid.x ? 'leg-r' : 'leg-l';
    }
    return null;
  });
}

/** The points of a part, in the figure's space; a dense part is thinned evenly. */
function cloudOf(mesh: THREE.Mesh, most = 20000): Float32Array {
  const at = mesh.geometry.getAttribute('position');
  const step = Math.max(1, Math.ceil(at.count / most));
  const out = new Float32Array(Math.ceil(at.count / step) * 3);
  const v = new THREE.Vector3();
  for (let i = 0, k = 0; i < at.count; i += step, k += 3) {
    v.fromBufferAttribute(at, i).applyMatrix4(mesh.matrixWorld);
    out[k] = v.x; out[k + 1] = v.y; out[k + 2] = v.z;
  }
  return out;
}

/**
 * How large the parts may be drawn so that all of them show when pulled fully
 * apart, on a view of this shape, at any turn: `half` is how far they reach
 * up or down from the middle, `round` how far out from the turning axis.
 */
function fitScale(half: number, round: number, aspect: number): number {
  const t = FILL * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
  const tall = (t * CAMERA_Z) / (half + t * round);
  const wide = (t * aspect * CAMERA_Z) / (round * (1 + t * aspect));
  return Math.min(tall, wide);
}

/**
 * The same for a toy that sways (SWAY each way) rather than turns all the way:
 * `wide` how far it reaches sideways at its widest sway, `deep` how far towards
 * the camera.
 */
function fitSway(half: number, wide: number, deep: number, aspect: number): number {
  const t = FILL * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
  const tall = (t * CAMERA_Z) / (half + t * deep);
  const across = (t * aspect * CAMERA_Z) / (wide + t * aspect * deep);
  return Math.min(tall, across);
}

/** How far points (x, z about the middle) reach sideways and towards the camera, swaying. */
function swayReach(points: [number, number][]): { wide: number; deep: number } {
  let wide = 1e-6;
  let deep = 1e-6;
  for (const a of SWAY_SAMPLES) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (const [x, z] of points) {
      wide = Math.max(wide, Math.abs(x * c + z * s));
      deep = Math.max(deep, Math.abs(-x * s + z * c));
    }
  }
  return { wide, deep };
}

/** The split model, centred and sized, each part moved out along its joint by `apart`. */
function Parts({ url, apart, ease, tinted, moving, look, overlay, sway = false, turn, avoid }: {
  url: string; apart: number; ease: boolean; tinted: boolean; moving: boolean; look: StageModule | null;
  overlay: { current: SVGSVGElement | null } | null;
  sway?: boolean;
  turn?: { current: { user: number; dragging: boolean; released: number } };
  avoid?: () => DOMRect | null;
}) {
  const gltf = useLoader(GLTFLoader, url);
  const scene = useThree((s) => s.scene);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const gl = useThree((s) => s.gl);
  const { root, parts, half, round, halfTogether, roundTogether, reachTogether, reachApart } = useMemo(() => {
    const root = gltf.scene.clone(true);
    root.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
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
    const limbs = classify(boxes);
    // Where each part's joint is and which way it travels (partsSpread.ts).
    const plan = spreadPlan(meshes.map((m) => cloudOf(m)));
    // How far the parts reach from the middle, up and around: together, and
    // pulled fully apart. The framing goes from one to the other as they
    // move, so the toy fills the stage when together and every piece still
    // shows when apart.
    let half = 1e-6;
    let round = 1e-6;
    let halfTogether = 1e-6;
    let roundTogether = 1e-6;
    const flatTogether: [number, number][] = [];
    const flatApart: [number, number][] = [];
    const list: Part[] = meshes.map((mesh, i) => {
      const parent = mesh.parent!;
      const at = new THREE.Vector3(...plan.joint[i]);
      const move = new THREE.Vector3(...plan.offset[i]);
      for (const end of [boxes[i].min, boxes[i].max]) for (const far of [0, 1]) {
        const p = end.clone().addScaledVector(move, far).sub(center);
        half = Math.max(half, Math.abs(p.y));
        if (!far) halfTogether = Math.max(halfTogether, Math.abs(p.y));
      }
      for (const x of [boxes[i].min.x, boxes[i].max.x]) for (const z of [boxes[i].min.z, boxes[i].max.z]) for (const far of [0, 1]) {
        const px = x + far * move.x - center.x;
        const pz = z + far * move.z - center.z;
        const r = Math.hypot(px, pz);
        round = Math.max(round, r);
        flatApart.push([px, pz]);
        if (!far) { roundTogether = Math.max(roundTogether, r); flatTogether.push([px, pz]); }
      }
      // The joint, in the parent's space: a pivot stands there and the part hangs off it.
      const joint = parent.worldToLocal(at.clone());
      const pivot = new THREE.Group();
      pivot.position.copy(joint);
      parent.add(pivot);
      pivot.updateMatrixWorld(true);
      pivot.attach(mesh);
      // Pulling apart moves the pivot (and so the part) along its joint, in the parent's units.
      const out = parent.worldToLocal(at.clone().add(move)).sub(joint);
      return { mesh, pivot, pieces: [], pieceMaterials: [], home: joint.clone(), out, limb: limbs[i], material: mesh.material,
        parent: plan.parent[i], socket: null };
    });
    // Each socket, where the part's ball clicks in, held in the space of the
    // part it is on, so it travels with that part.
    list.forEach((p, i) => {
      if (p.parent >= 0) p.socket = list[p.parent].pivot.worldToLocal(new THREE.Vector3(...plan.joint[i]));
    });
    pieces.forEach((piece) => {
      const owner = ownerOf(new THREE.Box3().setFromObject(piece), boxes, limbs, /_male\b/i.test(piece.name));
      if (owner < 0) return;
      list[owner].pivot.attach(piece);  // keeps it where it is, now moving with its part
      list[owner].pieces.push(piece);
      list[owner].pieceMaterials.push(piece.material);
    });
    root.position.copy(center).negate();
    return { root, parts: list, half, round, halfTogether, roundTogether, reachTogether: swayReach(flatTogether), reachApart: swayReach(flatApart) };
  }, [gltf]);

  const tints = useRef<THREE.Material[]>([]);
  useEffect(() => {
    tints.current = parts.map((_, i) => new THREE.MeshStandardMaterial({ color: PART_TINTS[i % PART_TINTS.length], roughness: 0.7 }));
    return () => tints.current.forEach((m) => m.dispose());
  }, [parts]);

  // How far apart the pieces are now: `apart` at once, or (eased) on its way there.
  const shown = useRef({ value: apart, from: apart, to: apart, at: -1 });
  const place = (value: number) => parts.forEach((p) => p.pivot.position.copy(p.home).addScaledVector(p.out, value));
  useEffect(() => {
    const s = shown.current;
    if (!ease) { s.value = s.from = s.to = apart; place(apart); return; }
    s.from = s.value; s.to = apart; s.at = -1;  // starts on the next frame
  }, [parts, apart, ease]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { place(shown.current.value); }, [parts]);  // eslint-disable-line react-hooks/exhaustive-deps

  // The arrows' paths, one group per piece that clicks into another.
  const arrowPaths = useRef<{ part: number; group: SVGGElement; line: SVGPathElement; head: SVGPathElement }[]>([]);
  useEffect(() => {
    const svg = overlay?.current;
    if (!svg) return;
    arrowPaths.current = parts.flatMap((p, i) => {
      if (p.parent < 0 || !p.socket) return [];
      const group = document.createElementNS(SVG, 'g');
      const line = document.createElementNS(SVG, 'path');
      const head = document.createElementNS(SVG, 'path');
      group.style.opacity = '0';
      group.append(line, head);
      svg.append(group);
      return [{ part: i, group, line, head }];
    });
    arrowPaths.current.forEach((a, k) => { a.group.style.stroke = ARROW_COLOURS[k % ARROW_COLOURS.length]; });
    return () => { arrowPaths.current.forEach((a) => a.group.remove()); arrowPaths.current = []; };
  }, [parts, overlay]);

  useEffect(() => {
    parts.forEach((p, i) => {
      p.mesh.material = tinted ? tints.current[i] : p.material;
      p.pieces.forEach((piece, k) => { piece.material = tinted ? tints.current[i] : p.pieceMaterials[k]; });
    });
    // The hero's finish on whatever is shown: a provider's file often says
    // "metal" by leaving metalness out (glTF's default is 1), drawn dark and flat.
    look?.finishMaterials({ THREE }, root, scene);
  }, [parts, tinted, look, root, scene]);

  const ball = useMemo(() => new THREE.Vector3(), []);
  const corner = useMemo(() => new THREE.Vector3(), []);
  const ticks = useRef(0);
  const socket = useMemo(() => new THREE.Vector3(), []);
  const still = useMemo(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const frame = useRef<THREE.Group>(null);
  // Swaying, it is framed for its sway, not a full turn: larger.
  const together = sway ? fitSway(halfTogether, reachTogether.wide, reachTogether.deep, aspect) : fitScale(halfTogether, roundTogether, aspect);
  const apartScale = sway ? fitSway(half, reachApart.wide, reachApart.deep, aspect) : fitScale(half, round, aspect);
  // Swaying, it stands at the top of its room when the room is taller than it
  // needs (a phone: the width limits it), so what is left is at the bottom,
  // where the drawing's card stands.
  const top = FILL * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2)) * CAMERA_Z;
  const lift = (scale: number, value: number) => (sway ? Math.max(0, top - scale * (halfTogether + (half - halfTogether) * value)) : 0);
  // As large as it can be while clear of `avoid`: a share of its framing,
  // together and apart, found once per layout by trying the sway's extremes.
  const clear = useRef({ key: '', together: 1, apart: 1 });
  // Each mesh's own points, a few hundred of them: projected, they give where
  // it really is on screen (its 3D box's corners reach well past a leg).
  const samples = useMemo(() => parts.flatMap((p) => [p.mesh, ...p.pieces]).map((m) => {
    const at = m.geometry.getAttribute('position');
    const step = Math.max(1, Math.floor(at.count / 400));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < at.count; i += step) pts.push(new THREE.Vector3().fromBufferAttribute(at, i));
    return { mesh: m, pts };
  }), [parts]);
  const boxes = (camera: THREE.Camera, size: { width: number; height: number }) => samples.map(({ mesh, pts }) => {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const v of pts) {
      corner.copy(v).applyMatrix4(mesh.matrixWorld).project(camera);
      const x = (corner.x + 1) / 2 * size.width;
      const y = (1 - corner.y) / 2 * size.height;
      l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y);
    }
    return [l, t, r, b] as [number, number, number, number];
  });
  const fitClear = (camera: THREE.Camera, size: { width: number; height: number }) => {
    const a = avoid?.();
    const c = gl.domElement.getBoundingClientRect();
    const zone = a && a.width > 0 && a.height > 0
      ? { l: a.left - c.left - AVOID_MARGIN, t: a.top - c.top - AVOID_MARGIN, r: a.right - c.left + AVOID_MARGIN, b: a.bottom - c.top + AVOID_MARGIN }
      : null;
    const key = zone ? [zone.l, zone.t, zone.r, zone.b, size.width, size.height].map(Math.round).join(',') : `none ${size.width}x${size.height}`;
    if (key === clear.current.key || !frame.current) return;
    clear.current.key = key;
    if (!zone) { clear.current.together = clear.current.apart = 1; return; }
    const g = frame.current;
    const saved = { value: shown.current.value, rot: g.rotation.y, y: g.position.y, scale: g.scale.x };
    const solve = (value: number, fit: number) => {
      place(value);
      for (let k = 1; k > 0.3; k -= 0.02) {
        g.scale.setScalar(fit * k);
        g.position.y = lift(fit * k, value);
        const hit = SWAY_SAMPLES.some((angle) => {
          g.rotation.y = angle;
          g.updateWorldMatrix(true, true);
          return boxes(camera, size).some(([l, t, r, b]) => l < zone.r && r > zone.l && t < zone.b && b > zone.t);
        });
        if (!hit) return k;
      }
      return 0.3;
    };
    clear.current.together = solve(0, together);
    clear.current.apart = solve(1, apartScale);
    place(saved.value);
    g.rotation.y = saved.rot;
    g.position.y = saved.y;
    g.scale.setScalar(saved.scale);
    g.updateWorldMatrix(true, true);
  };
  useFrame(({ clock, camera, size }, dt) => {
    // Taking apart: an ease in and out, from wherever it was.
    const s = shown.current;
    if (s.value !== s.to) {
      if (s.at < 0) s.at = clock.elapsedTime;
      const k = still ? 1 : Math.min(1, (clock.elapsedTime - s.at) / EASE_S);
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      s.value = k >= 1 ? s.to : s.from + (s.to - s.from) * e;
      place(s.value);
    }
    // The framing follows: as big as fits for how far apart they are now.
    if (avoid && ticks.current % 15 === 0) fitClear(camera, size);
    const v = Math.min(1, Math.max(0, s.value));
    const scale = together * clear.current.together + (apartScale * clear.current.apart - together * clear.current.together) * v;
    if (frame.current) {
      frame.current.scale.setScalar(scale);
      frame.current.position.y = lift(scale, v);
      // Swaying at the front, plus however a drag turned it, easing back.
      if (sway && turn) {
        const tr = turn.current;
        if (!tr.dragging && performance.now() - tr.released > BACK_MS) {
          const wrapped = Math.atan2(Math.sin(tr.user), Math.cos(tr.user));
          tr.user = THREE.MathUtils.damp(wrapped, 0, 2.5, dt);
        }
        frame.current.rotation.y = (still ? 0 : SWAY * Math.sin((2 * Math.PI * clock.elapsedTime) / SWAY_S)) + tr.user;
      }
    }
    // Where the toy is on screen (its parts' boxes, projected, within the
    // canvas), for the layout check: nothing may cover it (hero-layout.mjs).
    // The whole toy (where a drag turns it) and each part's box (what must
    // stay clear of the drawing's card: hero-layout.mjs checks them).
    const host = overlay?.current?.parentElement;
    if (host && ++ticks.current % 6 === 0) {
      const each = boxes(camera, size);
      const clamp = (v: number, hi: number) => Math.round(Math.min(hi, Math.max(0, v)));
      const fit = ([l, t, r, b]: number[]) => `${clamp(l, size.width)},${clamp(t, size.height)},${clamp(r, size.width)},${clamp(b, size.height)}`;
      host.dataset.toyBounds = fit([Math.min(...each.map((e) => e[0])), Math.min(...each.map((e) => e[1])), Math.max(...each.map((e) => e[2])), Math.max(...each.map((e) => e[3]))]);
      host.dataset.toyParts = each.map(fit).join(';');
    }
    if (!arrowPaths.current.length) return;
    // The arrows show as the pieces come apart, wiggling.
    const seen = THREE.MathUtils.smoothstep(s.value, 0.6, 0.95);
    const screen = (v: THREE.Vector3): [number, number] => {
      v.project(camera);
      return [(v.x + 1) / 2 * size.width, (1 - v.y) / 2 * size.height];
    };
    arrowPaths.current.forEach((a, k) => {
      const p = parts[a.part];
      a.group.style.opacity = String(seen);
      if (seen <= 0) return;
      p.pivot.getWorldPosition(ball);
      parts[p.parent].pivot.localToWorld(socket.copy(p.socket!));
      const wiggle = still ? 0 : 0.12 * Math.sin(clock.elapsedTime * 4.2 + k * 1.7);
      const c = curl(screen(ball), screen(socket), k % 2 ? -1 : 1, wiggle);
      a.line.setAttribute('d', c ? c.line : '');
      a.head.setAttribute('d', c ? c.head : '');
    });
  });

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

  return <group ref={frame} scale={together + (apartScale - together) * Math.min(1, Math.max(0, apart))}><primitive object={root} /></group>;
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
