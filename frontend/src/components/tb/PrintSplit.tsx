import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useLoader } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import { api, CreationResponse, PrintSplit } from '../../api/client';
import { Icon } from './Icon';
import { Sheet } from './parts';
import './PrintSplit.css';

/** Colours to tell the parts apart: the plates, then the sun and grape. */
const PART_TINTS = ['#e9e3ff', '#ffe9a8', '#cff5ea', '#ffdcc7', '#d6ecff', '#ffd6e7', '#ffc233', '#5b3df5'];
const POLL_MS = 3000;

/**
 * Admin preview of Meshy's Auto Split: the hero cut into parts that print on
 * their own and glue back together (backend/app/services/print_split.py).
 * Start it, watch it, then turn the parts in 3D, pull them apart, and take
 * the 3MF to a slicer.
 */
export function PrintSplitSheet({ creation, onClose }: { creation: CreationResponse; onClose: () => void }) {
  const [split, setSplit] = useState<PrintSplit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'auto' | 'by_parts'>('auto');
  const [prompt, setPrompt] = useState('head, body, arms, legs');
  const [connectors, setConnectors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apart, setApart] = useState(0.35);
  const [tinted, setTinted] = useState(false);
  const [again, setAgain] = useState(false);

  const running = split?.status === 'pending' || split?.status === 'in_progress';
  useEffect(() => {
    let alive = true;
    const read = () => api.getPrintSplit(creation.id).then((s) => { if (alive) setSplit(s); }).catch((e) => { if (alive) setError(String(e.message || e)); });
    read();
    return () => { alive = false; };
  }, [creation.id]);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => { api.getPrintSplit(creation.id).then(setSplit).catch(() => { /* next tick */ }); }, POLL_MS);
    return () => window.clearInterval(t);
  }, [running, creation.id]);

  const start = async () => {
    setBusy(true); setError(null);
    try {
      setSplit(await api.startPrintSplit(creation.id, { mode, prompt: mode === 'by_parts' ? prompt : undefined, connectors }));
      setAgain(false);
    } catch (e) {
      setError((e as Error).message || 'Could not start the split');
    } finally {
      setBusy(false);
    }
  };

  const done = split?.status === 'succeeded' && split.files?.parts;
  const showOptions = split && !running && (!done || again);

  return (
    <Sheet title="Split for printing" onClose={onClose} className="tb-split">
      {!split && !error && <div className="tb-split-wait"><div className="tb-ring" style={{ ['--p' as string]: '0%' }}><span>…</span></div></div>}

      {running && (
        <div className="tb-split-wait" role="status">
          <div className="tb-ring" style={{ ['--p' as string]: `${split.progress ?? 0}%` }}><span>{split.progress ?? 0}%</span></div>
          <div className="tb-split-line">{split.stage === 'remesh' ? 'Handing Meshy the model' : `Cutting ${creation.character_name || 'the hero'} into parts`}</div>
        </div>
      )}

      {done && !again && (
        <>
          <div className="tb-split-stage">
            <Canvas camera={{ position: [0, 0.4, 2.6], fov: 40 }} dpr={[1, 2]}>
              <ambientLight intensity={0.9} />
              <directionalLight position={[2, 3, 4]} intensity={1.2} />
              <Suspense fallback={null}>
                <Parts url={split.files!.parts!} apart={apart} tinted={tinted} />
              </Suspense>
              <OrbitControls enablePan={false} minDistance={1.2} maxDistance={6} />
            </Canvas>
          </div>
          <div className="tb-split-line">{split.part_count ?? '?'} parts · drag to turn</div>
          <label className="tb-split-slider">
            <span>Pull apart</span>
            <input type="range" min={0} max={1} step={0.01} value={apart} onChange={(e) => setApart(Number(e.target.value))} />
          </label>
          <div className="tb-chip-row tb-split-chips">
            <button type="button" className={`tb-chip${tinted ? ' tb-chip--on' : ''}`} onClick={() => setTinted(!tinted)}>Colour each part</button>
            <button type="button" className="tb-chip" onClick={() => setAgain(true)}>Split again</button>
          </div>
          <div className="tb-stack">
            {split.files?.parts && (
              <a className="tb-btn tb-btn--secondary tb-btn--full" href={split.files.parts} download={`${creation.character_name || 'hero'}-parts.glb`}>
                <Icon name="download" />Parts .glb
              </a>
            )}
            {split.files?.parts_3mf && (
              <a className="tb-btn tb-btn--primary tb-btn--full" href={split.files.parts_3mf} download={`${creation.character_name || 'hero'}-parts.3mf`}>
                <Icon name="download" />For the printer .3mf
              </a>
            )}
          </div>
        </>
      )}

      {showOptions && (
        <>
          {split.status === 'failed' && <div className="tb-notice tb-notice--error" role="alert">{split.error || 'The split failed.'} Meshy returns its credits.</div>}
          <div className="tb-chip-row" role="radiogroup" aria-label="How to cut">
            <button type="button" role="radio" aria-checked={mode === 'auto'} className={`tb-chip${mode === 'auto' ? ' tb-chip--on' : ''}`} onClick={() => setMode('auto')}>Meshy decides</button>
            <button type="button" role="radio" aria-checked={mode === 'by_parts'} className={`tb-chip${mode === 'by_parts' ? ' tb-chip--on' : ''}`} onClick={() => setMode('by_parts')}>By body parts</button>
          </div>
          {mode === 'by_parts' && (
            <div className="tb-field">
              <label htmlFor="split-parts">Parts</label>
              <input id="split-parts" className="tb-input" value={prompt} maxLength={600} onChange={(e) => setPrompt(e.target.value)} />
            </div>
          )}
          <div className="tb-chip-row">
            <button type="button" role="switch" aria-checked={connectors} className={`tb-chip${connectors ? ' tb-chip--on' : ''}`} onClick={() => setConnectors(!connectors)}>Pegs to glue</button>
          </div>
          {error && <div className="tb-notice tb-notice--error" role="alert">{error}</div>}
          <button type="button" className="tb-btn tb-btn--primary tb-btn--full tb-btn--with-trail" disabled={busy || (mode === 'by_parts' && !prompt.trim())} onClick={start}>
            <span className="tb-split-go"><Icon name="cube" />{busy ? 'Starting…' : 'Split it'}</span>
            <span className="tb-btn-trail">{split.cost_meshy_credits ?? 10} Meshy credits</span>
          </button>
        </>
      )}

      {!split && error && <div className="tb-notice tb-notice--error" role="alert">{error}</div>}
    </Sheet>
  );
}

/** The split model, centred and sized, each part pushed out from the middle by `apart`. */
function Parts({ url, apart, tinted }: { url: string; apart: number; tinted: boolean }) {
  const gltf = useLoader(GLTFLoader, url);
  const { root, parts } = useMemo(() => {
    const root = gltf.scene.clone(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = 1.6 / Math.max(size.x, size.y, size.z || 1);
    root.position.copy(center.clone().multiplyScalar(-scale));
    root.scale.setScalar(scale);
    const meshes: { mesh: THREE.Mesh; home: THREE.Vector3; out: THREE.Vector3; material: THREE.Material | THREE.Material[] }[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const c = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
      const out = c.sub(center);
      if (out.lengthSq() < 1e-9) out.set(0, 1, 0);
      meshes.push({ mesh, home: mesh.position.clone(), out: out.multiplyScalar(0.9), material: mesh.material });
    });
    return { root, parts: meshes };
  }, [gltf]);

  const tints = useRef<THREE.Material[]>([]);
  useEffect(() => {
    tints.current = parts.map((_, i) => new THREE.MeshStandardMaterial({ color: PART_TINTS[i % PART_TINTS.length], roughness: 0.7 }));
    return () => tints.current.forEach((m) => m.dispose());
  }, [parts]);

  useEffect(() => {
    parts.forEach((p, i) => {
      // `out` is in the model's own units: undo the parent's scale so the push is in the part's frame.
      const parent = p.mesh.parent;
      const local = p.out.clone();
      if (parent) local.divide(parent.getWorldScale(new THREE.Vector3()).divideScalar(root.scale.x || 1));
      p.mesh.position.copy(p.home).addScaledVector(local, apart);
      p.mesh.material = tinted ? tints.current[i] : p.material;
    });
  }, [parts, apart, tinted, root]);

  return <primitive object={root} />;
}
