/**
 * The Hero Statue, rendered like a product shot: the hero in matte resin on
 * a round base with its name engraved, soft studio light, a contact shadow,
 * turning slowly. Plain three.js, loaded only when the statue sheet opens.
 *
 * Two sources:
 * - `modelUrl` (the hero's sculpt, opt_model.glb): the base is built here and
 *   the engraving is live, so it follows what the customer types. Its sizes
 *   follow backend/app/services/statue.py (base radius, text band, arcs).
 * - `printUrl` (statue.glb from the print package): the exact solid that
 *   would be printed, base and engraved letters included.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export interface StatueOptions {
  modelUrl?: string;
  printUrl?: string;
  name: string;
  credit: string;
  /** Turntable speed, radians per second. 0 holds still. */
  spin?: number;
  /** Test/recording hook: render only when renderAt() is called. */
  manual?: boolean;
  onReady?: () => void;
  onError?: (e: unknown) => void;
}

// Sizes in mm at a 90 mm statue, as in statue.py.
const H = 90;
const BASE_H = 5;
const SINK = 0.8;
const CHAMFER = 0.8;
const NAME_EM = 6;
const SUB_EM = 3.6;
const GAP = 1.2;
const RIM = 2.2;
const BAND = 1.5 + NAME_EM * 0.75 + GAP + SUB_EM * 0.75 + RIM;
const MAX_ARC = (110 * Math.PI) / 180;

const CREAM = '#FFF6E9';
const GRAPE = '#4B2FE0';
const FONT = '600 100px Fredoka, Nunito, system-ui, sans-serif';
let fontReady = false;
const ENV = 0.55;

export class StatueStage {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(26, 1, 1, 2000);
  private turntable = new THREE.Group();
  private base: THREE.Group | null = null;
  private baseR = 25;
  private topTex: THREE.CanvasTexture | null = null;
  private bumpTex: THREE.CanvasTexture | null = null;
  private raf = 0;
  private last = performance.now();
  private angle = 0;
  private drag: { x: number; a: number } | null = null;
  private resizeObs: ResizeObserver;
  private disposed = false;
  private opts: StatueOptions;
  private scaleTarget = 1;
  private scaleNow = 1;

  constructor(private host: HTMLElement, opts: StatueOptions) {
    this.opts = { spin: 0.45, ...opts };
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: !!opts.manual });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.domElement.style.touchAction = 'pan-y';
    this.renderer = r;
    host.appendChild(r.domElement);

    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    // Key: warm, high front-left, casting the soft shadow. Rim: cool, behind.
    const key = new THREE.DirectionalLight(0xfff1e0, 2.4);
    key.position.set(-70, 150, 120);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 6;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.4;
    const sc = key.shadow.camera as THREE.OrthographicCamera;
    sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 10; sc.far = 450;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xdfe6ff, 1.6);
    rim.position.set(80, 90, -140);
    this.scene.add(rim);
    this.scene.add(new THREE.HemisphereLight(0xfffaf2, 0xe9dcc8, 0.6));

    // The table: catches the shadow; a soft dark disc under the base grounds it.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.ShadowMaterial({ opacity: 0.18 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const ao = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: radialTexture(), transparent: true, depthWrite: false }));
    ao.rotation.x = -Math.PI / 2;
    ao.position.y = 0.05;
    ao.name = 'ao';
    this.scene.add(ao);

    this.scene.add(this.turntable);
    this.camera.position.set(0, 62, 300);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.resize();
    this.bindDrag();
    this.load().catch((e) => opts.onError?.(e));
    if (!opts.manual) this.loop();
  }

  private async load() {
    const loader = new GLTFLoader();
    if (this.opts.printUrl) {
      const gltf = await loader.loadAsync(this.opts.printUrl);
      const g = gltf.scene;
      g.scale.setScalar(1000); // print GLB is in metres
      resin(g);
      this.turntable.add(g);
      const box = new THREE.Box3().setFromObject(g);
      this.baseR = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
      // the base is the widest thing at floor level; measure there
      this.baseR = measureBaseRadius(g) ?? this.baseR;
    } else if (this.opts.modelUrl) {
      const gltf = await loader.loadAsync(this.opts.modelUrl);
      const hero = gltf.scene;
      resin(hero);
      hero.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(hero);
      const figH = H - BASE_H + SINK;
      const s = figH / (box.max.y - box.min.y);
      hero.scale.setScalar(s);
      hero.updateMatrixWorld(true);
      const fp = footprint(hero, 0.03 * H);
      const box2 = new THREE.Box3().setFromObject(hero);
      hero.position.set(-fp.cx, BASE_H - SINK - box2.min.y, -fp.cz);
      this.baseR = Math.min(Math.max(fp.r + BAND, 0.24 * H), 0.6 * H);
      this.turntable.add(hero);
      this.base = this.makeBase(this.baseR);
      this.turntable.add(this.base);
      this.setText(this.opts.name, this.opts.credit);
    }
    const ao = this.scene.getObjectByName('ao') as THREE.Mesh;
    ao.scale.setScalar(this.baseR * 3.1);
    this.frame();
    if (!this.opts.manual) this.render();
    this.opts.onReady?.();
  }

  /** Lathe for the side and chamfer, a flat disc on top that carries the engraving. */
  private makeBase(R: number) {
    const g = new THREE.Group();
    const pts = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(R - 0.4, 0),
      new THREE.Vector2(R, 0.4),
      new THREE.Vector2(R, BASE_H - CHAMFER),
      new THREE.Vector2(R - CHAMFER, BASE_H),
    ];
    const sideMat = new THREE.MeshPhysicalMaterial({ color: CREAM, roughness: 0.48, clearcoat: 0.25, clearcoatRoughness: 0.45, envMapIntensity: ENV });
    const side = new THREE.Mesh(new THREE.LatheGeometry(pts, 160), sideMat);
    side.castShadow = true;
    side.receiveShadow = true;
    g.add(side);
    this.topTex = new THREE.CanvasTexture(document.createElement('canvas'));
    this.topTex.colorSpace = THREE.SRGBColorSpace;
    this.topTex.anisotropy = 8;
    this.bumpTex = new THREE.CanvasTexture(document.createElement('canvas'));
    const topMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, map: this.topTex, bumpMap: this.bumpTex, bumpScale: 2.2,
      roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.45, envMapIntensity: ENV,
    });
    const top = new THREE.Mesh(new THREE.CircleGeometry(R - CHAMFER, 160), topMat);
    top.rotation.x = -Math.PI / 2;
    top.position.y = BASE_H;
    top.receiveShadow = true;
    g.add(top);
    return g;
  }

  /** Engrave the base: hero name on the inner arc, the credit on the rim. */
  setText(name: string, credit: string) {
    this.opts.name = name;
    this.opts.credit = credit;
    if (!this.topTex || !this.bumpTex) return;
    const R = this.baseR - CHAMFER;
    const px = 2048;
    const k = px / (2 * R); // canvas px per mm
    const color = engraveCanvas(px, k, this.baseR, name, credit, CREAM, GRAPE, 0);
    const bump = engraveCanvas(px, k, this.baseR, name, credit, '#ffffff', '#000000', 1.2);
    this.topTex.image = color;
    this.bumpTex.image = bump;
    this.topTex.needsUpdate = true;
    this.bumpTex.needsUpdate = true;
    if (!this.opts.manual) this.render();
    // The first draw may use a fallback face: draw again once Fredoka is in.
    if (!fontReady && document.fonts?.load) {
      document.fonts.load(FONT.replace('100px', '40px')).then(() => {
        fontReady = true;
        if (!this.disposed) this.setText(this.opts.name, this.opts.credit);
      }).catch(() => { fontReady = true; });
    }
  }

  /** 6, 9 or 12 cm: the frame stays, the statue grows a little in it. */
  setSize(cm: number) {
    this.scaleTarget = cm <= 6 ? 0.84 : cm >= 12 ? 1.08 : 0.96;
  }

  /** For recordings: put the turntable at an angle and render one frame. */
  renderAt(angle: number, scale = 1) {
    this.angle = angle;
    this.scaleNow = this.scaleTarget = scale;
    this.apply();
    this.render();
  }

  private apply() {
    this.turntable.rotation.y = this.angle;
    this.turntable.scale.setScalar(this.scaleNow);
  }

  private frame() {
    // Fit the statue (height H, width ~2R or the arms) with a little air.
    const box = new THREE.Box3().setFromObject(this.turntable);
    const size = box.getSize(new THREE.Vector3());
    const w = Math.max(size.x, size.z, this.baseR * 2);
    const h = size.y;
    const aspect = this.camera.aspect;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const distH = (h * 1.32) / 2 / Math.tan(fov / 2);
    const distW = (w * 1.12) / 2 / Math.tan(fov / 2) / aspect;
    const d = Math.max(distH, distW);
    const target = new THREE.Vector3(0, h * 0.43, 0);
    const elev = THREE.MathUtils.degToRad(13);
    this.camera.position.set(0, target.y + Math.sin(elev) * d, Math.cos(elev) * d);
    this.camera.lookAt(target);
    this.camera.near = d / 10;
    this.camera.far = d * 10;
    this.camera.updateProjectionMatrix();
  }

  private resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.turntable.children.length) this.frame();
    this.render();
  }

  private bindDrag() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => { this.drag = { x: e.clientX, a: this.angle }; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', (e) => { if (this.drag) this.angle = this.drag.a + (e.clientX - this.drag.x) * 0.012; });
    const end = () => { this.drag = null; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  private loop = () => {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!this.drag && !reduce) this.angle += (this.opts.spin ?? 0) * dt;
    this.scaleNow += (this.scaleTarget - this.scaleNow) * Math.min(1, dt * 10);
    this.apply();
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  private render() {
    this.renderer.render(this.scene, this.camera);
  }

  get canvas() { return this.renderer.domElement; }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach((mat) => { Object.values(mat).forEach((v) => { if (v instanceof THREE.Texture) v.dispose(); }); mat.dispose(); });
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/** Matte resin: the sculpt's texture, a soft satin coat, no metal. */
function resin(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (!m.geometry.getAttribute('normal')) m.geometry.computeVertexNormals();
    const old = m.material as THREE.MeshStandardMaterial;
    m.material = new THREE.MeshPhysicalMaterial({
      map: old.map ?? null,
      color: old.map ? 0xffffff : old.color,
      roughness: 0.52,
      metalness: 0,
      envMapIntensity: ENV,
      clearcoat: 0.3,
      clearcoatRoughness: 0.42,
      sheen: 0.2,
      sheenRoughness: 0.6,
    });
    old.dispose();
    m.castShadow = true;
    m.receiveShadow = true;
  });
}

/** Centre and radius (mm, XZ) of what touches the ground. */
function footprint(root: THREE.Object3D, band: number) {
  const v = new THREE.Vector3();
  let minY = Infinity;
  const pts: THREE.Vector3[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      pts.push(v.clone());
      if (v.y < minY) minY = v.y;
    }
  });
  const low = pts.filter((p) => p.y <= minY + band);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  low.forEach((p) => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); });
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  let r = 0;
  low.forEach((p) => { r = Math.max(r, Math.hypot(p.x - cx, p.z - cz)); });
  return { cx, cz, r };
}

function measureBaseRadius(root: THREE.Object3D): number | null {
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let r = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      if (v.y < 1) r = Math.max(r, Math.hypot(v.x, v.z));
    }
  });
  return r || null;
}

/** A soft round shadow for under the base. */
function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(35,25,66,0.42)');
  grad.addColorStop(0.3, 'rgba(35,25,66,0.30)');
  grad.addColorStop(0.36, 'rgba(35,25,66,0.16)');
  grad.addColorStop(0.62, 'rgba(35,25,66,0.04)');
  grad.addColorStop(1, 'rgba(35,25,66,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The top of the base as a picture: text bent along the front arc, letters
 * pointing at the hero, baselines where statue.py cuts them.
 */
function engraveCanvas(px: number, k: number, baseR: number, name: string, credit: string,
  bg: string, ink: string, blur: number) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, px, px);
  if (blur) g.filter = `blur(${blur * (px / 1024)}px)`;
  g.fillStyle = ink;
  const cx = px / 2;
  const cy = px / 2;
  let radius = baseR - RIM;
  const lines: Array<[string, number]> = [];
  if (name.trim()) lines.push([name.trim(), NAME_EM]);
  if (credit.trim()) lines.push([credit.trim(), SUB_EM]);
  for (const [text, em0] of lines.reverse()) {
    let em = em0;
    g.font = FONT;
    const w100 = g.measureText(text).width / 100; // width per 1 px of em
    const maxLen = MAX_ARC * radius;
    if (w100 * em > maxLen) em = maxLen / w100;
    const fontPx = em * k;
    g.font = FONT.replace('100px', `${fontPx}px`);
    const total = g.measureText(text).width / k; // mm
    let s = -total / 2;
    for (const ch of text) {
      const cw = g.measureText(ch).width / k;
      const phi = -(s + cw / 2) / radius; // left of centre = larger phi
      const x = cx + Math.sin(-phi) * radius * k;
      const y = cy + Math.cos(phi) * radius * k;
      g.save();
      g.translate(x, y);
      g.rotate(phi);
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      g.fillText(ch, 0, 0);
      g.restore();
      s += cw;
    }
    radius -= em * 0.75 + GAP;
  }
  return c;
}
