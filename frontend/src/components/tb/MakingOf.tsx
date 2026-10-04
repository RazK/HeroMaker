import { useEffect, useState } from 'react';
import { api, CreationResponse } from '../../api/client';
import { ModelPreview } from '../ModelPreview';
import { Icon, IconName } from './Icon';
import { Header, NavButton } from './parts';
import { heroName } from './pipeline';
import './MakingOf.css';

/**
 * How a hero was made, one phase at a time: the drawing, the painting, the 3D
 * sculpt, and the hero moving. For showing off, so anyone who can see the
 * hero can see this, and it is all pictures.
 */
export function MakingOf({ creation, onBack }: { creation: CreationResponse; onBack: () => void }) {
  const file = (f: string) => api.getFileUrl(creation.id, f.endsWith('.glb') ? `opt_${f}` : f, creation.user_id); // opt_: ~5x smaller GLB, same look
  const rig = creation.steps.find((s) => s.step_name === 'meshy_rig');
  const walking = (rig?.metadata_json as { walking_glb_url?: string } | null)?.walking_glb_url ?? 'walking.glb';
  const done = (step: string) => creation.steps.find((s) => s.step_name === step)?.status === 'completed';

  // The 3D files are megabytes. Start both downloads the moment this screen
  // opens, while the drawing and the painting are on screen, and show how far
  // along they are instead of an empty card.
  const sculpt = file('model.glb');
  const moving = file(walking);
  const rigged = file('rigged.glb');
  const loads = usePrefetch([done('meshy_3d') ? sculpt : null, done('meshy_rig') ? moving : null]);
  const model = (url: string, extra: { walkingUrl?: string; riggedUrl?: string } = {}) => {
    const l = loads[url];
    if (!l?.blob) return <Loading image={file('thumb_rendered.png')} progress={l?.progress ?? 0} failed={l?.failed} />;
    return extra.walkingUrl
      ? <ModelPreview url={rigged} walkingUrl={l.blob} interactive={false} />
      : <ModelPreview url={l.blob} interactive={false} />;
  };

  const phases: Array<{ icon: IconName; label: string; show: () => JSX.Element }> = [
    { icon: 'pencil', label: 'The drawing', show: () => <Picture thumb={file('thumb_original.jpg')} full={file('original.jpg')} alt="The drawing" /> },
    ...(done('openai_render') ? [{ icon: 'brush' as IconName, label: 'Painted', show: () => <Picture thumb={file('thumb_rendered.png')} full={file('rendered.png')} alt="Painted" /> }] : []),
    ...(done('meshy_3d') ? [{ icon: 'cube' as IconName, label: 'Sculpted in 3D', show: () => model(sculpt) }] : []),
    ...(done('meshy_rig') ? [{ icon: 'run' as IconName, label: 'Brought to life', show: () => model(moving, { walkingUrl: moving }) }] : []),
  ];
  const [at, setAt] = useState(0);
  const phase = phases[at];
  const last = at === phases.length - 1;

  return (
    <div className="tb-screen tb-screen--fit tb-making-of">
      <Header left={<NavButton icon="back" label="Back to hero" onClick={onBack} className="tb-back" />} title={heroName(creation)} />
      <div className="tb-screen-body">
        <div className="tb-stepper tb-making-steps" role="tablist" aria-label="How it was made">
          {phases.map((p, i) => (
            <div key={p.label} style={{ display: 'contents' }}>
              <button type="button" role="tab" aria-selected={i === at} aria-label={p.label}
                className={`tb-step-dot ${i < at ? 'tb-step-dot--done' : i === at ? 'tb-step-dot--now' : 'tb-step-dot--next'}`}
                onClick={() => setAt(i)}>
                <Icon name={p.icon} size={i === at ? 24 : 18} />
              </button>
              {i < phases.length - 1 && <div className={`tb-step-line${i < at ? ' tb-step-line--done' : ''}`} />}
            </div>
          ))}
        </div>
        <div className="tb-stage tb-making-stage" data-phase={at}>{phase.show()}</div>
        <div className="tb-h2 tb-making-label">{phase.label}</div>
      </div>
      <div className="tb-bar">
        <button type="button" className="tb-btn tb-btn--primary tb-btn--full tb-making-next" onClick={() => (last ? setAt(0) : setAt(at + 1))}>
          {last ? <><Icon name="redo" />Watch again</> : <>Next<Icon name="play" /></>}
        </button>
      </div>
    </div>
  );
}

type Load = { progress: number; blob?: string; failed?: boolean };

/** Download files one after another into blob URLs, reporting progress (0..1). */
function usePrefetch(urls: Array<string | null>): Record<string, Load> {
  const [loads, setLoads] = useState<Record<string, Load>>({});
  const key = urls.join('|');
  useEffect(() => {
    let alive = true;
    const made: string[] = [];
    const set = (u: string, l: Load) => { if (alive) setLoads((m) => ({ ...m, [u]: l })); };
    (async () => {
      for (const u of urls) {
        if (!u) continue;
        try {
          const r = await fetch(u);
          if (!r.ok || !r.body) throw new Error(String(r.status));
          const total = Number(r.headers.get('content-length')) || 0;
          const reader = r.body.getReader();
          const parts: Uint8Array[] = [];
          let got = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            parts.push(value);
            got += value.length;
            set(u, { progress: total ? got / total : 0 });
          }
          const blob = URL.createObjectURL(new Blob(parts as BlobPart[], { type: 'model/gltf-binary' }));
          made.push(blob);
          set(u, { progress: 1, blob });
        } catch {
          set(u, { progress: 0, failed: true });
        }
      }
    })();
    return () => { alive = false; made.forEach((b) => URL.revokeObjectURL(b)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return loads;
}

/** The painting, dimmed, with a ring filling up as the 3D file arrives. */
function Loading({ image, progress, failed }: { image: string; progress: number; failed?: boolean }) {
  const pct = Math.round(progress * 100);
  return (
    <div className="tb-making-loading" role="status" aria-label={failed ? 'Could not load' : `Loading ${pct}%`}>
      <img className="tb-making-img tb-making-img--dim" src={image} alt="" />
      <div className="tb-ring" style={{ ['--p' as string]: `${pct}%` }}>
        <span>{failed ? '!' : `${pct}%`}</span>
      </div>
    </div>
  );
}

/** The small thumbnail at once (it is already cached from the gallery), the full picture when it lands. */
function Picture({ thumb, full, alt }: { thumb: string; full: string; alt: string }) {
  const [src, setSrc] = useState(thumb);
  useEffect(() => {
    setSrc(thumb);
    const img = new Image();
    img.onload = () => setSrc(full);
    img.src = full;
  }, [thumb, full]);
  return <img className="tb-making-img" src={src} alt={alt} />;
}
