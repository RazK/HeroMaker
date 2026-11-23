import { CSSProperties, MutableRefObject, PointerEvent, ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

const SNAP_SHARE = 0.18;
/** A slide's move across the stage (HeroLive.css .tb-slide: 260ms), and a beat. */
const LAND_MS = 300;
export const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const FLICK_PX_PER_MS = 0.35;
const SLOP_PX = 8;

/**
 * Slides side by side in a loop: past the last is the first. Each follows the
 * finger (or the mouse), and on release snaps to the nearest, or on to the
 * next past a fifth of the stage or on a flick (HeroLive.css: under 300ms).
 * The arrow keys and the dots move it too. A drag never counts as a tap.
 */
export function Carousel({ slides, index, onPick, go, jump, dots = true, className, label, data, overlay }: {
  slides: Array<{ key: string; label: string; node: ReactNode }>;
  index: number;
  onPick: (i: number) => void;
  /** Filled in with a way to slide straight to a slide from a given side. */
  go?: MutableRefObject<((i: number, dir: 1 | -1) => void) | null>;
  /** Filled in with a way to go to a slide, as a dot does (the chapters). */
  jump?: MutableRefObject<((i: number) => void) | null>;
  /** The pager dots over the stage (the hero's own page has its chapters instead). */
  dots?: boolean;
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
  // A dot goes to its own slide, however far round (it used to step one
  // slide toward it, so on four slides a dot two away landed on the wrong one).
  const goTo = (i: number) => {
    if (i === index) return;
    if (n === 2) { stepRef.current(side); return; }
    const p = posOf(i);
    if (Math.abs(p) === 1) stepRef.current(p > 0 ? 1 : -1);
    else slideToRef.current(i, p > 0 ? 1 : -1);
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
  const goToRef = useRef(goTo);
  goToRef.current = goTo;
  useEffect(() => {
    if (!jump) return;
    jump.current = (i) => goToRef.current(i);
    return () => { jump.current = null; };
  }, [jump]);

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
      {dots && n > 1 && (
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
