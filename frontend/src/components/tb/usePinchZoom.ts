import { TouchEvent, useCallback, useRef, useState } from 'react';

/** Zoom of one picture: scale, and its offset in px. */
export interface Zoom { s: number; x: number; y: number }
const NONE: Zoom = { s: 1, x: 0, y: 0 };
const MAX_ZOOM = 4;

type Gesture =
  | { kind: 'pinch'; d0: number; s0: number; x0: number; y0: number; mx: number; my: number }
  | { kind: 'pan'; px: number; py: number; x0: number; y0: number };

/**
 * Two fingers zoom a picture (up to 4x); one finger then moves it. Let go
 * near 1x and it settles back. Spread `handlers` on the element that takes
 * the touches (it needs `touch-action: none`) and put `transform` on the
 * picture's wrapper; `settling` is true while it eases back.
 */
export function usePinchZoom() {
  const [zoom, setZoom] = useState<Zoom>(NONE);
  const [settling, setSettling] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const reset = useCallback(() => { gesture.current = null; setZoom(NONE); }, []);

  const onTouchStart = (e: TouchEvent) => {
    setSettling(false);
    const t = e.touches;
    if (t.length === 2) {
      gesture.current = { kind: 'pinch', d0: dist(t), s0: zoom.s, x0: zoom.x, y0: zoom.y, mx: mid(t).x, my: mid(t).y };
    } else if (t.length === 1 && zoom.s > 1) {
      gesture.current = { kind: 'pan', px: t[0].clientX, py: t[0].clientY, x0: zoom.x, y0: zoom.y };
    }
  };
  const onTouchMove = (e: TouchEvent) => {
    const g = gesture.current;
    const t = e.touches;
    if (!g) return;
    if (g.kind === 'pinch' && t.length === 2) {
      const s = Math.min(MAX_ZOOM, Math.max(1, (g.s0 * dist(t)) / g.d0));
      setZoom({ s, x: g.x0 + mid(t).x - g.mx, y: g.y0 + mid(t).y - g.my });
    } else if (g.kind === 'pan' && t.length === 1) {
      setZoom((z) => ({ ...z, x: g.x0 + t[0].clientX - g.px, y: g.y0 + t[0].clientY - g.py }));
    }
  };
  const onTouchEnd = (e: TouchEvent) => {
    const g = gesture.current;
    if (!g || (g.kind === 'pinch' && e.touches.length >= 2) || (g.kind === 'pan' && e.touches.length)) return;
    gesture.current = null;
    if (zoom.s < 1.05) { setSettling(true); setZoom(NONE); }
  };

  return {
    zoom,
    settling,
    reset,
    transform: zoom.s === 1 && !zoom.x && !zoom.y ? undefined : `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.s})`,
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd },
  };
}

type Touches = TouchEvent['touches'];
const dist = (t: Touches) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
const mid = (t: Touches) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
