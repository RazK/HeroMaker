import { useEffect, useState } from 'react';
import { api, CreationResponse, PrintSplit } from '../../api/client';
import { Icon } from './Icon';
import { Sheet } from './parts';
import { PartsStage } from './PartsViewer';
import { PartsBoundary, PartsFallback } from './PartsBoundary';
import './PrintSplit.css';

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
  const [provider, setProvider] = useState<'hi3d' | 'meshy'>('hi3d');
  const [part, setPart] = useState<'a' | 'b' | 'd'>('a');
  const [joint, setJoint] = useState<'ball' | 'pin'>('ball');
  const [mode, setMode] = useState<'auto' | 'by_parts'>('auto');
  const [prompt, setPrompt] = useState('head, body, arms, legs');
  const [connectors, setConnectors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apart, setApart] = useState(0.35);
  const [tinted, setTinted] = useState(false);
  const [again, setAgain] = useState(false);
  const [moving, setMoving] = useState(false);

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
      setSplit(await api.startPrintSplit(creation.id, provider === 'hi3d'
        ? { provider, part, joint }
        : { provider, mode, prompt: mode === 'by_parts' ? prompt : undefined, connectors }));
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
          <div className="tb-split-line">Cutting {creation.character_name || 'the hero'} into parts</div>
        </div>
      )}

      {done && !again && (
        <>
          <div className="tb-split-stage">
            <PartsBoundary fallback={<PartsFallback preview={split.files?.preview} alt="The parts" />}><PartsStage url={split.files!.parts_view || split.files!.parts!} apart={apart} tinted={tinted}
              jointed={split.provider === 'hi3d' && !!split.joint && split.joint !== 'none'} moving={moving} /></PartsBoundary>
          </div>
          <div className="tb-split-line">
            {split.part_count ?? '?'} parts{split.provider === 'hi3d' && split.joint && split.joint !== 'none' ? ` · ${split.joint} joints` : ''} · drag to turn
          </div>
          <label className="tb-split-slider">
            <span>Pull apart</span>
            <input type="range" min={0} max={1} step={0.01} value={apart} onChange={(e) => setApart(Number(e.target.value))} />
          </label>
          <div className="tb-chip-row tb-split-chips">
            <button type="button" className={`tb-chip${tinted ? ' tb-chip--on' : ''}`} onClick={() => setTinted(!tinted)}>Colour each part</button>
            {split.provider === 'hi3d' && split.joint && split.joint !== 'none' && (
              <button type="button" className={`tb-chip${moving ? ' tb-chip--on' : ''}`} aria-pressed={moving} onClick={() => setMoving(!moving)}>Move it</button>
            )}
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
          <div className="tb-chip-row" role="radiogroup" aria-label="Joints">
            <button type="button" role="radio" aria-checked={provider === 'hi3d'} className={`tb-chip${provider === 'hi3d' ? ' tb-chip--on' : ''}`} onClick={() => setProvider('hi3d')}>Moving joints</button>
            <button type="button" role="radio" aria-checked={provider === 'meshy'} className={`tb-chip${provider === 'meshy' ? ' tb-chip--on' : ''}`} onClick={() => setProvider('meshy')}>Glued pegs</button>
          </div>
          {provider === 'hi3d' && (
            <>
              <div className="tb-chip-row" role="radiogroup" aria-label="Parts">
                {([['a', '6 parts'], ['b', '5 parts'], ['d', '4 parts']] as const).map(([k, label]) => (
                  <button key={k} type="button" role="radio" aria-checked={part === k} className={`tb-chip${part === k ? ' tb-chip--on' : ''}`} onClick={() => setPart(k)}>{label}</button>
                ))}
              </div>
              <div className="tb-chip-row" role="radiogroup" aria-label="Joint">
                <button type="button" role="radio" aria-checked={joint === 'ball'} className={`tb-chip${joint === 'ball' ? ' tb-chip--on' : ''}`} onClick={() => setJoint('ball')}>Ball joints</button>
                <button type="button" role="radio" aria-checked={joint === 'pin'} className={`tb-chip${joint === 'pin' ? ' tb-chip--on' : ''}`} onClick={() => setJoint('pin')}>Pin joints</button>
              </div>
            </>
          )}
          {provider === 'meshy' && (<>
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
          </>)}
          {error && <div className="tb-notice tb-notice--error" role="alert">{error}</div>}
          <button type="button" className="tb-btn tb-btn--primary tb-btn--full tb-btn--with-trail" disabled={busy || (provider === 'meshy' && mode === 'by_parts' && !prompt.trim())} onClick={start}>
            <span className="tb-split-go"><Icon name="cube" />{busy ? 'Starting…' : 'Split it'}</span>
            <span className="tb-btn-trail">{provider === 'hi3d' ? 'Hi3D · $0.40' : `${split.cost_meshy_credits ?? 10} Meshy credits`}</span>
          </button>
        </>
      )}

      {!split && error && <div className="tb-notice tb-notice--error" role="alert">{error}</div>}
    </Sheet>
  );
}
