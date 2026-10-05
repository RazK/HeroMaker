import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { api, CreationResponse } from '../../api/client';
import { heroVrmUrl } from '../../config/play';
import { Icon, IconName } from './Icon';
import { Stepper } from './parts';
import { HeroStageInstance, StageModule, loadStage } from './stage';
import './HeroLive.css';

/** The eight moves, in the order of the row. Ids are the game's clip ids. */
export const MOVES: Array<{ id: string; label: string; icon: IconName }> = [
  { id: 'dance', label: 'Dance', icon: 'dance' },
  { id: 'bodyroll', label: 'Wave', icon: 'bodyroll' },
  { id: 'backflip', label: 'Flip', icon: 'backflip' },
  { id: 'punch', label: 'Punch', icon: 'punch' },
  { id: 'jump', label: 'Jump', icon: 'jump' },
  { id: 'land', label: 'Land', icon: 'land' },
  { id: 'fly', label: 'Fly', icon: 'fly' },
  { id: 'victory', label: 'Cheer', icon: 'victory' },
];

/** How it was made, played inside the stage, then the hero itself. */
type Phase = 'drawing' | 'painting' | 'sculpt' | 'alive' | 'live';
const PHASE_ICON: Record<Exclude<Phase, 'live'>, IconName> = { drawing: 'pencil', painting: 'brush', sculpt: 'cube', alive: 'run' };
const PHASE_LABEL: Record<Exclude<Phase, 'live'>, string> = { drawing: 'The drawing', painting: 'Painted', sculpt: 'Sculpted in 3D', alive: 'Brought to life' };
/** How long each phase of the intro holds once it is on screen. */
const HOLD_MS = 1700;
/** The intro's stepper: 12px from the top of the stage, 44px tall, 4px clear. */
const INTRO_INSET = 60;

// The intro plays the first time a hero is opened on this device. Storage can
// throw (private windows, blocked site data); then it simply plays every time.
const seenKey = (id: string) => `heromaker.intro.seen.${id}`;
function introSeen(id: string): boolean {
  try { return localStorage.getItem(seenKey(id)) === '1'; } catch { return false; }
}
function markIntroSeen(id: string) {
  try { localStorage.setItem(seenKey(id), '1'); } catch { /* fine */ }
}

/**
 * The ready hero's page body: one stage that tells how the hero was made the
 * first time (drawing, painting, 3D sculpt, alive), then is the hero, live and
 * dancing; and under it the moves. Renders the screen body and the move row
 * as siblings so the screen grid can put the moves beside the stage on a
 * phone held sideways.
 */
export function HeroLive({ creation, introRequest, notice }: {
  creation: CreationResponse;
  /** Bumped by the ⋯ sheet's "How it was made": play the intro again. */
  introRequest: number;
  notice?: ReactNode;
}) {
  const file = (f: string) => api.getFileUrl(creation.id, f, creation.user_id);
  const done = (step: string) => creation.steps.find((s) => s.step_name === step)?.status === 'completed';
  const vrm = heroVrmUrl(creation);
  const hasSculpt = done('meshy_3d');
  // Relative and opt_, like the VRM: ~5x smaller, same look, same URL everywhere.
  const sculpt = hasSculpt ? `/api/files/${creation.user_id}/${creation.id}/opt_model.glb` : null;
  const phases: Phase[] = ['drawing', ...(done('openai_render') ? ['painting' as const] : []), ...(hasSculpt ? ['sculpt' as const] : []), 'alive'];

  const [phase, setPhase] = useState<Phase>(() => (introSeen(creation.id) ? 'live' : phases[0]));
  const [mod, setMod] = useState<StageModule | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState<'sculpt' | 'hero' | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [movesReady, setMovesReady] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  // The drawing and the painting hold once they are actually on screen.
  const [pictured, setPictured] = useState<Record<string, boolean>>({});
  const pictureShown = (key: string) => () => setPictured((all) => (all[key] ? all : { ...all, [key]: true }));
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<HeroStageInstance | null>(null);
  const pendingMove = useRef<string | null>(null);

  const intro = phase !== 'live';
  const startIntro = useCallback(() => setPhase(phases[0]), [phases[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  const skip = () => setPhase('live');

  useEffect(() => { if (intro) markIntroSeen(creation.id); }, [intro, creation.id]);
  const firstRequest = useRef(introRequest);
  useEffect(() => { if (introRequest !== firstRequest.current) startIntro(); }, [introRequest, startIntro]);

  // The 3D module and both 3D files start loading the moment the page opens,
  // while the drawing and the painting are on screen. Each is fetched once
  // per page load, however often this hero is opened.
  useEffect(() => {
    let alive = true;
    const stop: Array<() => void> = [];
    loadStage().then((m) => {
      if (!alive) return;
      setMod(m);
      for (const url of [vrm, sculpt]) {
        if (!url) continue;
        stop.push(m.prefetch(url, (p) => {
          const pct = Math.round(p * 100) / 100;
          if (alive) setProgress((all) => (all[url] === pct ? all : { ...all, [url]: pct }));
        }));
      }
      m.prepareHero(vrm).catch(() => { if (alive) setFailed(true); });
    }, () => { if (alive) setFailed(true); });
    return () => { alive = false; stop.forEach((s) => s()); };
  }, [vrm, sculpt]);

  // One stage per page; the WebGL context and every parsed file outlive it.
  useEffect(() => {
    if (!mod || !host.current) return;
    const s = new mod.HeroStage(host.current, { onPlaying: setPlaying });
    stage.current = s;
    s.movesReady(vrm).then(() => setMovesReady(true), () => {});
    return () => {
      s.dispose();
      stage.current = null;
      setShown(null);
      setPlaying(null);
    };
  }, [mod, vrm]);

  // The intro's stepper covers the top of the stage: frame the 3D below it.
  useEffect(() => { stage.current?.setInsetTop(intro ? INTRO_INSET : 0); }, [intro, mod]);

  // What the 3D stage shows follows the phase.
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    let alive = true;
    if (phase === 'sculpt' && sculpt) {
      s.showSculpt(sculpt).then(() => { if (alive) setShown('sculpt'); }, () => { if (alive) setPhase('alive'); });
    } else if (phase === 'alive' || phase === 'live') {
      s.showHero(vrm).then(() => { if (alive) setShown('hero'); }, () => { if (alive) setFailed(true); });
    } else {
      s.clear();
      setShown(null);
    }
    return () => { alive = false; };
  }, [phase, mod, vrm, sculpt]);

  // Each phase holds once it is on screen; a 3D phase waits for its file.
  const ready3d = (phase === 'sculpt' && shown === 'sculpt') || ((phase === 'alive' || phase === 'live') && shown === 'hero');
  useEffect(() => {
    if (!intro) return;
    const is3d = phase === 'sculpt' || phase === 'alive';
    if (is3d && !ready3d && !failed) return;
    if (!is3d && !pictured[phase]) return;
    const t = setTimeout(() => setPhase((p) => {
      const i = phases.indexOf(p);
      return i < 0 || i >= phases.length - 1 ? 'live' : phases[i + 1];
    }), HOLD_MS);
    return () => clearTimeout(t);
  }, [phase, ready3d, failed, intro, pictured]); // eslint-disable-line react-hooks/exhaustive-deps

  // A move tapped before the hero was on stage plays as soon as it is.
  useEffect(() => {
    if (shown === 'hero' && pendingMove.current && stage.current?.play(pendingMove.current)) pendingMove.current = null;
  }, [shown]);

  const tap = (id: string) => {
    if (intro) skip();
    if (!stage.current?.play(id)) pendingMove.current = id;
  };

  const waiting = !ready3d && (phase === 'sculpt' || phase === 'alive' || phase === 'live');
  const waitUrl = phase === 'sculpt' ? sculpt : vrm;
  const painting = done('openai_render') ? 'rendered.png' : 'original.jpg';
  const stepIndex = phases.indexOf(phase);

  return (
    <>
      <div className="tb-screen-body">
        {notice}
        <div
          className={`tb-stage tb-hero-stage tb-live-stage${intro ? ' tb-live-stage--intro' : ''}`}
          data-phase={phase}
          data-shown={shown ?? ''}
          data-playing={playing ?? ''}
          onClick={intro ? skip : undefined}
          aria-label={intro ? `${PHASE_LABEL[phase as Exclude<Phase, 'live'>]}. Tap to skip.` : undefined}
        >
          <div className="tb-stage-sun" />
          {/* Full-size pictures only for the intro, or if the 3D cannot load. */}
          {intro && <Layer on={phase === 'drawing'}><Picture thumb={file('thumb_original.jpg')} full={file('original.jpg')} alt="The drawing" onShown={pictureShown('drawing')} /></Layer>}
          {(intro || failed) && <Layer on={phase === 'painting' || (failed && phase !== 'drawing')}><Picture thumb={file(`thumb_${painting}`)} full={file(painting)} alt="Painted" onShown={pictureShown('painting')} /></Layer>}
          <div ref={host} className={`tb-live-canvas${ready3d ? ' tb-layer--on' : ''}`} />
          <Layer on={waiting && !failed}>
            <Loading image={file(`thumb_${painting}`)} progress={(waitUrl && progress[waitUrl]) || 0} />
          </Layer>
          {intro && (
            <div className="tb-live-steps" aria-hidden="true">
              <Stepper steps={phases.map((p, i) => ({ icon: PHASE_ICON[p as Exclude<Phase, 'live'>], state: i < stepIndex ? 'done' : i === stepIndex ? 'now' : 'next' }))} />
            </div>
          )}
          {!intro && (
            <button type="button" className="tb-polaroid tb-polaroid--button" onClick={startIntro} aria-label="How it was made">
              <img src={file('thumb_original.jpg')} alt="The drawing" />
              <div>{creation.name ? `${creation.name}${creation.age ? `, ${creation.age}` : ''}` : 'The drawing'}</div>
            </button>
          )}
        </div>
      </div>
      <div className="tb-hero-moves">
        <div className="tb-moves" role="toolbar" aria-label="Moves">
          {MOVES.map((m) => (
            <button
              key={m.id}
              type="button"
              className="tb-btn tb-btn--secondary tb-move"
              data-move={m.id}
              aria-pressed={playing === m.id}
              disabled={!movesReady}
              onClick={() => tap(m.id)}
            >
              <Icon name={m.icon} size={26} />
              <span>{m.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function Layer({ on, children }: { on: boolean; children: ReactNode }) {
  return <div className={`tb-layer${on ? ' tb-layer--on' : ''}`}>{children}</div>;
}

/** The painting, dimmed, with a ring filling up as the 3D file arrives. */
function Loading({ image, progress }: { image: string; progress: number }) {
  const pct = Math.round(progress * 100);
  return (
    <div className="tb-live-loading" role="status" aria-label={`Loading ${pct}%`}>
      <img className="tb-stage-img tb-live-img--dim" src={image} alt="" />
      <div className="tb-ring" style={{ ['--p' as string]: `${pct}%` }}>
        <span>{pct}%</span>
      </div>
    </div>
  );
}

/** The small thumbnail at once (cached from the gallery), the full picture when it lands. */
function Picture({ thumb, full, alt, onShown }: { thumb: string; full: string; alt: string; onShown?: () => void }) {
  const [src, setSrc] = useState(thumb);
  useEffect(() => {
    setSrc(thumb);
    const img = new Image();
    img.onload = () => setSrc(full);
    img.src = full;
  }, [thumb, full]);
  // A picture that cannot load still lets the intro move on.
  return <img className="tb-stage-img" src={src} alt={alt} onLoad={onShown} onError={onShown} />;
}
