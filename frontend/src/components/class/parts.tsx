import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { ApiError } from '../../api/client';
import { HeroSummary, SeatsCheckout, Student, dollars, heroFile } from '../../api/classes';
import { STEP_UI } from '../tb/pipeline';
import { Icon } from '../tb/Icon';
import { Dialog } from '../tb/parts';
import './class.css';

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
  const [fitted, setFitted] = useState(0);
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
      setFitted((perModule * svg.view) / dpr);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Dragged from the laptop's screen to the projector: a new pixel ratio.
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [fit, svg.view]);
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

/**
 * One student on the roster or in the class gallery, as a gallery tile: their
 * plate, their hero once it exists, their name on the card. A student who has
 * not made one yet shows their initial on the plate.
 */
export function StudentTile({ student, index, onOpen, onApprove, onBlock, busy }: {
  student: Student;
  index: number;
  onOpen?: () => void;
  onApprove?: () => void;
  onBlock?: () => void;
  busy?: boolean;
}) {
  const hero = student.hero;
  const state = hero ? hero.state : student.status === 'waiting' ? 'waiting' : student.status === 'blocked' ? 'blocked' : 'joined';
  const plate = `tb-plate-${(index % 6) + 1}`;
  const ready = hero?.state === 'ready';
  const pct = hero ? Math.round(((hero.steps_done + (hero.state === 'making' ? 0.5 : 0)) / hero.steps_total) * 100) : 0;
  const status =
    state === 'making' ? (hero?.step ? STEP_UI[hero.step]?.label ?? 'Making' : 'Making') :
    state === 'failed' ? 'Didn’t finish' :
    state === 'waiting' ? (student.shared_device ? 'Shared tablet' : 'Wants to join') :
    state === 'blocked' ? 'Blocked' :
    state === 'joined' ? 'Drawing…' : student.claimed ? 'Kept by a parent' : (hero?.character_name || '');

  const body = (
    <>
      {hero ? (
        <img
          key={ready ? 'hero' : 'art'}
          className={`tb-tile-img${ready ? ' cls-pop' : ' cls-tile-dim'}${state === 'failed' ? ' tb-hero-faded' : ''}`}
          src={heroFile(hero, hero && (ready || painted(hero)) ? 'thumb_rendered.png' : 'thumb_original.jpg')}
          alt={ready ? `${student.label}'s hero` : `${student.label}'s drawing`}
        />
      ) : (
        <span className="cls-tile-initial" aria-hidden="true">{student.first_name.slice(0, 1).toUpperCase()}</span>
      )}
      <span className="tb-tile-card">
        <span className="tb-tile-name" dir="auto">{kidLabel(student)}</span>
        {state === 'making' && <span className="tb-tile-progress"><span style={{ width: `${pct}%` }} /></span>}
        <span className={`tb-tile-status${state === 'failed' || state === 'blocked' ? ' tb-tile-status--failed' : ''}${ready ? ' cls-tile-by' : ''}`}>{status}</span>
      </span>
    </>
  );

  return (
    <div className="cls-tile-wrap" data-state={state}>
      {onOpen && ready ? (
        <button type="button" className={`tb-tile ${plate}`} onClick={onOpen} aria-label={`Open ${student.label}'s hero`}>{body}</button>
      ) : (
        <div className={`tb-tile ${plate} cls-tile-static`}>{body}</div>
      )}
      {state === 'waiting' && onApprove && (
        <div className="cls-tile-actions">
          <button type="button" className="tb-btn tb-btn--secondary tb-btn--sm cls-approve" disabled={busy} onClick={onApprove}><Icon name="check" size={18} />Approve</button>
          {onBlock && <button type="button" className="tb-link cls-block" disabled={busy} onClick={onBlock}>Block</button>}
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
