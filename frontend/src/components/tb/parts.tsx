import { ReactNode, RefObject, useEffect, useRef, useState } from 'react';
import { DrawingViewer } from './DrawingViewer';
import { Icon, IconName } from './Icon';
import '../../styles/toybox.css';

/** A bottom sheet over a dimmed screen. Tapping the dim area closes it. */
export function Sheet({ title, onClose, children, className = '' }: { title?: string; onClose: () => void; children: ReactNode; className?: string }) {
  useEscape(onClose);
  return (
    <div className="tb-scrim" onClick={onClose}>
      <div className={`tb-sheet ${className}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="tb-sheet-grip" />
        {title && <div className="tb-sheet-title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

/** A centered dialog, for confirmations. */
export function Dialog({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  useEscape(onClose);
  return (
    <div className="tb-scrim tb-scrim--center" onClick={onClose}>
      <div className="tb-dialog" role="alertdialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

export function SheetRow({ icon, label, trail, danger, onClick, href }: { icon: IconName; label: string; trail?: string; danger?: boolean; onClick?: () => void; href?: string }) {
  const cls = `tb-sheet-row${danger ? ' tb-sheet-row--danger' : ''}`;
  const body = (<><Icon name={icon} /><span>{label}</span>{trail && <span className="tb-sheet-row-trail">{trail}</span>}</>);
  return href
    ? <a className={cls} href={href}>{body}</a>
    : <button type="button" className={cls} onClick={onClick}>{body}</button>;
}

/**
 * A setting in a sheet: a row whose trailing edge is an on/off switch. The
 * whole row is the tap. `busy` holds it while the change is saved.
 */
export function SheetToggle({ icon, label, on, busy, onChange, className = '' }: { icon: IconName; label: string; on: boolean; busy?: boolean; onChange: (on: boolean) => void; className?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`tb-sheet-row tb-sheet-toggle ${className}`.trim()}
      disabled={busy} onClick={() => onChange(!on)}>
      <Icon name={icon} /><span>{label}</span><span className="tb-toggle" aria-hidden="true" />
    </button>
  );
}

/** The round button used on both edges of every header. */
export function NavButton({ icon, label, onClick, className = '' }: { icon: IconName; label: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" className={`tb-nav ${className}`} aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

export function Header({ left, title, right, titleClassName = '' }: { left?: ReactNode; title?: string; right?: ReactNode; titleClassName?: string }) {
  return (
    <header className="tb-header">
      <div className="tb-header-side">{left}</div>
      {title && <div className={`tb-header-title ${titleClassName}`.trim()}>{title}</div>}
      <div className="tb-header-side tb-header-side--end">{right}</div>
    </header>
  );
}

export interface StepView { icon: IconName; state: 'done' | 'now' | 'failed' | 'next' }

/** Five connected icons: the whole pipeline at a glance. */
export function Stepper({ steps }: { steps: StepView[] }) {
  return (
    <div className="tb-stepper tb-step-now" role="list" aria-label="Progress">
      {steps.map((s, i) => (
        <div key={i} style={{ display: 'contents' }}>
          <div role="listitem" aria-label={s.state} className={`tb-step-dot tb-step-dot--${s.state}`}>
            <Icon name={s.state === 'done' ? 'check' : s.state === 'failed' ? 'close' : s.icon} size={s.state === 'now' || s.state === 'failed' ? 24 : 18} />
          </div>
          {i < steps.length - 1 && <div className={`tb-step-line${s.state === 'done' ? ' tb-step-line--done' : ''}`} />}
        </div>
      ))}
    </div>
  );
}

/**
 * A toy progress bar: a rounded track with a grape fill that glides to each
 * new value. `showPct` prints the number, for a value someone measured; an
 * estimate shows the bar alone.
 */
export function ProgressBar({ pct, label, valueText, showPct }: { pct: number; label: string; valueText?: string; showPct?: boolean }) {
  const value = Math.max(0, Math.min(100, pct));
  return (
    <div className="tb-progress">
      <div
        className="tb-progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value)}
        aria-valuetext={valueText}
      >
        <div className="tb-progress-fill" style={{ width: `${value}%` }} />
      </div>
      {showPct && <span className="tb-progress-pct" aria-hidden="true">{Math.floor(value)}%</span>}
    </div>
  );
}

/**
 * For screens that fit the viewport exactly (`.tb-screen--fit`): while one is
 * mounted the document itself cannot scroll. Without this, anything in the
 * page that is a pixel taller than the visible area -- on mobile Chrome, any
 * `100vh`, which is the height with the URL bar HIDDEN -- lets the page slide
 * under the finger and drags the header out of view.
 */
let fitScreens = 0;
export function useFitScreen() {
  useEffect(() => {
    const html = document.documentElement;
    fitScreens += 1;
    html.classList.add('tb-no-scroll');
    window.scrollTo(0, 0);
    return () => {
      fitScreens -= 1;
      if (fitScreens === 0) html.classList.remove('tb-no-scroll');
    };
  }, []);
}

/**
 * The kid's drawing as a small tilted polaroid in the stage's corner, with the
 * artist's first name and age under it. The caption is one line that never
 * leaves the card: a long first name ellipsizes, the age always shows, and
 * the full name is the tooltip.
 *
 * Given the full-size `drawing` (original.jpg), it is a button with an enlarge
 * mark: one tap opens the drawing full screen (DrawingViewer), with a toggle
 * to the painted `hero` (rendered.png) when there is one. `src` stays the
 * thumbnail the small card shows.
 *
 * The photo takes the drawing's shape, so there is no empty white beside a
 * tall drawing (Raz): the area of today's 84 x 84 square, at most 96 on the
 * long side and at least 56 on the short one (only a very long or very wide
 * drawing leaves a sliver of margin; nothing is ever cropped). The picture
 * remounts once sized, so its load event (useClearOfPolaroid listens for it)
 * comes with the card at its final size.
 */
export function Polaroid({ src, artist, age, drawing, hero }: { src: string; artist?: string | null; age?: number | null; drawing?: string; hero?: string | null }) {
  const [open, setOpen] = useState(false);
  const [shape, setShape] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => setShape(null), [src]);
  const measure = (img: HTMLImageElement) => {
    const ar = img.naturalWidth / img.naturalHeight;
    if (shape || !(ar > 0)) return;
    const AREA = 84 * 84, LONG = 96, SHORT = 56;
    let w = Math.sqrt(AREA * ar);
    let h = w / ar;
    if (w > LONG) { w = LONG; h = LONG / ar; }
    if (h > LONG) { h = LONG; w = LONG * ar; }
    setShape({ w: Math.round(Math.max(SHORT, w)), h: Math.round(Math.max(SHORT, h)) });
  };
  const size = shape ? { ['--tb-pol-w' as string]: `${shape.w}px`, ['--tb-pol-h' as string]: `${shape.h}px` } : undefined;
  const full = artist?.trim() || '';
  const first = full.split(/\s+/)[0];
  const body = (
    <>
      <img key={shape ? 'sized' : 'square'} src={src} alt="The drawing" onLoad={(e) => measure(e.currentTarget)} />
      <span className="tb-polaroid-caption" dir="auto" title={full || undefined}>
        <span className="tb-polaroid-name">{first || 'The drawing'}</span>
        {first && age ? <span className="tb-polaroid-age">, {age}</span> : null}
      </span>
    </>
  );
  if (!drawing) return <div className="tb-polaroid" style={size}>{body}</div>;
  return (
    <>
      <button
        type="button"
        style={size}
        className="tb-polaroid tb-polaroid--button"
        aria-label={first ? `See ${first}’s drawing` : 'See the drawing'}
        aria-haspopup="dialog"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        {body}
        <span className="tb-polaroid-zoom" aria-hidden="true"><Icon name="expand" size={14} /></span>
      </button>
      {open && <DrawingViewer drawing={drawing} hero={hero} artist={full} age={age} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Keeps the stage's picture (`.tb-stage-img`, contained, never cropped) clear
 * of the polaroid in its corner. The whole stage is used when the picture does
 * not reach the polaroid; otherwise the picture's box gives up the least room
 * that clears it - from the bottom, or from both sides - and the bigger
 * picture wins. It is always centred.
 *
 * Paintings are always a T-pose: the legs stand in the middle and the arms are
 * in the top half, so the picture's lower outer corner is empty floor. The
 * polaroid may cover that much and no more: at most CORNER_W of the picture's
 * width, and nothing above CORNER_H of its height. Renders are framed with
 * the figure in the middle 78% (backend frame_drawing), and a T-pose's feet
 * stand in its middle third, so a third of the width is still empty floor.
 */
const STAGE_PAD = 16;
const POLAROID_GAP = 6;
const CORNER_W = 0.36;
const CORNER_H = 0.5;
export function useClearOfPolaroid(stage: RefObject<HTMLElement>, key: unknown) {
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => {
      const img = el.querySelector<HTMLImageElement>('.tb-stage-img');
      if (!img) return;
      for (const prop of ['left', 'right', 'top', 'bottom', 'width', 'height']) img.style.removeProperty(prop);
      const pol = el.querySelector<HTMLElement>('.tb-polaroid');
      if (!pol || !img.naturalWidth || !img.naturalHeight) return;
      const s = el.getBoundingClientRect();
      const r = pol.getBoundingClientRect();
      const W = s.width;
      const H = s.height;
      const ar = img.naturalWidth / img.naturalHeight;
      // The polaroid's footprint (tilt included) in stage coordinates, plus a gap.
      const p = { l: r.left - s.left - POLAROID_GAP, r: r.right - s.left + POLAROID_GAP, t: r.top - s.top - POLAROID_GAP };
      // A box from `left` to `right` (px from each edge) above `bottom`; the
      // picture is contained and centred in it.
      const place = (left: number, right: number, bottom: number) => {
        const bw = Math.max(0, W - left - right);
        const bh = Math.max(0, H - STAGE_PAD - bottom);
        const w = Math.min(bw, bh * ar);
        const h = w / ar;
        return { left, right, bottom, bw, bh, w, x: left + (bw - w) / 2, y: STAGE_PAD + (bh - h) / 2, h };
      };
      type Box = ReturnType<typeof place>;
      const clear = (b: Box) => {
        const across = Math.min(b.x + b.w, p.r) - Math.max(b.x, p.l);
        const down = b.y + b.h - p.t;
        if (across <= 0 || down <= 0) return true;
        return across <= CORNER_W * b.w && p.t >= b.y + CORNER_H * b.h;
      };
      // The picture always stays centred (Raz: an off-centre hero looks wrong).
      // Two ways to give the polaroid room, and the bigger picture wins: give up
      // the bottom, or give up both sides equally.
      const beside = p.l < W / 2 ? p.r : W - p.l;
      const candidates: Box[] = [];
      for (let bottom = STAGE_PAD; bottom <= H; bottom += 4) {
        const b = place(STAGE_PAD, STAGE_PAD, bottom);
        if (clear(b)) { candidates.push(b); break; }
      }
      candidates.push(place(Math.max(STAGE_PAD, beside), Math.max(STAGE_PAD, beside), STAGE_PAD));
      const best = candidates.filter(clear).reduce<Box | null>((a, b) => (!a || b.w > a.w ? b : a), null);
      if (!best || (best.left === STAGE_PAD && best.right === STAGE_PAD && best.bottom === STAGE_PAD)) return;
      Object.assign(img.style, {
        left: `${best.left}px`, right: `${best.right}px`, top: `${STAGE_PAD}px`, bottom: `${best.bottom}px`,
        width: `${best.bw}px`, height: `${best.bh}px`,
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    // Images do not bubble load; capture catches the picture and the polaroid's.
    el.addEventListener('load', fit, true);
    return () => { ro.disconnect(); el.removeEventListener('load', fit, true); };
  }, [stage, key]);
}

/** useFitScreen for a screen built inline, where a hook cannot go. */
export function NoPageScroll() {
  useFitScreen();
  return null;
}

/**
 * Pull down from the top of any screen, hard, and let go to reload the page.
 *
 * App screens never scroll the page itself (see NoPageScroll: that keeps the
 * phone's toolbar from shrinking and eating taps), so the browser's own
 * pull-to-refresh has nothing to pull. This puts it back, once for the whole
 * app (mounted beside <App /> in main.tsx): a pull counts only when whatever
 * scrolls under the finger is already at its top, and never on a surface that
 * uses drags itself. Touch only: a mouse never fires touch events.
 */
/** How far (after the 0.5 drag resistance) the screen must be pulled to reload. */
const PULL_READY_PX = 60;
/** Finger travel before a touch is read as a pull, a scroll or a swipe. */
const PULL_SLOP_PX = 10;
/**
 * Where a drag means something else: the 3D stage turns the hero, sheets and
 * dialogs scroll and close on their own, a range input slides, the class code
 * keypad is tapped fast. `data-no-pull` opts anything else out.
 */
const NO_PULL = [
  '.tb-stage', '.tb-live-stage', 'canvas', 'video', 'input[type="range"]', '.cls-keypad',
  '.tb-scrim', '[aria-modal="true"]', '[role="dialog"]', '[role="alertdialog"]',
  '[class*="modal-overlay"]', '[class*="modal-backdrop"]', '[data-no-pull]',
].join(',');

/** Whether a drag from here can be a pull, and if so what must be at its top. */
function pullSurface(target: EventTarget | null): (() => boolean) | null {
  let el = target instanceof Element ? target : null;
  if (!el || el.closest(NO_PULL)) return null;
  for (; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    const css = getComputedStyle(el);
    // A drag of its own: touch-action none, or one that leaves the browser
    // no vertical pan (the moves strip's pan-x).
    const ta = css.touchAction;
    if (ta === 'none' || (ta !== 'auto' && ta !== 'manipulation' && !ta.includes('pan-y'))) return null;
    // The nearest ancestor that really scrolls vertically decides.
    if (/(auto|scroll|overlay)/.test(css.overflowY) && el.scrollHeight > el.clientHeight + 1) {
      const scroller = el;
      return () => scroller.scrollTop <= 0;
    }
  }
  // Nothing scrolls under the finger: the page decides. On a fit or app
  // screen it never moves, so it is always at its top.
  return () => window.scrollY <= 0;
}

export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [reloading, setReloading] = useState(false);
  const pullRef = useRef(0);
  useEffect(() => {
    // A touch is undecided until it moves PULL_SLOP_PX. Then it is a pull
    // (down, from the top) or, for the rest of that touch, nothing at all.
    let start: { x: number; y: number; atTop: () => boolean } | null = null;
    let pulling = false;
    const set = (v: number) => { if (v !== pullRef.current) { pullRef.current = v; setPull(v); } };
    const reset = () => { start = null; pulling = false; set(0); };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { reset(); return; }
      const atTop = pullSurface(e.target);
      if (!atTop || !atTop()) { reset(); return; }
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY, atTop };
      pulling = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      if (e.touches.length !== 1) { reset(); return; }
      const dx = e.touches[0].clientX - start.x;
      const dy = e.touches[0].clientY - start.y;
      if (!pulling) {
        if (Math.abs(dx) < PULL_SLOP_PX && Math.abs(dy) < PULL_SLOP_PX) return;
        // Up is a scroll, sideways a swipe: neither is a pull.
        if (dy <= 0 || Math.abs(dx) > dy || !start.atTop()) { reset(); return; }
        pulling = true;
      }
      set(dy <= 0 || !start.atTop() ? 0 : Math.min(120, dy * 0.5));
    };
    const onEnd = () => {
      if (pulling && pullRef.current >= PULL_READY_PX) {
        start = null;
        pulling = false;
        setReloading(true);
        window.location.reload();
        return;
      }
      reset();
    };
    const opts = { passive: true, capture: true };
    document.addEventListener('touchstart', onStart, opts);
    document.addEventListener('touchmove', onMove, opts);
    document.addEventListener('touchend', onEnd, opts);
    document.addEventListener('touchcancel', reset, opts);
    return () => {
      document.removeEventListener('touchstart', onStart, opts);
      document.removeEventListener('touchmove', onMove, opts);
      document.removeEventListener('touchend', onEnd, opts);
      document.removeEventListener('touchcancel', reset, opts);
    };
  }, []);
  if (!pull && !reloading) return null;
  const ready = reloading || pull >= PULL_READY_PX;
  return (
    <div className="tb-ptr" style={{ transform: `translate(-50%, ${reloading ? 60 : pull}px)` }} aria-hidden="true">
      <span className={`tb-ptr-dot${ready ? ' tb-ptr-dot--ready' : ''}${reloading ? ' tb-ptr-dot--spin' : ''}`} style={{ transform: reloading ? undefined : `rotate(${pull * 3}deg)` }}>
        <Icon name="redo" size={20} />
      </span>
    </div>
  );
}
