import { ReactNode, RefObject, useEffect } from 'react';
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
 * the full name is the tooltip. As a button (the ready hero) it opens How it
 * was made.
 */
export function Polaroid({ src, artist, age, onClick, label }: { src: string; artist?: string | null; age?: number | null; onClick?: () => void; label?: string }) {
  const full = artist?.trim() || '';
  const first = full.split(/\s+/)[0];
  const body = (
    <>
      <img src={src} alt="The drawing" />
      <span className="tb-polaroid-caption" dir="auto" title={full || undefined}>
        <span className="tb-polaroid-name">{first || 'The drawing'}</span>
        {first && age ? <span className="tb-polaroid-age">, {age}</span> : null}
      </span>
    </>
  );
  return onClick
    ? <button type="button" className="tb-polaroid tb-polaroid--button" onClick={onClick} aria-label={label}>{body}</button>
    : <div className="tb-polaroid">{body}</div>;
}

/**
 * Keeps the stage's picture (`.tb-stage-img`, contained, never cropped) clear
 * of the polaroid in its corner. The whole stage is used when the picture does
 * not reach the polaroid; otherwise the picture's box gives up the least room
 * that clears it: from the bottom, or from both sides so it stays centred.
 *
 * Paintings are always a T-pose: the legs stand in the middle and the arms are
 * in the top half, so the picture's lower outer corner is empty floor. The
 * polaroid may cover that much and no more: at most CORNER_W of the picture's
 * width, and nothing above CORNER_H of its height.
 */
const STAGE_PAD = 16;
const POLAROID_GAP = 6;
const CORNER_W = 0.2;
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
      const place = (side: number, bottom: number) => {
        const bw = Math.max(0, W - 2 * side);
        const bh = Math.max(0, H - STAGE_PAD - bottom);
        const w = Math.min(bw, bh * ar);
        const h = w / ar;
        return { side, bottom, bw, bh, w, x: side + (bw - w) / 2, y: STAGE_PAD + (bh - h) / 2, h };
      };
      type Box = ReturnType<typeof place>;
      const clear = (b: Box) => {
        const across = Math.min(b.x + b.w, p.r) - Math.max(b.x, p.l);
        const down = b.y + b.h - p.t;
        if (across <= 0 || down <= 0) return true;
        return across <= CORNER_W * b.w && p.t >= b.y + CORNER_H * b.h;
      };
      let best: Box | null = null;
      for (let bottom = STAGE_PAD; bottom <= H; bottom += 4) {
        const b = place(STAGE_PAD, bottom);
        if (clear(b)) { best = b; break; }
      }
      const fromSides = place(Math.max(STAGE_PAD, p.l < W / 2 ? p.r : W - p.l), STAGE_PAD);
      if (clear(fromSides) && (!best || fromSides.w > best.w)) best = fromSides;
      if (!best || (best.side === STAGE_PAD && best.bottom === STAGE_PAD)) return;
      Object.assign(img.style, {
        left: `${best.side}px`, right: `${best.side}px`, top: `${STAGE_PAD}px`, bottom: `${best.bottom}px`,
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
