/**
 * Analytics: who came, through which door, and how far they got
 * (docs/analytics/REQUIREMENTS.md). First-party: events go to our own backend
 * (POST /api/v1/events) and nowhere else. There is no third-party script.
 *
 * Kids use this, so an event is a name from a fixed list plus a few fixed
 * choices or small numbers. Never a name, an email, a drawing or anything
 * typed. The backend holds the allow-list (app/services/analytics.py) and
 * drops whatever is not on it; EVENTS below mirrors it so a wrong call fails
 * to compile.
 *
 * It never slows or breaks the app: events wait in a small queue, go out in
 * the background a couple of seconds later (and as the page is hidden), and
 * a failed send is dropped without a word. Every entry point is wrapped, so
 * nothing here can throw into the app.
 *
 * Who is who:
 * - `visitor`: a random id this browser makes for itself, kept in
 *   localStorage. It says nothing about the person.
 * - `door`: where this browser first came from. The first `?via=<tag>` it
 *   arrives with is kept for later visits; a class's link or code is that
 *   class's door; none is "direct".
 * - The account is never sent in the body: the backend reads it from the
 *   session, once someone signs in.
 */
import { getAuthToken } from './api/client';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const ENDPOINT = `${API_BASE_URL}/api/v1/events`;

export const VISITOR_KEY = 'hm_visitor';
export const DOOR_KEY = 'hm_door';
const ACTIVE_KEY = 'hm_active';

/** A door tag: lowercase letters, digits, - and _. The backend's SLUG_RE. */
const SLUG = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const VIA_PARAM = 'via';
/** A new visit starts after this long with nothing happening. */
const VISIT_GAP_MS = 30 * 60 * 1000;
const FLUSH_AFTER_MS = 2000;
const MAX_BATCH = 40;

/** Every event the browser may send, with the properties it may carry. */
export interface EVENTS {
  visit: { returning: boolean };
  hero_opened: { from: 'gallery' | 'mine' | 'class' | 'link' };
  make_started: Record<string, never>;
  photo_taken: Record<string, never>;
  photo_chosen: Record<string, never>;
  make_choice: { choice: 'moving' | 'toy' | 'both' };
  survey_answered: { purpose: 'fun' | 'gift' | 'class' | 'event' | 'skipped'; who: 'kid' | 'grownup' | 'skipped' };
  signin_shown: Record<string, never>;
  signin_done: { method: 'google' | 'password' | 'signup' };
  credits_shown: Record<string, never>;
  checkout_started: { pack: string };
  wait_left: { minutes: number };
  move_tapped: { move: string };
  game_started: { game: string };
  game_ended: { game: string; seconds: number; score: number };
  share_tapped: Record<string, never>;
}

type Queued = { name: string; props: Record<string, unknown>; at: number };

let queue: Queued[] = [];
let last: Queued | null = null;
let timer: number | undefined;
/** The backend said analytics is off here: nothing more is sent from this page. */
let off = false;
let memoryVisitor: string | null = null;

const read = (key: string): string | null => {
  try { return window.localStorage.getItem(key); } catch { return null; }
};
const write = (key: string, value: string) => {
  try { window.localStorage.setItem(key, value); } catch { /* private mode: this page only */ }
};

function newId(): string {
  try {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(0, 40).padEnd(16, '0');
  }
}

/** This browser's own random id (made on first use). */
export function visitorId(): string {
  const stored = read(VISITOR_KEY);
  if (stored) return stored;
  if (!memoryVisitor) memoryVisitor = newId();
  write(VISITOR_KEY, memoryVisitor);
  return memoryVisitor;
}

/** The door this browser first came through, or null for "direct". */
export function door(): string | null {
  const stored = read(DOOR_KEY);
  return stored && SLUG.test(stored) ? stored : null;
}

/** Keep `tag` as this browser's door, unless it already has one. */
export function setDoor(tag: unknown): void {
  try {
    if (typeof tag !== 'string') return;
    const clean = tag.trim().toLowerCase();
    if (!SLUG.test(clean) || door()) return;
    write(DOOR_KEY, clean);
  } catch { /* never the app's problem */ }
}

const device = (): 'phone' | 'desktop' => {
  try { return window.matchMedia('(min-width: 900px)').matches ? 'desktop' : 'phone'; } catch { return 'phone'; }
};
/** An automated browser (the staging robot): stored, and left out of every graph. */
const robot = (): boolean => {
  try { return navigator.webdriver === true; } catch { return false; }
};

function body(batch: Queued[]): string {
  const now = Date.now();
  return JSON.stringify({
    visitor: visitorId(),
    door: door(),
    device: device(),
    robot: robot(),
    events: batch.map((e) => ({ name: e.name, props: e.props, ago: Math.max(0, Math.round((now - e.at) / 1000)) })),
  });
}

/**
 * Send what is waiting. `leaving`: the page is being hidden or left, so the
 * request must outlive it (keepalive; sendBeacon where that is refused).
 */
export function flush(leaving = false): void {
  try {
    window.clearTimeout(timer);
    timer = undefined;
    if (off || queue.length === 0) { queue = []; return; }
    const batch = queue.slice(0, MAX_BATCH);
    queue = queue.slice(MAX_BATCH);
    const payload = body(batch);
    const token = getAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const beacon = () => {
      try { navigator.sendBeacon?.(ENDPOINT, new Blob([payload], { type: 'text/plain;charset=UTF-8' })); } catch { /* dropped */ }
    };
    try {
      fetch(ENDPOINT, { method: 'POST', headers, body: payload, keepalive: true })
        .then((r) => (r.ok ? r.json() : null))
        .then((answer) => { if (answer && answer.off === true) { off = true; queue = []; } })
        .catch(() => { if (leaving) beacon(); });
    } catch {
      if (leaving) beacon();
    }
    if (queue.length > 0) schedule();
  } catch { /* dropped */ }
}

function schedule(): void {
  if (timer !== undefined) return;
  timer = window.setTimeout(() => flush(), FLUSH_AFTER_MS);
}

/** Record one event. Never throws, never waits. */
export function track<K extends keyof EVENTS>(
  name: K,
  ...props: EVENTS[K] extends Record<string, never> ? [] : [EVENTS[K]]
): void {
  try {
    if (off) return;
    const event: Queued = { name, props: (props[0] ?? {}) as Record<string, unknown>, at: Date.now() };
    // The same thing said twice in the same instant (a sheet that mounts
    // twice, a double tap) is one event.
    if (last && last.name === event.name && event.at - last.at < 500 && JSON.stringify(last.props) === JSON.stringify(event.props)) return;
    last = event;
    queue.push(event);
    write(ACTIVE_KEY, String(Date.now()));
    if (queue.length >= MAX_BATCH) flush();
    else schedule();
  } catch { /* dropped */ }
}

let started = false;

/**
 * Once, as the page loads: read the door from `?via=`, count the visit, and
 * send whatever is waiting whenever the page is hidden or left.
 */
export function startAnalytics(): void {
  try {
    if (started) return;
    started = true;
    setDoor(new URLSearchParams(window.location.search).get(VIA_PARAM));
    // A visit is a sitting, not a page load: a reload, or coming back from
    // checkout, within half an hour is the same visit.
    const last = Number(read(ACTIVE_KEY) || 0);
    if (!last || Date.now() - last > VISIT_GAP_MS) track('visit', { returning: last > 0 });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });
    window.addEventListener('pagehide', () => flush(true));
  } catch { /* never the app's problem */ }
}
