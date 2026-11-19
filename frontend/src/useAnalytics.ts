/**
 * The analytics that need a component's life: how long a screen was looked
 * at, and which heroes of the gallery were really seen. Each says its one
 * event as the screen is left or the page is hidden, and never touches what
 * is drawn. See analytics.ts for the rules (first-party, no personal data,
 * never throws).
 */
import { RefObject, useEffect, useRef } from 'react';
import { GALLERY_ORDER, ScreenName, flush, pageShown, track } from './analytics';

/**
 * Time on `screen`: one `screen_viewed` when it is left, and when the page is
 * hidden (a phone locked, a tab switched). Time hidden is not counted.
 */
export function useScreenTime(screen: ScreenName): void {
  useEffect(() => {
    pageShown(screen);
    let since = Date.now();
    let showing = document.visibilityState !== 'hidden';
    const say = () => {
      if (!showing) return;
      const seconds = Math.round((Date.now() - since) / 1000);
      if (seconds >= 1) track('screen_viewed', { screen, seconds: Math.min(seconds, 86_400) });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { say(); showing = false; flush(true); }
      else { showing = true; since = Date.now(); }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      say();
    };
  }, [screen]);
}

/** A tile counts as seen once this much of it has been on screen this long. */
const SEEN_SHARE = 0.5;
const SEEN_AFTER_MS = 1000;
/** The backend's MAX_LIST: a visit's list is capped. */
const MAX_SEEN = 200;

/**
 * Which heroes of a gallery were really on screen: ONE `gallery_seen` per
 * visit to a list, said as it is left (a hero opened, another tab, the page
 * hidden), with each hero's id and its place in the grid, in the order they
 * were seen, and the furthest point scrolled to. With `hero_opened` (which
 * carries the place too), that gives impressions and click-through per hero
 * and per place.
 *
 * A tile is `[data-hero][data-pos]` inside `root`; the scroller is the screen
 * body. `listKey` names the list shown (a tab): a new one starts a new visit.
 * `count` is how many tiles there are, so new ones are watched as they load.
 * Ids and whole numbers only.
 */
export function useGallerySeen(root: RefObject<HTMLElement>, listKey: string, ready: boolean, count: number): void {
  const visit = useRef({ ids: [] as string[], positions: [] as number[], known: new Set<string>(), deepest: 0, height: 0 });

  // The visit: begins with the list, ends (and is said) when it is left.
  useEffect(() => {
    const v = visit.current;
    v.ids = []; v.positions = []; v.known = new Set(); v.deepest = 0; v.height = 0;
    const say = () => {
      if (v.ids.length === 0) return;
      const pct = v.height > 0 ? Math.round((100 * v.deepest) / v.height) : 100;
      track('gallery_seen', {
        hero_ids: v.ids, positions: v.positions, order: GALLERY_ORDER,
        max_scroll_pct: Math.max(0, Math.min(100, pct)),
      });
      // Said: what is seen after coming back to the page is a further event,
      // of the heroes not yet counted.
      v.ids = []; v.positions = [];
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') { say(); flush(true); } };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      say();
    };
  }, [listKey]);

  // The watching: each tile, half on screen for a second, is seen once.
  useEffect(() => {
    const list = root.current?.closest<HTMLElement>('.tb-screen-body');
    if (!list || !ready || typeof IntersectionObserver === 'undefined') return;
    const v = visit.current;
    const measure = () => {
      v.deepest = Math.max(v.deepest, list.scrollTop + list.clientHeight);
      v.height = list.scrollHeight;
    };
    measure();
    list.addEventListener('scroll', measure, { passive: true });
    const waiting = new Map<Element, number>();
    const seen = (el: HTMLElement) => {
      waiting.delete(el);
      const id = el.dataset.hero;
      const position = Number(el.dataset.pos);
      if (!id || !Number.isInteger(position) || v.known.has(id) || v.known.size >= MAX_SEEN) return;
      v.known.add(id);
      v.ids.push(id);
      v.positions.push(position);
    };
    const watcher = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        if (entry.isIntersecting) {
          if (!waiting.has(el)) waiting.set(el, window.setTimeout(() => seen(el), SEEN_AFTER_MS));
        } else {
          window.clearTimeout(waiting.get(el));
          waiting.delete(el);
        }
      }
    }, { root: list, threshold: SEEN_SHARE });
    root.current?.querySelectorAll<HTMLElement>('[data-hero]').forEach((el) => watcher.observe(el));
    return () => {
      watcher.disconnect();
      waiting.forEach((t) => window.clearTimeout(t));
      list.removeEventListener('scroll', measure);
    };
  }, [root, listKey, ready, count]);
}
