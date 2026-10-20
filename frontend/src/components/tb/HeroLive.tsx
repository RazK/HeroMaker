import { CSSProperties, ReactNode, SyntheticEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, CreationResponse, PAINTING_FILE, paintingFramed } from '../../api/client';
import { heroVrmUrl } from '../../config/play';
import { Icon, IconName } from './Icon';
import { Polaroid } from './parts';
import { HeroStageInstance, StageModule, loadStage } from './stage';
import { usePinchZoom } from './usePinchZoom';
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
/**
 * The intro is a quick slideshow of the process (Raz: "don't pause for more
 * than about 1 second on each phase"): each phase is on screen PHASE_MS, its
 * cross-fade included (HeroLive.css), so four phases take under 4 seconds.
 * The clock never waits for a download: a 3D phase whose file is not there
 * yet shows the loading ring for its turn, and so does the live hero after.
 * Only a picture that has not appeared at all may take PICTURE_WAIT_MS more,
 * so a phase is never an empty stage, and is then shown for at least
 * PICTURE_MIN_MS.
 */
const PHASE_MS = 900;
const PHASE_MIN_MS = 500;
const PICTURE_WAIT_MS = 400;
const PICTURE_MIN_MS = 500;
/** The intro's stepper: 12px from the top of the stage, 44px tall, 4px clear.
 *  The hero keeps this margin at the top and the bottom, so it shrinks in place
 *  on the sun rather than moving down (measured: 10px or more under the strip
 *  on tall and T-posed heroes, at 360x640). */
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
 * What the live stage needs of a hero: whose it is and which of its files
 * exist (file_versions, as GET /api/creations/{id} and the class claim link
 * both return it). Older responses without file_versions fall back to steps.
 */
export type LiveHero = Pick<CreationResponse, 'id' | 'user_id' | 'name' | 'age' | 'file_versions' | 'painting'> & {
  character_name?: string | null;
  steps?: Array<Pick<CreationResponse['steps'][number], 'step_name' | 'status'>>;
};

const STEP_FILE: Record<string, string> = { openai_render: 'rendered.png', meshy_3d: 'model.glb' };

/**
 * The ready hero's page body: one stage that tells how the hero was made the
 * first time (drawing, painting, 3D sculpt, alive), then is the hero, live and
 * dancing; and under it the moves. Renders the screen body and the move row
 * as siblings so the screen grid can put the moves beside the stage on a
 * phone held sideways.
 *
 * The stage has three modes. The intro plays the four steps by itself. Live
 * is the hero, with the drawing as a polaroid in the corner. Browse is how it
 * was made, at your own pace: a tap on the polaroid swaps it into the stage
 * (the drawing big, the hero small in the corner), and the steps strip on top
 * shows each step: the drawing, the painting, the turning sculpt; Alive, the
 * small hero card or Back return to the hero. The strip is the one way to
 * move between the steps, in the intro too (tapping a step stops the intro
 * there).
 */
export function HeroLive({ creation, introRequest, notice, moves = MOVES.map((m) => m.id) }: {
  creation: LiveHero;
  /** Bumped by the ⋯ sheet's "How it was made": play the intro again. */
  introRequest: number;
  notice?: ReactNode;
  /** Which moves the row offers (ids of MOVES); none hides the row. */
  moves?: string[];
}) {
  const file = (f: string) => api.heroFileUrl(creation, f);
  const done = (step: string) => (creation.file_versions
    ? STEP_FILE[step] in creation.file_versions
    : creation.steps?.find((s) => s.step_name === step)?.status === 'completed');
  const offered = MOVES.filter((m) => moves.includes(m.id));
  const vrm = heroVrmUrl(creation);
  const hasSculpt = done('meshy_3d');
  // Relative and opt_, like the VRM: ~5x smaller, same look, same URL everywhere.
  const sculpt = hasSculpt ? `/api/files/${creation.user_id}/${creation.id}/opt_model.glb` : null;
  const phases: Phase[] = ['drawing', ...(done('openai_render') ? ['painting' as const] : []), ...(hasSculpt ? ['sculpt' as const] : []), 'alive'];

  const [phase, setPhase] = useState<Phase>(() => (introSeen(creation.id) ? 'live' : phases[0]));
  const [browsing, setBrowsing] = useState(false);
  const [mod, setMod] = useState<StageModule | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState<'sculpt' | 'hero' | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [movesReady, setMovesReady] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  // Whether the drawing and the painting have appeared (see PICTURE_WAIT_MS),
  // and their shapes (width / height), for laying them out while browsing.
  const [pictured, setPictured] = useState<Record<string, boolean>>({});
  const [aspect, setAspect] = useState<Record<string, number>>({});
  const pictureShown = (key: string) => (img: HTMLImageElement) => {
    setPictured((all) => (all[key] ? all : { ...all, [key]: true }));
    const ar = img.naturalWidth / img.naturalHeight;
    if (ar > 0) setAspect((all) => (all[key] === ar ? all : { ...all, [key]: ar }));
  };
  // Once the stage has swapped, the corner cards pop in when they come back.
  const [swapped, setSwapped] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const stageEl = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const flipFrom = useRef<DOMRect | null>(null);
  const stage = useRef<HeroStageInstance | null>(null);
  const pendingMove = useRef<string | null>(null);
  const pinch = usePinchZoom();

  // The steps strip is up during the intro and while browsing.
  const steps = phase !== 'live';
  const intro = steps && !browsing;
  const leave = () => { setBrowsing(false); setPhase('live'); };
  const browse = (p: Phase) => {
    if (p === 'alive' || p === 'live') { leave(); return; }
    setSwapped(true);
    setBrowsing(true);
    setPhase(p);
  };
  const startIntro = useCallback(() => { setBrowsing(false); setPhase(phases[0]); }, [phases[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  const skip = () => setPhase('live');
  // Back (Android's too) returns from browsing to the hero, not off the page.
  useBackEntry(browsing, leave);

  useEffect(() => { if (intro) markIntroSeen(creation.id); }, [intro, creation.id]);
  const firstRequest = useRef(introRequest);
  useEffect(() => { if (introRequest !== firstRequest.current) startIntro(); }, [introRequest, startIntro]);
  // A step that cannot show (its 3D failed) leaves browsing for the hero.
  useEffect(() => { if (browsing && phase === 'alive') leave(); }, [browsing, phase]);
  useEffect(() => { pinch.reset(); }, [phase, browsing]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = stageEl.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  // The steps strip covers the top of the stage: shrink the 3D clear of it,
  // centred where it always is (on the sun), never shifted.
  useEffect(() => { stage.current?.setInsetTop(steps ? INTRO_INSET : 0); }, [steps, mod]);

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

  // Each phase moves on PHASE_MS after it began, loaded or not (see PHASE_MS).
  // A phase that ran long (a late picture, or the page busy parsing 3D, which
  // holds the timer up) is made up by the next ones, down to PHASE_MIN_MS, so
  // the whole intro keeps to its 4 seconds.
  const ready3d = (phase === 'sculpt' && shown === 'sculpt') || ((phase === 'alive' || phase === 'live') && shown === 'hero');
  const clock = useRef({ at: 0, plan: PHASE_MS, late: 0 });
  const pictureUp = (phase !== 'drawing' && phase !== 'painting') || !!pictured[phase];
  useEffect(() => {
    const now = performance.now();
    const c = clock.current;
    c.late = phase === phases[0] ? 0 : Math.max(0, c.late + (now - c.at) - c.plan);
    c.at = now;
    c.plan = Math.max(PHASE_MIN_MS, PHASE_MS - c.late);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!intro) return;
    const { at, plan } = clock.current;
    const elapsed = performance.now() - at;
    const giveUp = plan + PICTURE_WAIT_MS - elapsed;
    // A picture that came late still gets its moment, within the same cap.
    const wait = pictureUp ? Math.max(plan - elapsed, Math.min(PICTURE_MIN_MS, giveUp)) : giveUp;
    const t = setTimeout(() => setPhase((p) => {
      const i = phases.indexOf(p);
      return i < 0 || i >= phases.length - 1 ? 'live' : phases[i + 1];
    }), Math.max(0, wait));
    return () => clearTimeout(t);
  }, [phase, intro, pictureUp]); // eslint-disable-line react-hooks/exhaustive-deps

  // The swap: the drawing grows out of the polaroid into the stage (about
  // 250ms, a scale and position morph), while the hero shrinks into the corner.
  useLayoutEffect(() => {
    const from = flipFrom.current;
    const el = card.current;
    flipFrom.current = null;
    if (!from || !el || !browsing || phase !== 'drawing' || reducedMotion()) return;
    const photo = el.querySelector('img') ?? el;
    const to = photo.getBoundingClientRect();
    if (!to.width || !to.height) return;
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const k = from.width / to.width;
    el.animate(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${k}) rotate(-6deg)` }, { transform: `rotate(${BIG_TILT}deg)` }],
      { duration: SWAP_MS, easing: 'cubic-bezier(.2, .8, .2, 1)' },
    );
  }, [browsing, phase]);

  // A move tapped before the hero was on stage plays as soon as it is.
  useEffect(() => {
    if (shown === 'hero' && pendingMove.current && stage.current?.play(pendingMove.current)) pendingMove.current = null;
  }, [shown]);

  const tap = (id: string) => {
    if (steps) leave();
    if (!stage.current?.play(id)) pendingMove.current = id;
  };

  const waiting = !ready3d && (phase === 'sculpt' || phase === 'alive' || phase === 'live');
  const waitUrl = phase === 'sculpt' ? sculpt : vrm;
  const painted = done('openai_render');
  const painting = painted ? 'rendered.png' : 'original.jpg';
  // On the stage: the painting's cut-out, or a polaroid of it when it has none.
  const paintingFull = painted ? PAINTING_FILE : painting;
  const paintingClass = `tb-stage-img${painted && paintingFramed(creation) ? ' tb-stage-img--framed' : ''}`;
  const heroName = creation.character_name?.trim() || 'The hero';
  const flat = browsing && (phase === 'drawing' || phase === 'painting');

  // While browsing, the big picture keeps clear of the hero's card in the
  // corner: the drawing entirely; the painting may cover the empty floor
  // beside a T-pose's feet, as on the making screen (useClearOfPolaroid).
  const avoid = browsing ? miniFootprint(size.w, size.h) : null;
  const drawingBox = avoid ? fitClear(size.w, size.h, aspect.drawing || 0.75, CARD_PAD_X, CARD_PAD_Y, avoid, false) : undefined;
  const paintingBox = avoid ? fitClear(size.w, size.h, aspect.painting || 1, 0, 0, avoid, true) : undefined;

  return (
    <>
      <div className="tb-screen-body">
        {notice}
        <div
          ref={stageEl}
          className={`tb-stage tb-hero-stage tb-live-stage${steps ? ' tb-live-stage--steps' : ''}${intro ? ' tb-live-stage--intro' : ''}`}
          data-phase={phase}
          data-mode={intro ? 'intro' : browsing ? 'browse' : 'live'}
          data-shown={shown ?? ''}
          data-playing={playing ?? ''}
          onClick={intro ? skip : undefined}
          aria-label={steps ? `${PHASE_LABEL[phase as Exclude<Phase, 'live'>]}${intro ? '. Tap to skip.' : ''}` : undefined}
          {...(flat ? pinch.handlers : {})}
        >
          <div className="tb-stage-sun" />
          {/* Full-size pictures only for the intro and browsing, or if the 3D
              cannot load. The drawing's thumbnail (the polaroid's own) is always
              laid out, so the swap knows where it grows to. */}
          <Layer on={steps && phase === 'drawing'}>
            <div className="tb-live-drawing" style={drawingBox}>
              <div className={`tb-live-zoom${pinch.settling ? ' tb-live-zoom--settle' : ''}`} style={{ transform: phase === 'drawing' ? pinch.transform : undefined }}>
                <div ref={card} className="tb-live-card">
                  <Picture thumb={file('thumb_original.jpg')} full={steps ? file('original.jpg') : null} alt={steps ? 'The drawing' : ''} onShown={pictureShown('drawing')} className="tb-live-card-img" />
                  <Caption artist={creation.name} age={creation.age} />
                </div>
              </div>
            </div>
          </Layer>
          {(steps || failed) && (
            <Layer on={phase === 'painting' || (failed && phase !== 'drawing')}>
              <div className={`tb-live-zoom${pinch.settling ? ' tb-live-zoom--settle' : ''}`} style={{ transform: phase === 'painting' ? pinch.transform : undefined }}>
                <Picture thumb={file(`thumb_${painting}`)} full={file(paintingFull)} alt="Painted" onShown={pictureShown('painting')} className={paintingClass} style={paintingBox && boxStyle(paintingBox, size)} />
              </div>
            </Layer>
          )}
          <div ref={host} className={`tb-live-canvas${ready3d ? ' tb-layer--on' : ''}`} />
          <Layer on={waiting && !failed}>
            <Loading image={file(`thumb_${painting}`)} progress={(waitUrl && progress[waitUrl]) || 0} className={paintingClass} />
          </Layer>
          {steps && <StepStrip phases={phases} current={phase} browsing={browsing} onPick={browse} />}
          {!steps && (
            <Polaroid
              key="drawing"
              className={swapped ? 'tb-live-pop' : ''}
              src={file('thumb_original.jpg')}
              artist={creation.name}
              age={creation.age}
              label="How it was made"
              onOpen={(photo) => { flipFrom.current = photo.getBoundingClientRect(); browse('drawing'); }}
            />
          )}
          {browsing && (
            <Polaroid
              key="hero"
              className="tb-live-pop tb-live-mini"
              src={file(`thumb_${painting}`)}
              title={heroName}
              shape={MINI_SHAPE}
              label={`Back to ${heroName}`}
              onOpen={leave}
            />
          )}
        </div>
      </div>
      {offered.length > 0 && <div className="tb-hero-moves">
        <div className={`tb-moves${offered.length < 4 ? ' tb-moves--few' : ''}`} role="toolbar" aria-label="Moves">
          {offered.map((m) => (
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
      </div>}
    </>
  );
}

/**
 * The steps strip over the top of the stage: in the intro it follows along
 * (done, now, next); while browsing every step is made and the one on show
 * is lit. Either way a tap on a step shows that step.
 */
function StepStrip({ phases, current, browsing, onPick }: { phases: Phase[]; current: Phase; browsing: boolean; onPick: (p: Phase) => void }) {
  const at = phases.indexOf(current);
  return (
    <div className="tb-live-steps">
      <div className="tb-stepper" role="toolbar" aria-label="How it was made">
        {phases.map((p, i) => {
          const key = p as Exclude<Phase, 'live'>;
          const state = i === at ? 'now' : browsing || i < at ? 'done' : 'next';
          return (
            <div key={p} style={{ display: 'contents' }}>
              <button
                type="button"
                className={`tb-step-dot tb-step-dot--${state}`}
                aria-label={PHASE_LABEL[key]}
                aria-current={i === at ? 'step' : undefined}
                onClick={(e) => { e.stopPropagation(); onPick(p); }}
              >
                <Icon name={!browsing && state === 'done' ? 'check' : PHASE_ICON[key]} size={state === 'now' ? 24 : 18} />
              </button>
              {i < phases.length - 1 && <div className={`tb-step-line${browsing || i < at ? ' tb-step-line--done' : ''}`} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The big drawing's caption: the artist's first name and age, as on the polaroid. */
function Caption({ artist, age }: { artist?: string | null; age?: number | null }) {
  const first = artist?.trim().split(/\s+/)[0] || '';
  return (
    <span className="tb-live-card-caption" dir="auto">
      {first ? `${first}${age ? `, ${age}` : ''}` : 'The drawing'}
    </span>
  );
}

// ---- Browsing layout: the big picture, clear of the hero's corner card ----

/** The big drawing's tilt, and the swap's length (HeroLive.css matches both). */
const BIG_TILT = -2;
const SWAP_MS = 250;
/** The hero's card in the corner: a small square photo (paintings are square). */
const MINI_SHAPE = { w: 60, h: 60 };
/** The big drawing's white frame: 8px around, a 36px caption under it. */
const CARD_PAD_X = 16;
const CARD_PAD_Y = 44;
const EDGE = 16;
const GAP = 8;

interface Rect { left: number; right: number; top: number; bottom: number }
type Box = { left: number; right: number; top: number; bottom: number };

/** Where the corner card sits (toybox .tb-polaroid: 12px in, tilted -6deg), as a box on the stage. */
function miniFootprint(W: number, H: number): Rect {
  const w = MINI_SHAPE.w + 12;
  const h = MINI_SHAPE.h + 6 + 26;
  const t = (6 * Math.PI) / 180;
  const bw = w * Math.cos(t) + h * Math.sin(t);
  const bh = w * Math.sin(t) + h * Math.cos(t);
  const cx = 12 + w / 2;
  const cy = H - 12 - h / 2;
  const r = { left: cx - bw / 2, right: cx + bw / 2, top: cy - bh / 2, bottom: cy + bh / 2 };
  const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
  return rtl ? { ...r, left: W - r.right, right: W - r.left } : r;
}

/**
 * The biggest box for a picture of aspect `ar` (plus its frame) under the
 * strip that stays clear of `a`: the whole stage, or give up the bottom, or
 * both sides equally (always centred). `corner` lets a painting cover the
 * card's corner of its empty floor, as useClearOfPolaroid does.
 */
function fitClear(W: number, H: number, ar: number, padX: number, padY: number, a: Rect, corner: boolean): Box | undefined {
  if (!W || !H) return undefined;
  const place = (b: Box) => {
    const bw = W - b.left - b.right;
    const bh = H - b.top - b.bottom;
    const iw = Math.max(0, Math.min(bw - padX, (bh - padY) * ar));
    const w = iw + padX;
    const h = iw / ar + padY;
    return { box: b, x: b.left + (bw - w) / 2, y: b.top + (bh - h) / 2, w, h };
  };
  const clear = ({ x, y, w, h }: ReturnType<typeof place>) => {
    const across = Math.min(x + w, a.right) - Math.max(x, a.left);
    const down = Math.min(y + h, a.bottom) - Math.max(y, a.top);
    if (across <= 0 || down <= 0) return true;
    return corner && across <= 0.36 * w && a.top >= y + 0.5 * h;
  };
  const top = INTRO_INSET + 4;
  const side = Math.max(EDGE, (a.left < W / 2 ? a.right : W - a.left) + GAP);
  const options = [
    place({ left: EDGE, right: EDGE, top, bottom: EDGE }),
    place({ left: EDGE, right: EDGE, top, bottom: Math.max(EDGE, H - a.top + GAP) }),
    place({ left: side, right: side, top, bottom: EDGE }),
  ].filter(clear);
  const best = options.reduce<ReturnType<typeof place> | null>((m, o) => (!m || o.w * o.h > m.w * m.h ? o : m), null);
  return best?.box;
}

function boxStyle(b: Box, size: { w: number; h: number }) {
  return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: size.w - b.left - b.right, height: size.h - b.top - b.bottom };
}

function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/**
 * While `active`, the page owns one history entry: Back (Android's too) calls
 * `onBack` instead of leaving the page. Ended any other way, the entry is
 * dropped, so the next Back is not a dead press.
 */
const BACK_KEY = 'tbStageBrowse';
let backEntries = 0;
const onBackEntry = () => {
  const s = window.history.state as Record<string, unknown> | null;
  return !!s && s[BACK_KEY] === true;
};
function useBackEntry(active: boolean, onBack: () => void) {
  const cb = useRef(onBack);
  cb.current = onBack;
  useEffect(() => {
    if (!active) return;
    backEntries += 1;
    if (!onBackEntry()) window.history.pushState({ ...(window.history.state ?? {}), [BACK_KEY]: true }, '');
    let popped = false;
    const onPop = () => { if (!onBackEntry()) { popped = true; cb.current(); } };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      backEntries -= 1;
      // Deferred, so a remount (React's strict mode) keeps the entry.
      if (!popped) window.setTimeout(() => { if (!backEntries && onBackEntry()) window.history.back(); }, 0);
    };
  }, [active]);
}

function Layer({ on, children }: { on: boolean; children: ReactNode }) {
  return <div className={`tb-layer${on ? ' tb-layer--on' : ''}`} aria-hidden={on ? undefined : true}>{children}</div>;
}

/** The painting, dimmed, with a ring filling up as the 3D file arrives. */
function Loading({ image, progress, className = 'tb-stage-img' }: { image: string; progress: number; className?: string }) {
  const pct = Math.round(progress * 100);
  return (
    <div className="tb-live-loading" role="status" aria-label={`Loading ${pct}%`}>
      <img className={`${className} tb-live-img--dim`} src={image} alt="" />
      <div className="tb-ring" style={{ ['--p' as string]: `${pct}%` }}>
        <span>{pct}%</span>
      </div>
    </div>
  );
}

/** The small thumbnail at once (cached from the gallery), the full picture when it lands. */
function Picture({ thumb, full, alt, onShown, className = 'tb-stage-img', style }: {
  thumb: string; full: string | null; alt: string; onShown?: (img: HTMLImageElement) => void; className?: string; style?: CSSProperties;
}) {
  const [src, setSrc] = useState(thumb);
  useEffect(() => {
    if (!full) return;
    const img = new Image();
    img.onload = () => setSrc(full);
    img.src = full;
  }, [full]);
  useEffect(() => setSrc(thumb), [thumb]);
  // A picture that cannot load still lets the intro move on.
  const shown = (e: SyntheticEvent<HTMLImageElement>) => onShown?.(e.currentTarget);
  return <img className={className} src={src} alt={alt} style={style} draggable={false} onLoad={shown} onError={shown} />;
}
