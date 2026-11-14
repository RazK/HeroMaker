import { ActionFigureSlide } from './ActionFigure';
import { CSSProperties, MutableRefObject, PointerEvent, ReactNode, SyntheticEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync, createPortal } from 'react-dom';
import { ActionFigure, api, CreationResponse, PAINTING_FILE, paintingFramed } from '../../api/client';
import { heroVrmUrl } from '../../config/play';
import { Icon, IconName } from './Icon';
import { Header, NavButton } from './parts';
import { TileCaption, byLine } from './HeroTile';
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

type SlideKey = 'drawing' | 'painting' | 'hero' | 'figure';
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
 * and a ready hero opens on the hero, whose moves sit on its own slide.
 * A tap on the drawing or the painting opens it full screen.
 *
 * While the hero is being made (`making`), the carousel builds up: the drawing
 * from the start, then a progress slide for the part being made, which becomes
 * that part when it is ready. The carousel moves on to a new part by itself,
 * the one movement it makes alone, and only when its viewer was watching for
 * it (on the progress slide, or never swiped away from where it put them).
 *
 * The stage's foot (the dock, one box) holds what belongs to the slide in
 * view: the drawing and the painting their name card, the live hero its
 * moves, the action figure its controls. Each is ONE element that never moves
 * sideways (Raz: "Why 2 label elements if it's same label? Keep it there"):
 * the slides pass under it, and it fades in and out by how far its slides are
 * from the middle (Dock). Nothing of one slide shows on another.
 */
export function HeroLive({ creation, making, notice, moves = MOVES.map((m) => m.id), figure }: {
  creation: LiveHero;
  making?: Making;
  notice?: ReactNode;
  /** A fourth slide, the hero as an action figure (ActionFigure.tsx): shown
   *  when one is made, or to whoever may make one. `credits` is the viewer's
   *  balance, for a price while figures are for sale. */
  figure?: { credits?: number; initial?: ActionFigure };
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
  if (live && figure) slides.push({ key: 'figure', state: 'ready' });
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
  // Where the action figure's slide puts its dock controls (a portal: they
  // live in the fixed dock, not on the moving slide).
  const [figureDock, setFigureDock] = useState<HTMLDivElement | null>(null);
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
    // The pager dots sit over the top of the stage: keep the hero clear of
    // them, by as much as the layout asks (HeroLive.css --tb-hero-inset: 40px
    // under a phone's dots, a sliver where the hero fills a wide screen).
    const el = host.current;
    const inset = () => s.setInsetTop(heroInset(el));
    inset();
    const ro = new ResizeObserver(inset);
    ro.observe(el);
    let alive = true;
    s.movesReady(vrm).then(() => { if (alive) setMovesReady(true); }, () => {});
    s.showHero(vrm).then(() => { if (alive) setShown(true); }, () => { if (alive) setFailed3d(true); });
    return () => {
      alive = false;
      ro.disconnect();
      s.dispose();
      stage.current = null;
      setShown(false);
      setPlaying(null);
    };
  }, [mod, vrm]);

  // A move tapped before the hero was on stage plays as soon as it is.
  useEffect(() => {
    if (shown && pendingMove.current && stage.current?.play(pendingMove.current)) pendingMove.current = null;
  }, [shown]);

  // The moves are the live hero's own controls: they live on its slide, and
  // a tap plays at once (Raz: "we can't make the drawing do a flip").
  const go = useRef<((i: number, dir: 1 | -1) => void) | null>(null);
  const tap = (id: string) => {
    pendingMove.current = id;
    if (stage.current?.play(id)) pendingMove.current = null;
  };

  const paintingFile = painted ? PAINTING_FILE : 'original.jpg';
  const framed = painted && paintingFramed(creation);

  // The intro waits for each picture before it shows it: never a slide that
  // is still blank. The 3D (shown, or failed: the painting stands in) is
  // loading meanwhile, from the moment the page opened.
  const [loaded, setLoaded] = useState({ drawing: false, painting: false });
  useEffect(() => {
    if (!intro) return;
    const imgs = ([['drawing', file('thumb_original.jpg')], ['painting', file(`thumb_${paintingFile}`)]] as const).map(([key, url]) => {
      const img = new Image();
      img.onload = img.onerror = () => setLoaded((l) => ({ ...l, [key]: true }));
      img.src = url;
      return img;
    });
    // Left before they loaded: nothing to tell.
    return () => { for (const img of imgs) img.onload = img.onerror = null; };
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

  // The drawing is always the gallery's polaroid (Raz): the tile's white
  // frame and tilt, and under it the tile's name card ("by Maya, 6").
  const nameCard = <TileCaption className="tb-live-name" title={creation.character_name?.trim() || 'Your hero'} line={byLine(creation.name, creation.age)} />;
  const drawingPic = <SlidePicture thumb={file('thumb_original.jpg')} full={file('original.jpg')} polaroid />;
  const paintingPic = <SlidePicture thumb={file(`thumb_${paintingFile}`)} full={file(painted ? PAINTING_FILE : 'original.jpg')} framed={framed} trim={painted && !framed} />;

  // The drawing stays in view as a small polaroid on the other slides, and
  // shrinks into it as you leave the drawing (and grows back out of it as you
  // return): what was drawn is always beside what it became. It is ONE
  // polaroid (OneDrawing), placed by how far the drawing's slide is from the
  // middle, so a slow swipe either way never shows two drawings (Raz). Not
  // over a painting still being made, which already shows the drawing under
  // its ring.
  const showMini = current.key !== 'drawing' && !(current.key === 'painting' && current.state !== 'ready');
  const drawingIndex = slides.findIndex((s) => s.key === 'drawing');
  // Over the slides: the one drawing, and the dock with its one name card,
  // one row of moves and the action figure's controls.
  const overStage = (offset: (key: string) => number, dragging: boolean) => {
    // How much of a slide is in the middle: 1 there, 0 a slide or more away.
    const near = (key: string) => Math.max(0, 1 - Math.abs(offset(key)));
    const nearPending = slides.filter((s) => s.state !== 'ready').reduce((a, s) => a + near(s.key), 0);
    const hero = live ? near('hero') : 0;
    const fig = live && figure ? near('figure') : 0;
    // The card is out as far as the slides without it are in: between the
    // hero and the action figure that is all the way (0.5 + 0.5), not half.
    const cardOut = Math.min(1, hero + fig + nearPending);
    return (
      <>
        <OneDrawing
          offset={offset('drawing')}
          dragging={dragging}
          hideAtRest={current.key === 'painting' && current.state !== 'ready'}
          tappable={showMini}
          thumb={file('thumb_original.jpg')}
          onTap={() => go.current?.(drawingIndex, -1)}
        />
        <Dock dragging={dragging} layers={[
          // The name card: on the drawing and a finished painting, so away
          // only as far as the hero, the action figure or a part being made
          // come in. --o-draw: the drawing's share alone (a wide screen shows
          // it on the drawing only; the painting's corner is the small card's).
          { key: 'name', o: 1 - cardOut, vars: { '--o-draw': String(Math.round(near('drawing') * 1000) / 1000) }, node: nameCard },
          ...(movesRow ? [{ key: 'moves', o: hero, node: movesRow }] : []),
          ...(live && figure ? [{ key: 'figure', o: fig, node: null, ref: setFigureDock }] : []),
        ]} />
      </>
    );
  };

  // The live hero's own controls, on its slide only (Raz: "these controls are
  // part of the 3D animation preview"): along the bottom of the stage.
  const movesRow = offered.length > 0 && (
    <div className="tb-hero-moves">
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
    </div>
  );

  const view = (s: Slide): { label: string; node: ReactNode } => {
    if (s.key === 'drawing') {
      return {
        label: 'The drawing',
        node: (
          <>
            <Opener label="Show the drawing full screen" onOpen={() => setFull('drawing')}><div className="tb-live-room">{drawingPic}</div></Opener>
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
      const pct = Math.floor(partPct(s.key === 'painting' ? 'painting' : 'hero'));
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
    if (s.key === 'figure') {
      return {
        label: `${heroName}, the action figure`,
        node: <ActionFigureSlide heroId={creation.id} heroName={heroName} credits={figure?.credits} initial={figure?.initial} picture={paintingPic} dock={figureDock} />,
      };
    }
    if (s.key === 'painting') {
      return {
        label: 'Painted',
        node: (
          <>
            <Opener label="Show the painting full screen" onOpen={() => setFull('painting')}>
              <div className="tb-live-room">
                {SUN && <div className="tb-stage-sun" />}
                {paintingPic}
              </div>
            </Opener>
          </>
        ),
      };
    }
    return {
      label: `${heroName}, live`,
      node: (
        <>
          <div className="tb-live-room">
            {SUN && <div className="tb-stage-sun" />}
            {/* The 3D can't load: the painting stands in for it. */}
            {failed3d && paintingPic}
            <div ref={host} className={`tb-live-canvas${shown ? ' tb-layer--on' : ''}`} />
            <div className={`tb-layer${!shown && !failed3d ? ' tb-layer--on' : ''}`} aria-hidden={shown || failed3d ? true : undefined}>
              <Loading progress={progress}>{paintingPic}</Loading>
            </div>
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
          overlay={overStage}
          data={{ 'data-slide': current.key, 'data-slides': slides.map((s) => (s.state === 'ready' ? s.key : `${s.key}-${s.state}`)).join(','), 'data-shown': shown ? 'hero' : '', 'data-playing': playing ?? '' }}
        />
        {making?.info}
      </div>
      {full && (
        <FullPicture
          title={full === 'drawing' ? 'The drawing' : 'Painted'}
          src={file(full === 'drawing' ? 'original.jpg' : PAINTING_FILE)}
          card={full === 'drawing' || framed}
          caption={full === 'drawing' ? nameCard : null}
          onClose={() => setFull(null)}
        />
      )}
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
  /**
   * Drawn over the slides, inside the stage (the one drawing). Given how far
   * a slide is from the middle right now, in slides (the drag included), and
   * whether a finger is moving them.
   */
  overlay?: (offset: (key: string) => number, dragging: boolean) => ReactNode;
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
      {overlay?.((key) => {
        const i = slides.findIndex((s) => s.key === key);
        if (i < 0) return n;
        return posOf(i) + (dx ?? 0) / (el.current?.clientWidth || 1);
      }, dx !== null)}
    </div>
  );
}

/**
 * The stage's foot: the things that belong to a slide, each ONE element that
 * stays where it is while the slides pass under it (Raz: "Why 2 label
 * elements if it's same label? Keep it there"). Each layer covers the stage
 * (so its contents sit in the dock's box as they did on a slide) and fades by
 * `o`, how much of its slides is in the middle, which a swipe drives: a slow
 * swipe crossfades the name card into the moves in place, and a snap-back
 * fades it back. A layer more out than in is inert (no taps, no focus).
 */
function Dock({ dragging, layers }: {
  dragging: boolean;
  layers: Array<{ key: string; o: number; node: ReactNode; vars?: Record<string, string>; ref?: (el: HTMLDivElement | null) => void }>;
}) {
  return (
    <>
      {layers.map((l) => {
        const on = l.o >= 0.5;
        return (
          <div
            key={l.key}
            ref={l.ref}
            className={`tb-dock-layer tb-dock-layer--${l.key}${dragging ? ' tb-dock-layer--dragging' : ''}`}
            data-dock={l.key}
            style={{ ['--o' as string]: String(Math.round(l.o * 1000) / 1000), ...l.vars } as CSSProperties}
            aria-hidden={on ? undefined : true}
            {...(on ? {} : { inert: '' })}
          >
            {l.node}
          </div>
        );
      })}
    </>
  );
}

/**
 * The drawing, as one polaroid over the stage. On the drawing's slide it is
 * the big polaroid; one slide away it is the small card in the corner; in
 * between (a finger dragging, or the slide's own 260ms move) it is placed and
 * scaled between the two by how far the drawing's slide is from the middle.
 * Both places are marked by invisible stand-ins laid out by the CSS (the
 * drawing slide's picture and the corner button's), so the layout stays the
 * CSS's; this only moves the one picture between them. Never two drawings.
 */
function OneDrawing({ offset, dragging, hideAtRest, tappable, thumb, onTap }: {
  offset: number;
  dragging: boolean;
  /** Hidden when settled away from the drawing (a painting being made shows it already). */
  hideAtRest: boolean;
  tappable: boolean;
  thumb: string;
  onTap: () => void;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const one = useRef<HTMLImageElement>(null);
  const [, remeasure] = useState(0);
  const watched = useRef<Element | null>(null);
  const ro = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    ro.current = new ResizeObserver(() => remeasure((t) => t + 1));
    const stage = btn.current?.closest('.tb-live-stage');
    if (stage) ro.current.observe(stage);
    const small = btn.current?.querySelector('img');
    if (small) ro.current.observe(small);
    return () => ro.current?.disconnect();
  }, []);
  useLayoutEffect(() => {
    const b = btn.current;
    const el = one.current;
    const stage = b?.closest<HTMLElement>('.tb-live-stage');
    const big = stage?.querySelector<HTMLImageElement>('.tb-slide[data-slide="drawing"] .tb-slide-pic.tb-pol');
    const slide = big?.closest<HTMLElement>('.tb-slide');
    const small = b?.querySelector<HTMLImageElement>('img');
    if (!el) return;
    if (!stage || !big || !slide || !small) { el.style.opacity = '0'; return; }
    // The big stand-in can be replaced (its shape becomes known): watch the current one.
    if (watched.current !== big && ro.current) {
      if (watched.current) ro.current.unobserve(watched.current);
      ro.current.observe(big);
      watched.current = big;
    }
    const known = !big.classList.contains('tb-slide-pic--contain') && big.offsetWidth > 0 && small.offsetWidth > 0;
    const st = stage.getBoundingClientRect();
    const br = big.getBoundingClientRect();
    const sr = slide.getBoundingClientRect();
    const mr = small.getBoundingClientRect();
    // The big one's centre with its slide in the middle (a slide only moves
    // sideways), whatever its slide is doing now.
    const bx = br.left + br.width / 2 - sr.left;
    const by = br.top + br.height / 2 - sr.top;
    const mx = mr.left + mr.width / 2 - st.left;
    const my = mr.top + mr.height / 2 - st.top;
    const w = stage.clientWidth || 1;
    const p = Math.min(1, Math.abs(offset));
    // Riding its slide, and drawn towards the corner as the slide leaves.
    const ride = bx + offset * w * (1 - p);
    const x = ride + (mx - ride) * p;
    const y = by + (my - by) * p;
    const k = small.offsetWidth / big.offsetWidth;
    const cs = getComputedStyle(big);
    Object.assign(el.style, {
      width: `${big.offsetWidth}px`,
      height: `${big.offsetHeight}px`,
      left: `${bx - big.offsetWidth / 2}px`,
      top: `${by - big.offsetHeight / 2}px`,
      padding: cs.padding,
      borderRadius: cs.borderRadius,
      transition: dragging || reducedMotion() ? 'none' : 'transform 260ms cubic-bezier(.2, .8, .2, 1), opacity 260ms ease',
    });
    el.style.transform = `translate(${x - bx}px, ${y - by}px) scale(${1 + (k - 1) * p}) rotate(-4deg)`;
    el.style.opacity = !known ? '0' : hideAtRest ? String(1 - p) : '1';
    if (big.currentSrc && el.src !== big.currentSrc) el.src = big.currentSrc;
  });
  return (
    <>
      {/* The corner's stand-in, and what a tap on the small card hits. */}
      <button ref={btn} type="button" className={`tb-mini-drawing${tappable ? '' : ' tb-mini-drawing--away'}`} aria-label="Show the drawing"
        aria-hidden={tappable ? undefined : true} tabIndex={tappable ? undefined : -1} onClick={onTap}>
        <img className="tb-pol" src={thumb} alt="" draggable={false} />
      </button>
      <img ref={one} className="tb-pol tb-one-drawing" src={thumb} alt="" aria-hidden="true" draggable={false} />
    </>
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
            {caption ? (
              <div className="tb-live-polaroid">
                <img className="tb-pol tb-live-polaroid-img" src={src} alt={title} draggable={false} />
                {caption}
              </div>
            ) : (
              <div className={card ? 'tb-live-card tb-live-card--bare' : 'tb-live-plain'}>
                <img className="tb-live-card-img" src={src} alt={title} draggable={false} />
              </div>
            )}
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

/**
 * The sun behind the painting and the live hero. Off (Raz, 2026-11: "do we
 * need the disc at all?"): the figure stands on the plate, grounded by a soft
 * contact shadow (the 3D draws its own; the painting gets .tb-contact). Set
 * true to bring the sun back, behind the upper body (HeroLive.css).
 */
const SUN = false;

/** The band the 3D keeps clear at the top (and bottom): --tb-hero-inset, in px or % of the stage's height. */
function heroInset(el: HTMLElement): number {
  const v = getComputedStyle(el).getPropertyValue('--tb-hero-inset').trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return DOTS_CLEAR;
  return v.endsWith('%') ? (n / 100) * el.clientHeight : n;
}

function SlidePicture({ thumb, full, framed = false, polaroid = false, trim = false }: { thumb: string; full: string; framed?: boolean; polaroid?: boolean; trim?: boolean }) {
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
  const box = useOpaqueBox(trim ? thumb : null, full);
  if (trim && ar && box) {
    // A cut-out painting is sized by the figure, not by the transparent
    // margin round it: the figure fills the slide (nothing in the margin is
    // cut, it is empty), and stands on its contact shadow.
    const bw = box.right - box.left;
    const bh = box.bottom - box.top;
    const arFig = (ar * bw) / bh;
    // Positions in the picture's own pixels, so left/top whatever the
    // writing direction (media are never mirrored).
    const pic: CSSProperties = { position: 'absolute', maxWidth: 'none', maxHeight: 'none', width: `${100 / bw}%`, height: `${100 / bh}%`, left: `${(-box.left / bw) * 100}%`, top: `${(-box.top / bh) * 100}%` };
    return (
      <div className="tb-slide-fit">
        <div className="tb-slide-figure" style={{ width: `min(100cqw, calc(100cqh * ${arFig}))`, aspectRatio: `${arFig}` }}>
          {!SUN && <span className="tb-contact" aria-hidden="true" />}
          <img className="tb-slide-pic" src={src} alt="" style={pic} draggable={false} onLoad={shown} />
        </div>
      </div>
    );
  }
  // The frame is outside the picture (content-box). A polaroid's frame is the
  // gallery's (--tb-pol-pad), and its tilt needs a little room of its own.
  const pad = polaroid ? 'var(--tb-pol-pad)' : `${framed ? 8 : 0}px`;
  const tilt = polaroid ? 0.92 : 1;
  const style: CSSProperties | undefined = ar
    ? { width: `min(calc((100cqw - 2 * ${pad}) * ${tilt}), calc((100cqh - 2 * ${pad}) * ${tilt} * ${ar}))`, aspectRatio: `${ar}` }
    : undefined;
  return (
    <div className={`tb-slide-fit${framed ? ' tb-slide-fit--framed' : ''}`}>
      <img className={`tb-slide-pic${ar ? '' : ' tb-slide-pic--contain'}${framed ? ' tb-slide-pic--framed' : ''}${polaroid ? ' tb-pol' : ''}`} src={src} alt="" style={style} draggable={false} onLoad={shown} />
    </div>
  );
}

/** Where a cut-out's figure is: its opaque pixels' box, as fractions of the picture. */
interface OpaqueBox { left: number; top: number; right: number; bottom: number }

/**
 * Read a cut-out's alpha (its thumbnail, else the picture) for the box its
 * figure fills. Null until known, or when it cannot be read (no CORS, no
 * alpha): the picture is then shown whole, as before.
 */
function useOpaqueBox(url: string | null, fallback: string): OpaqueBox | null {
  const [box, setBox] = useState<OpaqueBox | null>(null);
  useEffect(() => {
    setBox(null);
    if (!url) return;
    let alive = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!alive) return;
      try {
        const k = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * k));
        const h = Math.max(1, Math.round(img.naturalHeight * k));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d', { willReadFrequently: true });
        if (!g) return;
        g.drawImage(img, 0, 0, w, h);
        const d = g.getImageData(0, 0, w, h).data;
        let x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (d[(y * w + x) * 4 + 3] > 16) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
        }
        if (x1 < 0) return;
        // A pixel's slack each side, so nothing faint at the edge is lost.
        const b = { left: Math.max(0, x0 - 1) / w, top: Math.max(0, y0 - 1) / h, right: Math.min(w, x1 + 2) / w, bottom: Math.min(h, y1 + 2) / h };
        // Nothing to gain from a picture that is all figure.
        if (b.right - b.left > 0.97 && b.bottom - b.top > 0.97) return;
        setBox(b);
      } catch { /* not readable here: shown whole */ }
    };
    // No thumbnail (not every cut-out has one): the picture itself.
    img.onerror = () => { if (alive && img.src !== new URL(fallback, location.href).href) img.src = fallback; };
    img.src = url;
    return () => { alive = false; img.onload = img.onerror = null; };
  }, [url, fallback]);
  return box;
}
