import { CSSProperties, MutableRefObject, PointerEvent, ReactNode, SyntheticEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync, createPortal } from 'react-dom';
import { api, CreationResponse, PAINTING_FILE, paintingFramed } from '../../api/client';
import { heroVrmUrl } from '../../config/play';
import { Icon, IconName } from './Icon';
import { Header, NavButton } from './parts';
import { HeroStageInstance, StageModule, loadStage } from './stage';
import { usePinchZoom } from './usePinchZoom';
import './HeroLive.css';

/**
 * The moves, in the order of the row: one row of four on a phone and on a
 * desktop (Raz: only these four are interesting). Ids are the game's clip ids.
 */
export const MOVES: Array<{ id: string; label: string; icon: IconName }> = [
  { id: 'dance', label: 'Dance', icon: 'dance' },
  { id: 'bodyroll', label: 'Wave', icon: 'bodyroll' },
  { id: 'backflip', label: 'Flip', icon: 'backflip' },
  { id: 'punch', label: 'Punch', icon: 'punch' },
];

/**
 * What the live stage needs of a hero: whose it is and which of its files
 * exist (file_versions, as GET /api/v1/heroes/{id} and the class claim link
 * both return it). Older responses without file_versions fall back to steps.
 */
export type LiveHero = Pick<CreationResponse, 'id' | 'user_id' | 'name' | 'age' | 'file_versions' | 'painting'> & {
  character_name?: string | null;
  steps?: Array<Pick<CreationResponse['steps'][number], 'step_name' | 'status'>>;
};

/**
 * A hero still being made (or stopped): which step runs or failed, and how far
 * it is (0-100). `idle` is a hero never started: nothing runs, so nothing is
 * shown as on its way.
 */
export interface Making {
  step?: string;
  pct: number;
  failed: boolean;
  /** "Sculpting failed": the failed step's name, for its slide. */
  failedLabel?: string;
  idle?: boolean;
  /** What is happening, under the stage: the status, the bar (HeroScreen). */
  info: ReactNode;
}

const STEP_FILE: Record<string, string> = { openai_render: 'rendered.png', meshy_3d: 'model.glb' };

type SlideKey = 'drawing' | 'painting' | 'hero';
type SlideState = 'ready' | 'pending' | 'failed';
interface Slide { key: SlideKey; state: SlideState }

/**
 * The steps behind each slide that is still to come, with their share of its
 * one progress ring: the painting is mostly the painting; the 3D hero is the
 * sculpt, then the rig and the pack (by how long each usually takes).
 */
const PART_STEPS: Record<'painting' | 'hero', Array<[string, number]>> = {
  painting: [['image_processing', 5], ['openai_render', 95]],
  hero: [['meshy_3d', 80], ['meshy_rig', 15], ['convert_vrm', 5]],
};

/**
 * The hero's page body: one stage, a carousel of how the hero was made (Raz:
 * "the original drawing, then the amazing rendering, then the fabulous 3D
 * model"): the drawing, the painting, and the hero itself, live and dancing.
 * It is cyclic, moves only when swiped (or by the arrow keys, or its dots),
 * and a ready hero opens on the hero, which is what the moves under it act on.
 * A tap on the drawing or the painting opens it full screen.
 *
 * While the hero is being made (`making`), the carousel builds up: the drawing
 * from the start, then a progress slide for the part being made, which becomes
 * that part when it is ready. The carousel moves on to a new part by itself,
 * the one movement it makes alone, and only when its viewer was watching for
 * it (on the progress slide, or never swiped away from where it put them).
 *
 * Renders the screen body and the move row as siblings so the screen grid can
 * put the moves beside the stage on a phone held sideways.
 */
export function HeroLive({ creation, making, notice, moves = MOVES.map((m) => m.id) }: {
  creation: LiveHero;
  making?: Making;
  notice?: ReactNode;
  /** Which moves the row offers (ids of MOVES); none hides the row. */
  moves?: string[];
}) {
  const file = (f: string) => api.heroFileUrl(creation, f);
  const done = (step: string) => (creation.file_versions && step in STEP_FILE
    ? STEP_FILE[step] in creation.file_versions
    : creation.steps?.find((s) => s.step_name === step)?.status === 'completed');
  const live = !making;
  const offered = live ? MOVES.filter((m) => moves.includes(m.id)) : [];
  const vrm = heroVrmUrl(creation);
  const painted = done('openai_render');
  const heroName = creation.character_name?.trim() || 'The hero';

  // The slides there are now, in order.
  const slides: Slide[] = [{ key: 'drawing', state: 'ready' }];
  const coming: SlideState = making?.failed ? 'failed' : 'pending';
  if (painted) slides.push({ key: 'painting', state: 'ready' });
  else if (making && !making.idle) slides.push({ key: 'painting', state: coming });
  if (live) slides.push({ key: 'hero', state: 'ready' });
  else if (painted && !making.idle) slides.push({ key: 'hero', state: coming });
  const frontier = slides.find((s) => s.state !== 'ready') ?? slides[slides.length - 1];

  // A ready hero's page opens on the story of how it was made: the drawing,
  // then the painting once it has loaded, then the live hero once the 3D has
  // (Raz, 2026-10-25). Any touch (a swipe, a dot, a move, the drawing's card)
  // ends it there and then. Not while a hero is being made: that carousel
  // builds itself as the parts are born.
  const [intro, setIntro] = useState(() => live && painted && !reducedMotion());
  const [at, setAt] = useState<SlideKey>(() => (intro ? 'drawing' : frontier.key));
  // Set while the intro itself moves the carousel, so its moves don't end it.
  const driving = useRef(false);
  // Whether the viewer is where the carousel put them (or on the part being
  // made): only then does it move on when a part is born.
  const follow = useRef(true);
  const index = Math.max(0, slides.findIndex((s) => s.key === at));
  const current = slides[index];
  const pick = (i: number) => {
    const s = slides[i];
    if (!s) return;
    if (!driving.current) setIntro(false);
    follow.current = s.key === frontier.key && s.state === 'pending';
    setAt(s.key);
  };
  const sig = slides.map((s) => `${s.key}:${s.state}`).join(',');
  const before = useRef(sig);
  useEffect(() => {
    const was = Object.fromEntries(before.current.split(',').map((p) => p.split(':')));
    before.current = sig;
    const born = slides.find((s) => s.state === 'ready' && was[s.key] && was[s.key] !== 'ready');
    if (born && follow.current) setAt(born.key);
    // A slide that went away (it never does today): back to the part in the making.
    if (!slides.some((s) => s.key === at)) setAt(frontier.key);
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const [mod, setMod] = useState<StageModule | null>(null);
  const [failed3d, setFailed3d] = useState(false);
  const [shown, setShown] = useState(false);
  const [progress, setProgress] = useState(0);
  const [movesReady, setMovesReady] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  // The drawing or the painting, full screen.
  const [full, setFull] = useState<'drawing' | 'painting' | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<HeroStageInstance | null>(null);
  const pendingMove = useRef<string | null>(null);

  // The 3D module and the hero's file start loading the moment the hero is
  // ready, while the other slides are on screen. Each is fetched once per page
  // load, however often this hero is opened.
  useEffect(() => {
    if (!live) return;
    let alive = true;
    let stop = () => {};
    loadStage().then((m) => {
      if (!alive) return;
      setMod(m);
      stop = m.prefetch(vrm, (p) => { if (alive) setProgress(Math.round(p * 100) / 100); });
      m.prepareHero(vrm).catch(() => { if (alive) setFailed3d(true); });
    }, () => { if (alive) setFailed3d(true); });
    return () => { alive = false; stop(); };
  }, [vrm, live]);

  // One stage per page; the WebGL context and every parsed file outlive it.
  useEffect(() => {
    if (!mod || !host.current) return;
    const s = new mod.HeroStage(host.current, { onPlaying: setPlaying });
    stage.current = s;
    // The pager dots sit over the top of the stage: keep the hero clear of them.
    s.setInsetTop(DOTS_CLEAR);
    let alive = true;
    s.movesReady(vrm).then(() => { if (alive) setMovesReady(true); }, () => {});
    s.showHero(vrm).then(() => { if (alive) setShown(true); }, () => { if (alive) setFailed3d(true); });
    return () => {
      alive = false;
      s.dispose();
      stage.current = null;
      setShown(false);
      setPlaying(null);
    };
  }, [mod, vrm]);

  // A move tapped before the hero was on stage plays as soon as it is.
  useEffect(() => {
    if (shown && !landing.current && pendingMove.current && stage.current?.play(pendingMove.current)) pendingMove.current = null;
  }, [shown]);

  // A move acts on the hero: from another slide, the hero slides in forward
  // (drawing -> hero, the way it was made) and the move starts as it lands.
  const go = useRef<((i: number, dir: 1 | -1) => void) | null>(null);
  const landing = useRef(0);
  useEffect(() => () => window.clearTimeout(landing.current), []);
  const tap = (id: string) => {
    const i = slides.findIndex((s) => s.key === 'hero');
    pendingMove.current = id;
    if (i >= 0 && i !== index) {
      follow.current = false;
      go.current?.(i, 1);
      window.clearTimeout(landing.current);
      landing.current = window.setTimeout(() => {
        landing.current = 0;
        if (pendingMove.current && stage.current?.play(pendingMove.current)) pendingMove.current = null;
      }, reducedMotion() ? 0 : LAND_MS);
      return;
    }
    if (!landing.current && stage.current?.play(id)) pendingMove.current = null;
  };

  const paintingFile = painted ? PAINTING_FILE : 'original.jpg';
  const framed = painted && paintingFramed(creation);

  // The intro waits for each picture before it shows it: never a slide that
  // is still blank. The 3D (shown, or failed: the painting stands in) is
  // loading meanwhile, from the moment the page opened.
  const [loaded, setLoaded] = useState({ drawing: false, painting: false });
  useEffect(() => {
    if (!intro) return;
    for (const [key, url] of [['drawing', file('thumb_original.jpg')], ['painting', file(`thumb_${paintingFile}`)]] as const) {
      const img = new Image();
      img.onload = img.onerror = () => setLoaded((l) => ({ ...l, [key]: true }));
      img.src = url;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!intro) return;
    const forward = (key: SlideKey) => {
      const i = slides.findIndex((s) => s.key === key);
      if (i < 0) return;
      driving.current = true;
      go.current?.(i, 1);
      driving.current = false;
    };
    let timer = 0;
    if (at === 'drawing' && loaded.drawing && loaded.painting) {
      timer = window.setTimeout(() => forward('painting'), INTRO_DWELL_MS);
    } else if (at === 'painting' && (shown || failed3d)) {
      timer = window.setTimeout(() => { forward('hero'); setIntro(false); }, INTRO_DWELL_MS);
    }
    return () => window.clearTimeout(timer);
  }, [intro, at, loaded.drawing, loaded.painting, shown, failed3d]); // eslint-disable-line react-hooks/exhaustive-deps
  const partPct = (part: 'painting' | 'hero') => {
    let pct = 0;
    for (const [step, share] of PART_STEPS[part]) {
      if (creation.steps?.find((s) => s.step_name === step)?.status === 'completed') pct += share;
      else if (step === making?.step) pct += (share * Math.max(0, Math.min(100, making.pct))) / 100;
    }
    return Math.min(99, pct);
  };
  const comingLabel = (key: SlideKey) => (key === 'painting' ? 'Painting' : making?.step === 'meshy_3d' ? 'Sculpting in 3D' : 'Bringing to life');

  const artist = creation.name?.trim().split(/\s+/)[0] || '';
  const credit = artist ? `${artist}${creation.age ? `, ${creation.age}` : ''}` : undefined;
  const drawingPic = <SlidePicture thumb={file('thumb_original.jpg')} full={file('original.jpg')} caption={credit} className="tb-slide-pic--drawing" />;
  const paintingPic = <SlidePicture thumb={file(`thumb_${paintingFile}`)} full={file(painted ? PAINTING_FILE : 'original.jpg')} framed={framed} />;

  // The drawing stays in view as a small card on the other slides, and flies
  // into it as you leave the drawing (and out of it, back to full size, as
  // you return): what was drawn is always beside what it became. Not over a
  // painting still being made, which already shows the drawing under its ring.
  const showMini = current.key !== 'drawing' && !(current.key === 'painting' && current.state !== 'ready');
  const mini = useRef<HTMLButtonElement>(null);
  const wasAt = useRef(at);
  const wasMini = useRef(showMini);
  useLayoutEffect(() => {
    const from = wasAt.current;
    const hadMini = wasMini.current;
    wasAt.current = at;
    wasMini.current = showMini;
    if (from === at || reducedMotion()) return;
    const stage = mini.current?.closest('.tb-live-stage') ?? document.querySelector('.tb-live-stage');
    const card = stage?.querySelector<HTMLElement>('.tb-slide[data-slide="drawing"] .tb-slide-card, .tb-slide[data-slide="drawing"] .tb-slide-pic');
    if (!stage || !card) return;
    const ease = 'cubic-bezier(.2, .8, .2, 1)';
    if (from === 'drawing' && showMini && mini.current) {
      // Into the card: from where the drawing was (centred) to the corner.
      const a = card.getBoundingClientRect();
      const b = mini.current.getBoundingClientRect();
      const dx = a.left + a.width / 2 - (b.left + b.width / 2);
      const dy = a.top + a.height / 2 - (b.top + b.height / 2);
      const k = a.width / b.width;
      mini.current.animate(
        [{ transform: `translate(${dx}px, ${dy}px) scale(${k}) rotate(0deg)` }, { transform: 'translate(0, 0) scale(1) rotate(-6deg)' }],
        { duration: LAND_MS + 120, easing: ease },
      );
      card.animate([{ opacity: 0 }, { opacity: 0 }], { duration: LAND_MS + 120 });
    } else if (at === 'drawing' && hadMini) {
      // Out of the card: a copy grows from the corner to where the drawing lands.
      const slide = card.closest<HTMLElement>('.tb-slide');
      const corner = stage.querySelector<HTMLElement>('.tb-mini-anchor');
      if (!slide || !corner) return;
      const s0 = slide.getBoundingClientRect();
      const st = stage.getBoundingClientRect();
      const a = card.getBoundingClientRect();
      const end = { left: a.left - (s0.left - st.left), top: a.top - (s0.top - st.top), width: a.width, height: a.height };
      const b = corner.getBoundingClientRect();
      const ghost = document.createElement('img');
      ghost.src = file('thumb_original.jpg');
      ghost.className = 'tb-mini-ghost';
      Object.assign(ghost.style, { left: `${end.left - st.left}px`, top: `${end.top - st.top}px`, width: `${end.width}px`, height: `${end.height}px` });
      stage.appendChild(ghost);
      const dx = b.left + b.width / 2 - (end.left + end.width / 2);
      const dy = b.top + b.height / 2 - (end.top + end.height / 2);
      const k = b.width / end.width;
      card.animate([{ opacity: 0 }, { opacity: 0 }], { duration: LAND_MS + 120 });
      ghost.animate(
        [{ transform: `translate(${dx}px, ${dy}px) scale(${k}) rotate(-6deg)` }, { transform: 'translate(0, 0) scale(1) rotate(0deg)' }],
        { duration: LAND_MS + 120, easing: ease },
      ).finished.finally(() => ghost.remove());
    }
  }, [at, showMini]); // eslint-disable-line react-hooks/exhaustive-deps
  const drawingIndex = slides.findIndex((s) => s.key === 'drawing');
  const miniCard = (
    <>
      {/* Where the card sits, also while it is hidden: the way back grows from here. */}
      <span className="tb-mini-anchor" aria-hidden="true" />
      {showMini && (
        <button ref={mini} type="button" className="tb-mini-drawing" aria-label="Show the drawing"
          onClick={() => go.current?.(drawingIndex, -1)}>
          <img src={file('thumb_original.jpg')} alt="" draggable={false} />
        </button>
      )}
    </>
  );

  const view = (s: Slide): { label: string; node: ReactNode } => {
    if (s.key === 'drawing') {
      return {
        label: 'The drawing',
        node: (
          <>
            <Opener label="Show the drawing full screen" onOpen={() => setFull('drawing')}>{drawingPic}</Opener>
          </>
        ),
      };
    }
    if (s.state !== 'ready') {
      // A part being made: the picture it is made from, dimmed, under its ring;
      // or, stopped, under what went wrong.
      const from = s.key === 'painting' ? drawingPic : paintingPic;
      const label = s.key === 'painting' ? 'Painted' : `${heroName}, live`;
      if (s.state === 'failed') {
        return {
          label,
          node: (
            <div className="tb-slide-coming tb-slide-coming--failed" role="status">
              <div className="tb-slide-dim">{from}</div>
              <span className="tb-slide-failed-mark"><Icon name="close" size={28} /></span>
              <span className="tb-slide-status tb-slide-status--failed">{making?.failedLabel ?? 'Something went wrong'}</span>
            </div>
          ),
        };
      }
      const pct = Math.floor(partPct(s.key));
      return {
        label,
        node: (
          <div className="tb-slide-coming" role="status" aria-label={`${comingLabel(s.key)}, ${pct}%`}>
            <div className="tb-slide-dim">{from}</div>
            {s.key === 'painting' ? <div className="tb-scanline" /> : <div className="tb-shimmer" />}
            <div className="tb-ring" style={{ ['--p' as string]: `${pct}%` }}><span>{pct}%</span></div>
            <span className="tb-slide-status">{comingLabel(s.key)}</span>
          </div>
        ),
      };
    }
    if (s.key === 'painting') {
      return {
        label: 'Painted',
        node: (
          <>
            <div className="tb-stage-sun" />
            <Opener label="Show the painting full screen" onOpen={() => setFull('painting')}>{paintingPic}</Opener>
          </>
        ),
      };
    }
    return {
      label: `${heroName}, live`,
      node: (
        <>
          <div className="tb-stage-sun" />
          {/* The 3D can't load: the painting stands in for it. */}
          {failed3d && paintingPic}
          <div ref={host} className={`tb-live-canvas${shown ? ' tb-layer--on' : ''}`} />
          <div className={`tb-layer${!shown && !failed3d ? ' tb-layer--on' : ''}`} aria-hidden={shown || failed3d ? true : undefined}>
            <Loading progress={progress}>{paintingPic}</Loading>
          </div>
        </>
      ),
    };
  };

  return (
    <>
      <div className="tb-screen-body">
        {notice}
        <Carousel
          className="tb-stage tb-hero-stage tb-live-stage"
          label={`How ${heroName} was made`}
          slides={slides.map((s) => ({ key: s.key, ...view(s) }))}
          index={index}
          onPick={pick}
          go={go}
          overlay={miniCard}
          data={{ 'data-slide': current.key, 'data-slides': slides.map((s) => (s.state === 'ready' ? s.key : `${s.key}-${s.state}`)).join(','), 'data-shown': shown ? 'hero' : '', 'data-playing': playing ?? '' }}
        />
        {making?.info}
      </div>
      {full && (
        <FullPicture
          title={full === 'drawing' ? 'The drawing' : 'Painted'}
          src={file(full === 'drawing' ? 'original.jpg' : PAINTING_FILE)}
          card={full === 'drawing' || framed}
          caption={full === 'drawing' ? <Caption artist={creation.name} age={creation.age} /> : null}
          onClose={() => setFull(null)}
        />
      )}
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

/** A slide's picture that opens full screen: one tap (Enter or Space from the keyboard). */
function Opener({ label, onOpen, children }: { label: string; onOpen: () => void; children: ReactNode }) {
  return (
    <button type="button" className="tb-slide-open" aria-label={label} onClick={onOpen}>
      {children}
    </button>
  );
}

// ---- The carousel ----

const SNAP_SHARE = 0.18;
/** How long the intro shows each picture before the next (Raz: about a second). */
const INTRO_DWELL_MS = 1000;
/** A slide's move across the stage (HeroLive.css .tb-slide: 260ms), and a beat. */
const LAND_MS = 300;
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const FLICK_PX_PER_MS = 0.35;
const SLOP_PX = 8;

/**
 * Slides side by side in a loop: past the last is the first. Each follows the
 * finger (or the mouse), and on release snaps to the nearest, or on to the
 * next past a fifth of the stage or on a flick (HeroLive.css: under 300ms).
 * The arrow keys and the dots move it too. A drag never counts as a tap.
 */
function Carousel({ slides, index, onPick, go, className, label, data, overlay }: {
  slides: Array<{ key: string; label: string; node: ReactNode }>;
  index: number;
  onPick: (i: number) => void;
  /** Filled in with a way to slide straight to a slide from a given side. */
  go?: MutableRefObject<((i: number, dir: 1 | -1) => void) | null>;
  /** Drawn over the slides, inside the stage (the drawing's small card). */
  overlay?: ReactNode;
  className: string;
  label: string;
  data: Record<string, string>;
}) {
  const n = slides.length;
  const el = useRef<HTMLDivElement>(null);
  // With two slides, the other one waits on the side it will come from.
  const [side, setSide] = useState<1 | -1>(1);
  const [dx, setDx] = useState<number | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; t: number; on: boolean } | null>(null);
  const dragged = useRef(false);
  // Slides held where a straight slide needs them, until it has landed.
  const [pin, setPin] = useState<Map<string, number> | null>(null);
  const unpin = useRef(0);
  useEffect(() => () => window.clearTimeout(unpin.current), []);
  const posOf = (i: number) => {
    const held = pin?.get(slides[i]?.key);
    if (held !== undefined) return held;
    if (n < 2) return 0;
    if (n === 2) return i === index ? 0 : side;
    const d = (((i - index) % n) + n) % n;
    return d > n / 2 ? d - n : d;
  };
  // A slide that wraps round (or is new) jumps there: it never crosses the stage.
  const last = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    last.current = new Map(slides.map((s, i) => [s.key, posOf(i)]));
  });

  const step = (dir: 1 | -1) => {
    if (n < 2) return;
    if (n === 2 && side !== dir) {
      flushSync(() => setSide(dir));
      el.current?.getBoundingClientRect();
    }
    if (n === 2) setSide((-dir) as 1 | -1);
    onPick((index + dir + n) % n);
  };
  const stepRef = useRef(step);
  stepRef.current = step;
  const goTo = (i: number) => {
    if (i === index) return;
    if (n === 2) stepRef.current(side);
    else stepRef.current(posOf(i) > 0 ? 1 : -1);
  };

  // Straight to slide i, coming in from side dir, however far round it is:
  // it waits just off that side, then it and the current slide move together.
  const slideTo = (i: number, dir: 1 | -1) => {
    if (i === index || !slides[i]) return;
    if (n === 2) { stepRef.current(dir); return; }
    const from = slides[index].key;
    flushSync(() => setPin(new Map([[slides[i].key, dir]])));
    el.current?.getBoundingClientRect();
    setPin(new Map([[from, -dir]]));
    onPick(i);
    window.clearTimeout(unpin.current);
    unpin.current = window.setTimeout(() => setPin(null), LAND_MS);
  };
  const slideToRef = useRef(slideTo);
  slideToRef.current = slideTo;
  useEffect(() => {
    if (!go) return;
    go.current = (i, dir) => slideToRef.current(i, dir);
    return () => { go.current = null; };
  }, [go]);

  // The arrow keys, anywhere on the page but in a field or over a sheet.
  useEffect(() => {
    if (n < 2) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      stepRef.current(e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [n]);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    dragged.current = false;
    if (n < 2 || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), on: false };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (!d.on) {
      if (Math.abs(mx) < SLOP_PX && Math.abs(my) < SLOP_PX) return;
      if (Math.abs(my) > Math.abs(mx)) { drag.current = null; return; }
      d.on = true;
      dragged.current = true;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* fine */ }
    }
    if (n === 2 && mx !== 0) {
      const s = mx < 0 ? 1 : -1;
      if (s !== side) setSide(s);
    }
    setDx(mx);
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.on) return;
    const mx = e.clientX - d.x;
    const speed = Math.abs(mx) / Math.max(1, performance.now() - d.t);
    const w = el.current?.clientWidth || 1;
    setDx(null);
    if (Math.abs(mx) > w * SNAP_SHARE || (speed > FLICK_PX_PER_MS && Math.abs(mx) > 24)) {
      const dir = mx < 0 ? 1 : -1;
      if (n === 2) setSide((-dir) as 1 | -1);
      onPick((index + dir + n) % n);
    }
  };
  const cancel = () => { drag.current = null; setDx(null); };

  return (
    <div
      ref={el}
      className={`${className}${dx !== null ? ' tb-carousel--dragging' : ''}`}
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
      {...data}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      // Only the stage's own capture: taking it from the finger's first target
      // (a touch's implicit capture) fires this on that target, and it bubbles.
      onLostPointerCapture={(e) => { if (e.target === e.currentTarget && drag.current?.on) cancel(); }}
      // A drag that ends on a picture is not a tap on it.
      onClickCapture={(e) => { if (dragged.current) { e.preventDefault(); e.stopPropagation(); dragged.current = false; } }}
      onDragStart={(e) => e.preventDefault()}
    >
      {slides.map((s, i) => {
        const pos = posOf(i);
        const was = last.current.get(s.key);
        const jump = was === undefined || Math.abs(was - pos) > 1;
        const off = pos !== 0;
        const style: CSSProperties = {
          transform: `translateX(calc(${pos * 100}% + ${dx ?? 0}px))`,
          ...(dx !== null || jump ? { transition: 'none' } : {}),
        };
        return (
          <div
            key={s.key}
            className="tb-slide"
            data-slide={s.key}
            role="group"
            aria-roledescription="slide"
            aria-label={s.label}
            aria-hidden={off ? true : undefined}
            {...(off ? { inert: '' } : {})}
            style={style}
          >
            {s.node}
          </div>
        );
      })}
      {n > 1 && (
        <div className="tb-carousel-dots">
          {slides.map((s, i) => (
            <button
              key={s.key}
              type="button"
              className="tb-carousel-dot"
              aria-label={s.label}
              aria-current={i === index ? 'true' : undefined}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
      )}
      {overlay}
    </div>
  );
}

/**
 * The drawing or the painting, full screen: a page of the app (cream, the
 * header's round close button), as big as the screen allows, never cropped;
 * two fingers zoom it. Back closes it, back to the same slide. The drawing
 * keeps its white card and its artist's name; a framed painting its card.
 */
function FullPicture({ title, src, card, caption, onClose }: { title: string; src: string; card: boolean; caption: ReactNode; onClose: () => void }) {
  const pinch = usePinchZoom();
  const close = useFullBack(onClose);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  return createPortal(
    <div className="tb-drawing-full" role="dialog" aria-modal="true" aria-label={title}>
      <Header left={<NavButton icon="close" label="Close" onClick={close} />} title={title} />
      <div className="tb-drawing-full-body" {...pinch.handlers}>
        <div className="tb-drawing-full-fit">
          <div className={`tb-live-zoom${pinch.settling ? ' tb-live-zoom--settle' : ''}`} style={{ transform: pinch.transform }}>
            <div className={card ? `tb-live-card${caption ? '' : ' tb-live-card--bare'}` : 'tb-live-plain'}>
              <img className="tb-live-card-img" src={src} alt={title} draggable={false} />
              {caption}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The full-screen picture owns a history entry of its own: Back closes it and
 * leaves the hero's page as it was. Returns the close action, which goes
 * through that entry when it is there.
 */
const FULL_KEY = 'tbDrawingFull';
const onFullEntry = () => !!(window.history.state as Record<string, unknown> | null)?.[FULL_KEY];
function useFullBack(onClose: () => void): () => void {
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    window.history.pushState({ ...(window.history.state ?? {}), [FULL_KEY]: true }, '');
    const onPop = () => { if (!onFullEntry()) cb.current(); };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Closed any other way: drop the entry, so the next Back is not a dead press.
      window.setTimeout(() => { if (onFullEntry()) window.history.back(); }, 0);
    };
  }, []);
  return useCallback(() => { if (onFullEntry()) window.history.back(); else cb.current(); }, []);
}

/** The full drawing's caption: the artist's first name and age. */
function Caption({ artist, age }: { artist?: string | null; age?: number | null }) {
  const first = artist?.trim().split(/\s+/)[0] || '';
  return (
    <span className="tb-live-card-caption" dir="auto">
      {first ? `${first}${age ? `, ${age}` : ''}` : 'The drawing'}
    </span>
  );
}

/** The painting, dimmed, with a ring filling up as the 3D file arrives. */
function Loading({ progress, children }: { progress: number; children: ReactNode }) {
  const pct = Math.round(progress * 100);
  return (
    <div className="tb-live-loading" role="status" aria-label={`Loading ${pct}%`}>
      <div className="tb-slide-dim">{children}</div>
      <div className="tb-ring" style={{ ['--p' as string]: `${pct}%` }}>
        <span>{pct}%</span>
      </div>
    </div>
  );
}

/**
 * A slide's picture, as big as the slide allows and never cropped: the small
 * thumbnail at once (cached from the gallery), the full picture when it lands.
 * Once its shape is known it is sized to it (so a thumbnail is drawn as big as
 * the full picture, and the drawing's rounded corners are its own).
 */
/** The top of the stage the pager dots take: 16px off the top, 16px tall, 8px clear. */
const DOTS_CLEAR = 40;

/** The caption strip under a drawing (HeroLive.css .tb-slide-card-caption). */
const CAPTION_H = 40;

function SlidePicture({ thumb, full, framed = false, caption, className = '' }: { thumb: string; full: string; framed?: boolean; caption?: string; className?: string }) {
  const [src, setSrc] = useState(thumb);
  const [ar, setAr] = useState(0);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setSrc(full);
    img.src = full;
  }, [full]);
  useEffect(() => setSrc(thumb), [thumb]);
  const shown = (e: SyntheticEvent<HTMLImageElement>) => {
    const r = e.currentTarget.naturalWidth / e.currentTarget.naturalHeight;
    if (r > 0 && Math.abs(r - ar) > 0.005) setAr(r);
  };
  const pad = framed ? 8 : 0;
  const capH = caption ? CAPTION_H : 0;
  const style: CSSProperties | undefined = ar
    ? { width: `min(calc(100cqw - ${2 * pad}px), calc((100cqh - ${2 * pad + capH}px) * ${ar}))`, aspectRatio: `${ar}` }
    : undefined;
  const img = <img className={`tb-slide-pic${ar ? '' : ' tb-slide-pic--contain'}${framed ? ' tb-slide-pic--framed' : ''} ${caption ? '' : className}`.trim()} src={src} alt="" style={style} draggable={false} onLoad={shown} />;
  return (
    <div className={`tb-slide-fit${framed ? ' tb-slide-fit--framed' : ''}`}>
      {/* A drawing with its artist: one card, the name on a strip under the
          picture (the gallery tile's card, the polaroid's caption), so the
          name is part of the drawing, not a line of its own. */}
      {caption ? (
        <div className={`tb-slide-card ${className}`.trim()} style={ar ? undefined : { width: '100%', height: '100%' }}>
          {img}
          <span className="tb-slide-card-caption" dir="auto">{caption}</span>
        </div>
      ) : img}
    </div>
  );
}
