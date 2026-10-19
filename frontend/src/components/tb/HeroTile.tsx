import { ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './HeroTile.css';

/**
 * THE hero tile: every place a hero shows as a card uses this one, in this
 * one grid (TileGrid). The gallery's tabs, the class page's students (live
 * and after class) and the My classes cards' shelf. Same plate, same
 * polaroid, same caption, same size; Raz: "keep it consistent across the app".
 *
 * The caption is two lines and only two, whatever the hero's state:
 *
 *   Speckle Sally          Maya, 7                  Noa, 7
 *   by Raz, 11             Sculpting · 45%          Drawing…
 *
 * A hero being made says how far it is in words on the second line. There is
 * no progress bar squeezed between the lines: it had 2px either side of it
 * and cut the name's descenders ("Too dense", Raz, v2.0.27).
 *
 * Without a title the tile is art only (the My classes shelf): no caption,
 * so the picture is centred on the plate instead of standing above one.
 */

/** What the tile's plate shows. */
export type TileArt =
  /** A finished (or painted) hero: the drawing as a polaroid, cross-fading to the hero. */
  | { kind: 'fade'; drawing: string; hero: string }
  /** The drawing alone, as a polaroid: nothing painted yet, or it stopped. */
  | { kind: 'drawing'; src: string }
  /** No drawing yet: the child's initial in a white disc. */
  | { kind: 'initial'; letter: string };

/** The second line's colour: who made it (ink-2), what is happening (grape), it stopped (red). */
export type TileTone = 'by' | 'now' | 'failed';

export function HeroTile({
  art, alt, index, title, line, tone = 'by', faded = false, eager = false, pop = false,
  onClick, label, state, size = 'tile', className = '',
}: {
  art: TileArt;
  /** The picture's alt text. */
  alt: string;
  /** Its place in the list: picks the plate (1 to 6 in turn) and its slot in the cross-fade wave. */
  index: number;
  /** First line (display font). Leave it out for an art-only tile. */
  title?: ReactNode;
  /** Second line (body font, small). */
  line?: ReactNode;
  tone?: TileTone;
  /** It stopped: the picture greyed (failed). */
  faded?: boolean;
  /** Near the top of the list: load the pictures at once. */
  eager?: boolean;
  /** Pop the picture in once, when it first appears (a hero just finished in class). */
  pop?: boolean;
  /** Tapping opens it. Without, the tile is a plain block. */
  onClick?: () => void;
  /** The button's accessible name, when the caption alone does not say it. */
  label?: string;
  /** data-state, for styling and the robot. */
  state?: string;
  size?: 'tile' | 'mini';
  className?: string;
}) {
  const captioned = title !== undefined;
  const cls = [
    'tb-tile',
    `tb-plate-${(index % 6) + 1}`,
    size === 'mini' ? 'tb-tile--mini' : '',
    captioned ? '' : 'tb-tile--art',
    onClick ? '' : 'tb-tile--static',
    className,
  ].filter(Boolean).join(' ');

  let picture: ReactNode;
  if (art.kind === 'fade') {
    picture = <TileFade drawing={art.drawing} hero={art.hero} name={alt} index={index} eager={eager} />;
  } else if (art.kind === 'drawing') {
    picture = (
      <span className="tb-tile-art">
        <span className="tb-tile-drawing tb-tile-drawing--still"><img src={art.src} alt={alt} {...imgLoading(eager, true)} /></span>
      </span>
    );
  } else {
    picture = <span className="tb-tile-initial-box" aria-hidden="true"><span className="tb-tile-initial">{art.letter}</span></span>;
  }
  if (faded) picture = <span className="tb-tile-art tb-hero-faded">{picture}</span>;
  if (pop) picture = <span className="tb-tile-art tb-tile-pop">{picture}</span>;

  const body = (
    <>
      {picture}
      {captioned && (
        <span className="tb-tile-card">
          <span className="tb-tile-name" dir="auto">{title}</span>
          {line !== undefined && line !== '' && (
            <span className={`tb-tile-line tb-tile-line--${tone}${tone === 'by' ? ' tb-tile-by' : ' tb-tile-status'}${tone === 'failed' ? ' tb-tile-status--failed' : ''}`} dir="auto">{line}</span>
          )}
        </span>
      )}
    </>
  );

  return onClick ? (
    <button type="button" className={cls} data-state={state} onClick={onClick} aria-label={label}>{body}</button>
  ) : (
    <span className={cls} data-state={state}>{body}</span>
  );
}

/**
 * "Sculpting · 45%": what a hero being made says on its second line. The
 * word gives way (ellipsis) before the number does: the % is never cut.
 */
export function makingLine(step: string | undefined, pct: number): ReactNode {
  return (
    <span className="tb-tile-making">
      <span className="tb-tile-making-step">{step || 'Making'}</span>
      <span className="tb-tile-making-pct">&nbsp;·&nbsp;{Math.max(0, Math.min(99, Math.round(pct)))}%</span>
    </span>
  );
}

/**
 * How far a hero being made is, as a whole: the steps done, plus the running
 * step's share (its real progress when the provider reports one, else half).
 */
export function makingPct(done: number, total: number, running: boolean, stepFraction = 0.5): number {
  if (!total) return 0;
  return ((done + (running ? Math.max(0, Math.min(1, stepFraction)) : 0)) / total) * 100;
}

/** The one grid tiles sit in: 2 columns on a phone, 3 and 4 as there is room (the gallery's). */
export function TileGrid({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`tb-tiles ${className}`.trim()}><div className="tb-tiles-grid tb-gallery-grid">{children}</div></div>;
}

/** A tile-sized placeholder while the list loads. */
export function SkeletonTile({ index }: { index: number }) {
  return <span className={`tb-tile tb-tile--skeleton tb-plate-${(index % 6) + 1}`} />;
}

/**
 * How a tile's pictures load. The first rows load at once, the drawing (what
 * the tile shows first) at high priority; the rest are left to the browser
 * until they are scrolled near. Decoding never holds up the page.
 * (fetchpriority in lower case: React 18 does not know the attribute yet.)
 */
export function imgLoading(eager: boolean, first: boolean) {
  return {
    loading: eager ? 'eager' : 'lazy',
    decoding: 'async',
    ...(eager && first ? { fetchpriority: 'high' } : {}),
  } as const;
}

/** One full cycle of the cross-fade, in seconds. Must match `.tb-tile-fade--on` in HeroTile.css. */
const FADE_CYCLE_S = 4;
/** Each tile runs this far behind the one before it: a wave across the gallery. */
const FADE_STAGGER_S = 0.3;

/**
 * Where tile `index` should be in its cycle right now, on ONE clock shared by
 * every tile (the page's performance.now()), as a negative animation-delay.
 *
 * A tile starts animating only once its images load, and they load at random
 * times; a plain per-tile delay was measured from that moment, so the wave
 * broke up into tiles flipping together or out of order. Measuring from the
 * shared clock puts a tile straight into its slot in the wave whenever it
 * starts, so neighbours always stay exactly FADE_STAGGER_S apart.
 */
function wavePhaseDelay(index: number): string {
  const now = performance.now() / 1000;
  const phase = (((now - index * FADE_STAGGER_S) % FADE_CYCLE_S) + FADE_CYCLE_S) % FADE_CYCLE_S;
  return `${(-phase).toFixed(3)}s`;
}

/**
 * The kid's drawing and the hero render stacked, cross-fading between the
 * two. The animation is pure CSS (HeroTile.css); this only starts it once
 * BOTH images have loaded, so a tile never fades to a blank plate. Neither
 * waits for the other: whichever loads first shows at once, the drawing
 * preferred (the story starts there, and it is asked for first); if it
 * fails, the tile shows the render for good.
 */
export function TileFade({ drawing, hero, name, index, eager }: { drawing: string; hero: string; name: string; index: number; eager: boolean }) {
  const [loaded, setLoaded] = useState({ drawing: false, hero: false });
  const [drawingFailed, setDrawingFailed] = useState(false);
  const drawingRef = useRef<HTMLImageElement>(null);
  const heroRef = useRef<HTMLImageElement>(null);
  const done = (k: 'drawing' | 'hero') => setLoaded((l) => (l[k] ? l : { ...l, [k]: true }));

  // An image already in the cache can finish before React attaches onLoad.
  // Checked before the first paint, so a gallery coming back shows its
  // pictures (and joins the wave) in its very first frame.
  useLayoutEffect(() => {
    if (drawingRef.current?.complete && drawingRef.current.naturalWidth) done('drawing');
    if (heroRef.current?.complete && heroRef.current.naturalWidth) done('hero');
  }, []);

  const fading = loaded.drawing && loaded.hero && !drawingFailed;
  // Computed once, at the moment the tile joins the wave.
  const delay = useMemo(() => (fading ? wavePhaseDelay(index) : '0s'), [fading, index]);

  return (
    <span className={`tb-tile-fade${loaded.drawing && !drawingFailed ? ' tb-tile-fade--drawn' : ''}${fading ? ' tb-tile-fade--on' : ''}`} style={{ ['--tb-fade-delay' as string]: delay }}>
      <span className="tb-tile-drawing" aria-hidden="true">
        {!drawingFailed && (
          <img ref={drawingRef} src={drawing} alt="" {...imgLoading(eager, true)} onLoad={() => done('drawing')} onError={() => setDrawingFailed(true)} />
        )}
      </span>
      <img ref={heroRef} className="tb-tile-img tb-tile-hero" src={hero} alt={name} {...imgLoading(eager, false)} onLoad={() => done('hero')} />
    </span>
  );
}
