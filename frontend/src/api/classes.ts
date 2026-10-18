/**
 * Classes: the teacher's, the student's and the parent's calls.
 * Backend: backend/app/api/classes.py. Product: docs/product/class-sessions.md.
 *
 * A student has no account. Joining gives their browser a one-hero PASS and a
 * browser MARKER. The server also sets both as httpOnly cookies on /api/class;
 * this copy in localStorage is sent as headers, so a pass survives wherever
 * one of the two does. Every student call answers 403, never 401, so a
 * teacher signed in on the same tablet is never signed out by it.
 */
import { fetchJson, shrinkPhoto } from './client';

const BASE = import.meta.env.VITE_API_BASE_URL || '';

export type HeroState = 'making' | 'ready' | 'failed';

export interface HeroSummary {
  creation_id: string;
  user_id: string;
  character_name: string | null;
  state: HeroState;
  step: string | null;
  steps_done: number;
  steps_total: number;
}

export interface Student {
  id: string;
  first_name: string;
  label: string;
  age: number | null;
  status: 'approved' | 'waiting' | 'blocked';
  shared_device: boolean;
  session_id: string;
  claimed: boolean;
  hero: HeroSummary | null;
  joined_at: string;
}

export interface LiveSession {
  id: string;
  pin: string;
  join_path: string;
  ends_at: string;
  seconds_left: number;
  open: boolean;
  approve_first: boolean;
}

export type SchoolType = 'kindergarten' | 'primary' | 'after_school' | 'other';

/** A teacher's school, asked once before the first class. */
export interface School {
  name: string;
  type: SchoolType;
  city: string | null;
  country: string | null;
}

/** The children's ages, picked on the class sheet (backend AGE_BANDS). */
export const AGE_BANDS = ['3-4', '5-6', '7-8', '9-10', '11+'] as const;
export const agesLabel = (ages: string) => `Ages ${ages.replace('-', '–')}`;

export interface ClassView {
  id: string;
  title: string;
  ages: string | null;
  seats: number;
  seats_used: number;
  seats_left: number;
  hero_cost: number;
  created_at: string;
  live: LiveSession | null;
  sessions: number;
  heroes_ready: number;
  preview: Array<{ creation_id: string; user_id: string; label: string }>;
  roster?: Student[];
  /** Only on GET /api/classes/{id}. */
  seat_price?: SeatPrice | null;
}

/**
 * The teacher price for seats bought with money for one class: a part per
 * order plus a part per seat (backend/app/config/packs.py has the numbers and
 * proves their margin). null when the store has no class-seats variant: then
 * the option is not shown at all.
 */
export interface SeatPrice {
  order_cents: number;
  seat_cents: number;
  max_seats: number;
}

export const seatsCents = (p: SeatPrice, seats: number) => p.order_cents + p.seat_cents * seats;
export const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export interface SeatsCheckout {
  checkout_url: string;
  class_id: string;
  seats: number;
  price_display: string;
  test_mode: boolean;
}

/** Where Lemon Squeezy sends the teacher back: the class, which shows its
 * seats arriving. The backend fills in {class_id}. App.tsx reads it. */
export const CLASS_PAID_PARAM = 'class_paid';
const seatsReturnUrl = () => `${window.location.origin}/?${CLASS_PAID_PARAM}={class_id}`;

export interface GuestView {
  guest: { id: string; first_name: string; age: number | null; status: Student['status'] };
  class: { id: string; title: string; open: boolean; seconds_left: number };
  hero: HeroSummary | null;
  can_make: boolean;
  reason: string | null;
  claim_path: string | null;
  claimed: boolean;
}

export interface ClaimView {
  first_name: string;
  age: number | null;
  class_title: string;
  hero: HeroSummary | null;
  claimed: boolean;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const teacherApi = {
  list: () => fetchJson<{ classes: ClassView[]; hero_cost: number; school: School | null; seat_price: SeatPrice | null }>(`${BASE}/api/classes`),
  saveSchool: (school: { name: string; type: SchoolType; city: string; country: string }) =>
    fetchJson<{ school: School }>(`${BASE}/api/classes/school`, { ...json(school), method: 'PUT' }),
  get: (id: string) => fetchJson<ClassView>(`${BASE}/api/classes/${id}`),
  create: (title: string, seats: number, ages: string | null = null) =>
    fetchJson<ClassView>(`${BASE}/api/classes`, json({ title, seats, ages })),
  addSeats: (id: string, seats: number) => fetchJson<ClassView>(`${BASE}/api/classes/${id}/seats`, json({ seats })),
  /** A checkout at the class price; the webhook adds the seats when paid. */
  buyNew: (title: string, seats: number, ages: string | null = null) =>
    fetchJson<SeatsCheckout>(`${BASE}/api/classes/buy`, json({ title, seats, ages, redirect_url: seatsReturnUrl() })),
  buySeats: (id: string, seats: number) =>
    fetchJson<SeatsCheckout>(`${BASE}/api/classes/${id}/buy`, json({ seats, redirect_url: seatsReturnUrl() })),
  start: (id: string, minutes: number, approveFirst: boolean) =>
    fetchJson<ClassView>(`${BASE}/api/classes/${id}/start`, json({ minutes, approve_first: approveFirst })),
  extend: (id: string, minutes = 15) => fetchJson<ClassView>(`${BASE}/api/classes/${id}/extend`, json({ minutes })),
  end: (id: string) => fetchJson<ClassView>(`${BASE}/api/classes/${id}/end`, { method: 'POST' }),
  student: (id: string, studentId: string, action: 'approve' | 'block') =>
    fetchJson<ClassView>(`${BASE}/api/classes/${id}/students/${studentId}/${action}`, { method: 'POST' }),
};

// ---- the student's browser ------------------------------------------------

const PASS_KEY = 'heromaker.class.pass';
const MARKER_KEY = 'heromaker.class.device';

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch { /* private window: the cookies still carry it */ }
}

function studentHeaders(): Headers {
  const h = new Headers();
  const pass = read(PASS_KEY);
  const marker = read(MARKER_KEY);
  if (pass) h.set('X-Class-Pass', pass);
  if (marker) h.set('X-Class-Device', marker);
  return h;
}

function studentFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = studentHeaders();
  new Headers(init.headers).forEach((v, k) => headers.set(k, v));
  return fetchJson<T>(url, { ...init, headers, credentials: 'same-origin' });
}

export const studentApi = {
  hasPass: () => !!read(PASS_KEY),
  find: async (pin: string) => {
    const r = await studentFetch<{ title: string; seats_left: number; seconds_left: number; device_token: string; joined: boolean }>(
      `${BASE}/api/class/join/${encodeURIComponent(pin)}`);
    if (r.device_token) write(MARKER_KEY, r.device_token);
    return r;
  },
  join: async (pin: string, firstName: string, age: number | null) => {
    const r = await studentFetch<GuestView & { pass: string | null; device_token: string }>(
      `${BASE}/api/class/join`, json({ pin, first_name: firstName, age }));
    if (r.pass) write(PASS_KEY, r.pass);
    if (r.device_token) write(MARKER_KEY, r.device_token);
    return r;
  },
  me: () => studentFetch<GuestView>(`${BASE}/api/class/me`),
  makeHero: async (file: File, style: string) => {
    const form = new FormData();
    const upload = await shrinkPhoto(file);
    form.append('image_file', upload, upload.name);
    form.append('style', style);
    return studentFetch<GuestView>(`${BASE}/api/class/me/hero`, { method: 'POST', body: form });
  },
  retry: () => studentFetch<GuestView>(`${BASE}/api/class/me/hero/retry`, { method: 'POST' }),
  /** "Next student" on a shared tablet: this browser forgets the pass, keeps its marker. */
  leave: async () => {
    write(PASS_KEY, null);
    await studentFetch<{ ok: boolean }>(`${BASE}/api/class/leave`, { method: 'POST' }).catch(() => undefined);
  },
};

// ---- the parent -------------------------------------------------------------

export const claimApi = {
  see: (token: string) => fetchJson<ClaimView>(`${BASE}/api/class/claim/${encodeURIComponent(token)}`),
  keep: (token: string) => fetchJson<ClaimView>(`${BASE}/api/class/claim/${encodeURIComponent(token)}`, { method: 'POST' }),
};

export const heroFile = (h: { user_id: string; creation_id: string }, f: string) =>
  `${BASE}/api/files/${h.user_id}/${h.creation_id}/${f}`;
