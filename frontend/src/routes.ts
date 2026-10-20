import { useEffect, useRef } from 'react';

/**
 * The app's addresses. App is one view state machine with no router: these
 * are the screens that have a URL of their own, so Back (Android's too) moves
 * between them inside the app, a reload stays where it was, and a hero can be
 * sent as a link. The legal pages, /reset-password, /claim/ and /join keep
 * their own paths (Legal.tsx, ResetPassword, ClaimScreen, JoinFlow).
 *
 * History entries the app pushes carry `hmDepth` (how many app entries lie
 * under this one) and `hmPrev` (the path of the one right under it), so an
 * in-app Back can go back through history when that is where it leads, and
 * replace the entry when it is not (a link opened from outside).
 *
 * Over a screen, an overlay (a sheet, the drawing or the painting full
 * screen) owns one entry of its own at the same URL, marked with a `tb…: true`
 * key (HeroLive's tbDrawingFull, and OVERLAY_KEY below): Back closes it, not
 * the screen.
 */
export const HERO_PATH = '/hero/';
export const CLASS_PATH = '/class/';
export const ADMIN_PATH = '/admin';
export const ADMIN_USER_PATH = '/admin/users/';

export type HeroFrom = 'gallery' | 'class' | 'admin';

export type Route =
  | { view: 'gallery' }
  | { view: 'hero'; id: string }
  | { view: 'steps'; id: string }
  | { view: 'class'; id: string }
  | { view: 'admin'; userId: string | null };

export const heroPath = (id: string) => `${HERO_PATH}${encodeURIComponent(id)}`;
export const classPath = (id: string) => `${CLASS_PATH}${encodeURIComponent(id)}`;
export const stepsPath = (id: string) => `${heroPath(id)}/steps`;
export const adminPath = (userId?: string | null) => (userId ? `${ADMIN_USER_PATH}${encodeURIComponent(userId)}` : ADMIN_PATH);
/** A hero's own link, to send: anyone can open it, signed in or not. */
export const heroLink = (id: string) => `${window.location.origin}${heroPath(id)}`;

const segment = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

/** The routed screen this path is, or null (another page's path, or unknown). */
export function routeAt(pathname: string): Route | null {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/') return { view: 'gallery' };
  let m = /^\/hero\/([^/]+)(\/steps)?$/.exec(p);
  if (m) return m[2] ? { view: 'steps', id: segment(m[1]) } : { view: 'hero', id: segment(m[1]) };
  m = /^\/class\/([^/]+)$/.exec(p);
  if (m) return { view: 'class', id: segment(m[1]) };
  if (p === ADMIN_PATH || p === '/admin/users') return { view: 'admin', userId: null };
  m = /^\/admin\/users\/([^/]+)$/.exec(p);
  if (m) return { view: 'admin', userId: segment(m[1]) };
  return null;
}

type HistoryState = Record<string, unknown> & { hmDepth?: number; hmPrev?: string; hmFrom?: HeroFrom };
const state = (): HistoryState => (window.history.state as HistoryState | null) ?? {};
const here = () => window.location.pathname;

/** How many overlay entries sit on top of this screen's own entry. */
export function overlayDepth(): number {
  const s = state();
  return Object.keys(s).filter((k) => k.startsWith('tb') && s[k] === true).length;
}

/** The path of the app entry under this one, if the app pushed this one. */
export const prevPath = (): string | undefined => state().hmPrev;

/** Where a hero shown now was opened from (kept across a reload). */
export const heroFrom = (): HeroFrom => state().hmFrom ?? 'gallery';

/**
 * Open a screen at `path`: a new history entry, so Back returns here. On an
 * overlay's entry (a sheet that led here), that entry is replaced instead:
 * Back from the new screen skips the closed sheet.
 */
export function navigate(path: string, extra: { from?: HeroFrom } = {}) {
  // An overlay's entry carries its screen's state, and the screen's own
  // entry is right under it: either way, this screen is what Back returns to.
  const next: HistoryState = { hmDepth: (state().hmDepth ?? 0) + 1, hmPrev: here(), ...(extra.from ? { hmFrom: extra.from } : {}) };
  if (overlayDepth() > 0) window.history.replaceState(next, '', path);
  else window.history.pushState(next, '', path);
}

/** Show `path` in place of this entry (no new Back step), with no overlay over it. */
export function replaceRoute(path: string) {
  const s = state();
  window.history.replaceState({ hmDepth: s.hmDepth ?? 0, hmPrev: s.hmPrev, ...(s.hmFrom ? { hmFrom: s.hmFrom } : {}) }, '', path);
}

/**
 * An in-app Back (or Up) to `parent`. When the entry under this screen is
 * that parent, it is the browser's Back, overlays included, and the screen
 * changes on popstate. Otherwise (opened from a link, or from somewhere else)
 * the entry becomes the parent and `show` draws it at once. Returns whether
 * it went through history.
 */
export function goUp(parent: string, show: () => void): boolean {
  const s = state();
  if ((s.hmDepth ?? 0) > 0 && s.hmPrev === parent) {
    window.history.go(-(1 + overlayDepth()));
    return true;
  }
  window.history.replaceState({ hmDepth: s.hmDepth ?? 0, hmPrev: overlayDepth() > 0 ? here() : s.hmPrev }, '', parent);
  show();
  return false;
}

/**
 * While `active`, an overlay (a sheet, a dialog, the camera) owns one history
 * entry: Back (Android's too) calls `onBack` and leaves the screen under it as
 * it was. Closed any other way, the entry is dropped, so the next Back is not
 * a dead press. Overlays open at once (a sheet swapping for the next) share
 * the one entry. The same contract as HeroLive's useFullBack.
 */
export const OVERLAY_KEY = 'tbSheet';
let overlays = 0;
const onOverlayEntry = () => state()[OVERLAY_KEY] === true;
export function useOverlayBack(active: boolean, onBack: () => void) {
  const cb = useRef(onBack);
  cb.current = onBack;
  useEffect(() => {
    if (!active) return;
    overlays += 1;
    if (!onOverlayEntry()) window.history.pushState({ ...state(), [OVERLAY_KEY]: true }, '');
    let popped = false;
    const onPop = () => { if (!onOverlayEntry()) { popped = true; cb.current(); } };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      overlays -= 1;
      // Deferred, so a sheet swapping for the next (or React's strict-mode
      // remount) keeps the entry.
      if (!popped) window.setTimeout(() => { if (!overlays && onOverlayEntry()) window.history.back(); }, 0);
    };
  }, [active]);
}

/**
 * Leave the app for `href` (a game) from inside an overlay: the overlay's
 * entry is replaced, so the game's Back lands on the screen itself, not on a
 * sheet that is no longer open. A plain click only; a new tab is left alone.
 */
export function leaveFromOverlay(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault: () => void }, href: string) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !overlayDepth()) return;
  e.preventDefault();
  window.location.replace(href);
}
