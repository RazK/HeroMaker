import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { api, ApiError } from '../../api/client';
import { HeroSummary, SeatsCheckout, Student, dollars } from '../../api/classes';
import { STEP_UI } from '../tb/pipeline';
import { HeroTile, TileArt, makingLine, makingPct } from '../tb/HeroTile';
import { Icon } from '../tb/Icon';
import { Dialog } from '../tb/parts';
import './class.css';

/** Each fitted QR's last size, by `fit` and module count. */
const lastFit = new Map<string, number>();

/**
 * A QR code as crisp SVG: ink on white, a quiet zone of four modules.
 *
 * With `fit` (its largest size in px) it is as big as its box allows instead,
 * on its plate (`.cls-qr-frame`). The size snaps to a whole number of DEVICE
 * pixels per module, so every module is the same size and nothing is
 * resampled: sharp edges from across a room.
 */
export function Qr({ text, size = 220, label, fit }: { text: string; size?: number; label: string; fit?: number }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const q = 4;
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
    return { d, view: n + q * 2 };
  }, [text]);
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  // Back on the class screen, the QR is drawn at its size at once: grown in
  // a moment later, it would push the roster down and lose its scroll.
  const fitKey = `${fit}:${svg.view}`;
  const [fitted, setFitted] = useState(() => lastFit.get(fitKey) ?? 0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!fit || !el) return;
    const measure = () => {
      const f = frame.current ? getComputedStyle(frame.current) : null;
      const plate = f ? parseFloat(f.paddingLeft) + parseFloat(f.paddingRight) : 0;
      // The layout says what bounds the box (class.css, --qr-bound). Only a
      // side the layout sets can be read: a side the QR itself sizes would
      // only ever measure the QR back, and it could never grow.
      const s = getComputedStyle(el);
      const bound = s.getPropertyValue('--qr-bound').trim() || 'width';
      const maxW = parseFloat(s.maxWidth) || Infinity;
      const w = bound === 'height' ? maxW : el.clientWidth;
      const h = bound === 'width' ? Infinity : el.clientHeight;
      const room = Math.min(w, h, fit) - plate;
      const dpr = window.devicePixelRatio || 1;
      const perModule = Math.max(1, Math.floor((room * dpr) / svg.view));
      const px = (perModule * svg.view) / dpr;
      lastFit.set(fitKey, px);
      setFitted(px);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Dragged from the laptop's screen to the projector: a new pixel ratio.
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [fit, svg.view, fitKey]);
  const px = fit ? fitted : size;
  const image = (
    <svg className="cls-qr" width={px} height={px} viewBox={`0 0 ${svg.view} ${svg.view}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={svg.view} height={svg.view} fill="#fff" />
      <path d={svg.d} fill="var(--tb-ink)" />
    </svg>
  );
  if (!fit) return image;
  return <div ref={box} className="cls-qr-fit"><div ref={frame} className="cls-qr-frame">{image}</div></div>;
}

/** The class code, one big digit per box: what a child copies off the board. */
export function PinDigits({ pin, size = 'lg' }: { pin: string; size?: 'lg' | 'md' }) {
  const digits = pin.padEnd(6, ' ').slice(0, 6).split('');
  return (
    <div className={`cls-pin cls-pin--${size}`} aria-label={`Class code ${pin.split('').join(' ')}`}>
      {digits.map((d, i) => (
        <span key={i} className={`cls-pin-box${d.trim() ? ' cls-pin-box--on' : ''}${i === 2 ? ' cls-pin-box--gap' : ''}`} aria-hidden="true">{d.trim()}</span>
      ))}
    </div>
  );
}

/** Seconds left, ticking every second from the server's end time. */
export function useSecondsLeft(endsAt: string | null | undefined): number {
  const end = useMemo(() => (endsAt ? Date.parse(endsAt.endsWith('Z') ? endsAt : `${endsAt}Z`) : 0), [endsAt]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!end) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [end]);
  return end ? Math.max(0, Math.round((end - now) / 1000)) : 0;
}

export function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const painted = (h: HeroSummary) => h.steps_done >= 2;

/** "Maya, 7": the name a hero is labelled with everywhere in a class. */
export const kidLabel = (s: Pick<Student, 'label' | 'age'>) => (s.age ? `${s.label}, ${s.age}` : s.label);

/** A class hero's file, versioned like the gallery's (api.heroFileUrl), so a
 * thumbnail is fetched once and then comes from the browser's cache. */
export const heroThumb = (h: Pick<HeroSummary, 'creation_id' | 'user_id' | 'file_versions'>, f: string) =>
  api.heroFileUrl({ id: h.creation_id, user_id: h.user_id, file_versions: h.file_versions }, f);
const studentFile = heroThumb;

/**
 * One student on the roster or in the class gallery, as THE hero tile
 * (tb/HeroTile.tsx: the gallery's tile, size and grid). The caption is the
 * child ("Maya, 7"), then one line: their hero's name once it is ready, how
 * far it is while it is made ("Sculpting · 45%"), or where they are
 * ("Drawing…", "Wants to join"). A student with no hero yet shows their
 * initial on the plate. With `onOpen`, a tile with a hero opens it, in any
 * state: the steps while it is made. A student waiting for the teacher gets
 * Approve and Block under the tile.
 */
export function StudentTile({ student, index, onOpen, onApprove, onBlock, busy, eager = false }: {
  student: Student;
  index: number;
  onOpen?: () => void;
  onApprove?: () => void;
  onBlock?: () => void;
  busy?: boolean;
  /** Near the top: load the pictures at once (Gallery's first rows). */
  eager?: boolean;
}) {
  const hero = student.hero;
  const state = hero ? hero.state : student.status === 'waiting' ? 'waiting' : student.status === 'blocked' ? 'blocked' : 'joined';
  const ready = hero?.state === 'ready';
  const line =
    state === 'making' && hero ? makingLine(hero.step ? STEP_UI[hero.step]?.short : undefined, makingPct(hero.steps_done, hero.steps_total, true)) :
    state === 'failed' ? 'Didn’t finish' :
    state === 'waiting' ? (student.shared_device ? 'Shared tablet' : 'Wants to join') :
    state === 'blocked' ? 'Blocked' :
    state === 'joined' ? 'Drawing…' : student.claimed ? 'Kept by a parent' : (hero?.character_name || '');
  const drawing = hero && studentFile(hero, 'thumb_original.jpg');
  // The gallery's rule: painted (or ready), the drawing cross-fades to the
  // hero; before that, or if it stopped, the drawing alone.
  const art: TileArt = !hero || !drawing ? { kind: 'initial', letter: student.first_name.slice(0, 1).toUpperCase() }
    : ready || (state === 'making' && painted(hero)) ? { kind: 'fade', drawing, hero: studentFile(hero, 'thumb_rendered.png') }
    : { kind: 'drawing', src: drawing };

  return (
    <div className="cls-tile-wrap" data-state={state}>
      <HeroTile
        art={art}
        alt={ready ? `${student.label}'s hero` : `${student.label}'s drawing`}
        index={index}
        eager={eager}
        pop={ready}
        title={kidLabel(student)}
        line={line}
        tone={state === 'failed' || state === 'blocked' ? 'failed' : 'now'}
        faded={state === 'failed'}
        state={state}
        onClick={onOpen && hero ? onOpen : undefined}
        label={onOpen && hero ? `Open ${student.label}'s hero` : undefined}
        className={onOpen && hero ? 'cls-tile-open' : 'cls-tile-static'}
      />
      {state === 'waiting' && onApprove && (
        <div className="cls-tile-actions">
          <button type="button" className="tb-btn tb-btn--secondary tb-btn--sm tb-btn--full cls-approve" disabled={busy} onClick={onApprove}><Icon name="check" size={18} />Approve</button>
          {onBlock && <button type="button" className="tb-btn tb-btn--secondary tb-btn--sm tb-btn--full cls-block" disabled={busy} onClick={onBlock}>Block</button>}
        </div>
      )}
    </div>
  );
}


/** − n + : a number a thumb can set. */
export function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="cls-stepper" role="group" aria-label={label}>
      <button type="button" className="tb-nav cls-stepper-btn" aria-label="Fewer" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}><span className="cls-minus" /></button>
      <input
        className="cls-stepper-value"
        inputMode="numeric"
        aria-label={label}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value.replace(/\D/g, '') || '0', 10);
          onChange(Math.min(max, Math.max(min, n)));
        }}
      />
      <button type="button" className="tb-nav cls-stepper-btn" aria-label="More" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}><Icon name="plus" /></button>
    </div>
  );
}

/**
 * "Pay $35.50 for 28 seats?": spending money confirms first (BRANDBOOK.md).
 * Paying opens Lemon Squeezy's checkout. The seats arrive on the class by the
 * signed webhook, never because this browser says it paid.
 */
const PAYING_KEY = 'heromaker.class.paying';

/** The class's seat count when its teacher left for the checkout, so the
 * class screen can tell when the bought seats have landed. */
export function seatsBeforeCheckout(classId: string): number {
  try {
    const v = JSON.parse(sessionStorage.getItem(PAYING_KEY) || 'null');
    return v && v.id === classId ? Number(v.seats) || 0 : 0;
  } catch {
    return 0;
  }
}

export function PaySeatsDialog({ seats, cents, title, seatsBefore, open, onClose }: {
  seats: number;
  cents: number;
  title: string;
  seatsBefore: number;
  open: () => Promise<SeatsCheckout>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const price = dollars(cents);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const checkout = await open();
      try { sessionStorage.setItem(PAYING_KEY, JSON.stringify({ id: checkout.class_id, seats: seatsBefore })); } catch { /* fine */ }
      window.location.href = checkout.checkout_url;
    } catch (e) {
      // 502 and 503 are ours, never the teacher's.
      setError(e instanceof ApiError && e.status === 400 ? e.message : 'Payments are unavailable right now.');
      setBusy(false);
    }
  };
  return (
    <Dialog label={`Pay ${price} for ${seats} seats?`} onClose={onClose}>
      <div className="tb-h2">Pay {price} for {seats} {seats === 1 ? 'seat' : 'seats'}?</div>
      <div className="tb-muted">Teacher price. The seats are for {title} only.</div>
      {error && <div className="tb-muted" role="alert" style={{ color: 'var(--tb-red)' }}>{error}</div>}
      <div className="tb-stack">
        <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={onClose}>Not now</button>
        <button type="button" className="tb-btn tb-btn--primary tb-btn--full cls-pay-money" disabled={busy} onClick={go}>
          <Icon name="lock" />{busy ? 'Opening…' : `Pay ${price}`}
        </button>
      </div>
    </Dialog>
  );
}
