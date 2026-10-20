import { MouseEvent, TouchEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import './DrawingViewer.css';

/**
 * The kid's drawing, full screen: opened by a tap on the polaroid, anywhere
 * it sits on a stage. The original picture, whole (contained, never cropped)
 * on a dark scrim, with the artist's name and age, and a two-way toggle to
 * the painted hero so the two can be compared.
 *
 * Closes on the close button, a tap on the scrim, a swipe down, Escape, or
 * the Back button: opening it adds a history entry, so Android's back closes
 * the viewer instead of leaving the page. Two fingers zoom in; one finger
 * then moves the picture around.
 *
 * It is a dialog (role, aria-modal), which PullToRefresh already leaves alone.
 */
export function DrawingViewer({ drawing, hero, artist, age, onClose }: {
  /** Full-size files, never thumbnails: original.jpg and rendered.png. */
  drawing: string;
  hero?: string | null;
  artist?: string | null;
  age?: number | null;
  onClose: () => void;
}) {
  const [shown, setShown] = useState<'drawing' | 'hero'>('drawing');
  const [loaded, setLoaded] = useState<Record<string, 'ok' | 'error'>>({});
  const [zoom, setZoom] = useState({ s: 1, x: 0, y: 0 });
  const [drag, setDrag] = useState(0);
  const [settling, setSettling] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const moved = useRef(false);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const pics = useRef<Record<string, HTMLImageElement | null>>({});
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const src = shown === 'hero' && hero ? hero : drawing;
  const mark = (url: string, v: 'ok' | 'error') => setLoaded((all) => (all[url] === v ? all : { ...all, [url]: v }));

  // Both pictures start loading at once, so the toggle is instant.
  useEffect(() => {
    for (const url of [drawing, hero]) {
      if (!url) continue;
      const img = new Image();
      img.onload = () => mark(url, 'ok');
      img.onerror = () => mark(url, 'error');
      img.src = url;
    }
  }, [drawing, hero]);

  // Back closes the viewer: it owns one history entry while it is open.
  useEffect(() => {
    openViewers += 1;
    if (!isViewerEntry()) window.history.pushState({ ...(window.history.state ?? {}), [VIEWER_STATE]: true }, '');
    const onPop = () => { if (!isViewerEntry()) onCloseRef.current(); };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      openViewers -= 1;
      // Gone without Back (the page moved on under it): drop its entry, so the
      // next Back is not a dead press. Deferred, so a remount keeps it.
      window.setTimeout(() => { if (!openViewers && isViewerEntry()) window.history.back(); }, 0);
    };
  }, []);

  const close = () => { if (isViewerEntry()) window.history.back(); else onCloseRef.current(); };

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); before?.focus?.({ preventScroll: true }); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (which: 'drawing' | 'hero') => { setShown(which); setZoom({ s: 1, x: 0, y: 0 }); };

  // ---- Touch: swipe down to close; pinch to zoom; drag a zoomed picture ----
  const onTouchStart = (e: TouchEvent) => {
    setSettling(false);
    const t = e.touches;
    if (t.length === 2) {
      gesture.current = { kind: 'pinch', d0: dist(t), s0: zoom.s, x0: zoom.x, y0: zoom.y, mx: mid(t).x, my: mid(t).y };
    } else if (t.length === 1) {
      moved.current = false;
      gesture.current = { kind: zoom.s > 1 ? 'pan' : 'swipe', px: t[0].clientX, py: t[0].clientY, x0: zoom.x, y0: zoom.y };
    }
  };
  const onTouchMove = (e: TouchEvent) => {
    const g = gesture.current;
    if (!g) return;
    const t = e.touches;
    if (g.kind === 'pinch' && t.length === 2) {
      moved.current = true;
      const s = clamp((g.s0 * dist(t)) / g.d0, 1, MAX_ZOOM);
      setZoom({ s, x: g.x0 + mid(t).x - g.mx, y: g.y0 + mid(t).y - g.my });
      return;
    }
    if (t.length !== 1 || g.kind === 'pinch') return;
    const dx = t[0].clientX - g.px;
    const dy = t[0].clientY - g.py;
    if (Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP) moved.current = true;
    if (g.kind === 'pan') setZoom((z) => ({ ...z, x: g.x0 + dx, y: g.y0 + dy }));
    else setDrag(dy > 0 && dy > Math.abs(dx) ? dy : 0);
  };
  const onTouchEnd = (e: TouchEvent) => {
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (e.touches.length >= 2) return;
      gesture.current = null;
      if (zoom.s < 1.05) { setSettling(true); setZoom({ s: 1, x: 0, y: 0 }); }
      return;
    }
    if (e.touches.length) return;
    gesture.current = null;
    if (g.kind === 'swipe') {
      if (drag > SWIPE_CLOSE_PX) { close(); return; }
      setSettling(true);
      setDrag(0);
    }
  };

  // A tap on the scrim closes, and so does a tap on the empty margin of a
  // contained picture; a tap on the picture itself does not.
  const onScrimClick = (e: MouseEvent) => {
    if (moved.current) { moved.current = false; return; }
    if (zoom.s > 1) return;
    const img = pics.current[src];
    if (img && e.target === img && insidePicture(img, e.clientX, e.clientY)) return;
    close();
  };

  const name = artist?.trim() || '';
  const caption = name ? `${name}${age ? `, ${age}` : ''}` : 'The drawing';
  const state = loaded[src];
  const fade = Math.max(0.35, 1 - drag / 400);

  return createPortal(
    <div
      className="tb-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`${caption}: ${shown === 'hero' ? 'the hero' : 'the drawing'}`}
      data-no-pull
      data-shown={shown}
      style={{ ['--fade' as string]: fade }}
      onClick={(e) => { e.stopPropagation(); onScrimClick(e); }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <div className="tb-viewer-top">
        <button ref={closeBtn} type="button" className="tb-nav tb-viewer-close" aria-label="Close" title="Close" onClick={(e) => { e.stopPropagation(); close(); }}>
          <Icon name="close" />
        </button>
        <div className="tb-viewer-title" dir="auto">{caption}</div>
        <div className="tb-viewer-top-end" />
      </div>
      <div className="tb-viewer-stage">
        <div
          className={`tb-viewer-pics${settling ? ' tb-viewer-pics--settle' : ''}`}
          style={{ transform: `translate3d(${zoom.x}px, ${zoom.y + drag}px, 0) scale(${zoom.s})` }}
        >
          {[drawing, hero].filter((u): u is string => !!u).map((url) => (
            <img
              key={url}
              ref={(el) => { pics.current[url] = el; }}
              className={`tb-viewer-img${url === src && loaded[url] === 'ok' ? ' tb-viewer-img--on' : ''}`}
              src={url}
              alt={url === drawing ? 'The drawing' : 'The hero'}
              draggable={false}
              onLoad={() => mark(url, 'ok')}
              onError={() => mark(url, 'error')}
            />
          ))}
        </div>
        {!state && <div className="tb-viewer-spinner" role="status" aria-label="Loading" />}
        {state === 'error' && <div className="tb-viewer-note" role="status">Can’t show this right now</div>}
      </div>
      {hero && (
        <div className="tb-viewer-bottom">
          <div className="tb-viewer-toggle" role="group" aria-label="Show">
            <button type="button" aria-pressed={shown === 'drawing'} onClick={(e) => { e.stopPropagation(); pick('drawing'); }}>
              <Icon name="pencil" size={20} />Drawing
            </button>
            <button type="button" aria-pressed={shown === 'hero'} onClick={(e) => { e.stopPropagation(); pick('hero'); }}>
              <Icon name="star" size={20} />Hero
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

type Gesture =
  | { kind: 'pinch'; d0: number; s0: number; x0: number; y0: number; mx: number; my: number }
  | { kind: 'pan' | 'swipe'; px: number; py: number; x0: number; y0: number };

const VIEWER_STATE = 'tbViewer';
/** How far a swipe down must travel to close. */
const SWIPE_CLOSE_PX = 90;
/** Finger travel under which a touch is still a tap. */
const TAP_SLOP = 8;
const MAX_ZOOM = 4;
let openViewers = 0;

function isViewerEntry(): boolean {
  const s = window.history.state as Record<string, unknown> | null;
  return !!s && s[VIEWER_STATE] === true;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
type Touches = TouchEvent['touches'];
const dist = (t: Touches) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
const mid = (t: Touches) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });

/** Whether a point is on the picture itself, not the margin `contain` leaves. */
function insidePicture(img: HTMLImageElement, x: number, y: number): boolean {
  const r = img.getBoundingClientRect();
  if (!img.naturalWidth || !img.naturalHeight) return true;
  const k = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
  const w = img.naturalWidth * k;
  const h = img.naturalHeight * k;
  const left = r.left + (r.width - w) / 2;
  const top = r.top + (r.height - h) / 2;
  return x >= left && x <= left + w && y >= top && y <= top + h;
}
