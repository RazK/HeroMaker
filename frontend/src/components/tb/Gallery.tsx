import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, CreationResponse } from '../../api/client';
import { Icon } from './Icon';
import { STEP_UI, currentStep, heroName, heroState } from './pipeline';
import './Gallery.css';

export type Filter = 'featured' | 'all' | 'mine' | 'failed';

/** How long an unstarred hero stays in Editors' choice before it leaves, in ms. */
const LEAVE_MS = 700;

/** Tiles this close to the top load first and at once; the rest wait until scrolled near. */
const EAGER_TILES = 6;

/**
 * What the gallery last showed, kept for the life of the page. The gallery
 * unmounts whenever a hero opens, and coming back used to start from nothing:
 * skeleton plates while the list reloaded, then every picture fetched again,
 * scrolled back to the top. Now it comes back exactly as it was left (same
 * filter, same list, same scroll) and refreshes the list behind the scenes,
 * changing only the tiles that actually changed.
 */
const memory = {
  filter: 'featured' as Filter,
  lists: new Map<string, CreationResponse[]>(),
  scrollTop: 0,
};

/** Next time, start the gallery at the top (the logo was tapped). */
export function resetGalleryScroll() {
  memory.scrollTop = 0;
}

/** Forget everything the gallery remembers (the account is gone). */
export function forgetGallery() {
  memory.filter = 'featured';
  memory.lists.clear();
  memory.scrollTop = 0;
}

/** Editors' choice is the same for everyone; every other list is the viewer's own. */
const listKey = (filter: Filter, userId?: string) => (filter === 'featured' ? filter : `${filter}:${userId ?? ''}`);

const sameList = (a: CreationResponse[], b: CreationResponse[]) =>
  a.length === b.length && JSON.stringify(a) === JSON.stringify(b);

interface GalleryProps {
  isLoggedIn: boolean;
  isAdmin: boolean;
  userId?: string;
  onSelect: (c: CreationResponse) => void;
  /** Where it opens when asked (a parent who just kept a hero opens on My heroes); otherwise where it was left. */
  initialFilter?: Filter;
}

/**
 * Every finished hero, on colored plates like toys on a shelf. It opens on
 * Editors' choice: the heroes an admin starred. "Mine" also shows the heroes
 * still being made and the ones that failed, because those are the owner's
 * to finish. Admins get a star on every tile to curate Editors' choice.
 */
export function Gallery({ isLoggedIn, isAdmin, userId, onSelect, initialFilter }: GalleryProps) {
  const [filter, setFilter] = useState<Filter>(initialFilter ?? memory.filter);
  const key = listKey(filter, userId);
  // The list this gallery holds, and which filter+viewer it is for. Until the
  // first answer for a key arrives, the remembered list for it stands in.
  const [data, setData] = useState<{ key: string; list: CreationResponse[] } | null>(() => {
    const list = memory.lists.get(key);
    return list ? { key, list } : null;
  });
  const creations = data?.key === key ? data.list : memory.lists.get(key) ?? null;
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  // Unstarred while viewing Editors' choice: still shown for a beat, then gone.
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [starError, setStarError] = useState(false);

  useEffect(() => {
    if ((!isLoggedIn && filter === 'mine') || (!isAdmin && (filter === 'all' || filter === 'failed'))) setFilter('featured');
  }, [isLoggedIn, isAdmin, filter]);

  useEffect(() => { memory.filter = filter; }, [filter]);
  useEffect(() => { if (data) memory.lists.set(data.key, data.list); }, [data]);

  // A new list replaces the old one only if something in it changed, so a
  // refresh that finds nothing new re-renders nothing.
  const receive = (forKey: string, list: CreationResponse[]) =>
    setData((d) => (d && d.key === forKey && sameList(d.list, list) ? d : { key: forKey, list }));

  // Stale-while-revalidate: whatever is remembered shows at once (above), and
  // the list is always asked for again. An error only shows with nothing to show.
  useEffect(() => {
    let cancelled = false;
    setError(false);
    api.listCreations(0, 0, filter === 'mine', filter === 'featured')
      .then((r) => { if (!cancelled) receive(key, r.creations); })
      .catch(() => { if (!cancelled && !memory.lists.has(key)) setError(true); });
    return () => { cancelled = true; };
  }, [key, filter, reload]);

  // Back where it was left. The screen body is the gallery's scroller (the
  // page itself never scrolls, see NoPageScroll). Restored once the tiles are
  // there to scroll to, before the first paint, so it never visibly jumps.
  const restored = useRef(false);
  useLayoutEffect(() => {
    const list = rootRef.current?.closest<HTMLElement>('.tb-screen-body');
    if (!list || restored.current || !creations) return;
    restored.current = true;
    list.scrollTop = memory.scrollTop;
  }, [creations]);
  useEffect(() => {
    const list = rootRef.current?.closest<HTMLElement>('.tb-screen-body');
    if (!list) return;
    const onScroll = () => { memory.scrollTop = list.scrollTop; };
    list.addEventListener('scroll', onScroll, { passive: true });
    return () => list.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!starError) return;
    const t = setTimeout(() => setStarError(false), 3000);
    return () => clearTimeout(t);
  }, [starError]);

  const mark = (set: typeof setLeaving, id: string, on: boolean) =>
    set((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const setStar = (id: string, featured: boolean) =>
    setData((d) => {
      const list = d?.key === key ? d.list : memory.lists.get(key);
      return list ? { key, list: list.map((c) => (c.id === id ? { ...c, featured } : c)) } : d;
    });

  // Optimistic: the star flips at once and flips back if the server says no.
  const toggleStar = async (c: CreationResponse) => {
    if (pending.has(c.id)) return;
    const next = !c.featured;
    const inFeatured = filter === 'featured';
    mark(setPending, c.id, true);
    setStar(c.id, next);
    if (!next && inFeatured) mark(setLeaving, c.id, true);
    const left = !next && inFeatured ? new Promise((r) => setTimeout(r, LEAVE_MS)) : Promise.resolve();
    try {
      await api.setFeatured(c.id, next);
      await left;
    } catch {
      setStar(c.id, !next);
      setStarError(true);
    } finally {
      mark(setLeaving, c.id, false);
      mark(setPending, c.id, false);
    }
  };

  // Mine keeps in-progress heroes moving without a reload.
  useEffect(() => {
    if (filter !== 'mine' || !creations?.some((c) => heroState(c) === 'making')) return;
    const t = setInterval(() => {
      api.listCreations(0, 0, true).then((r) => receive(key, r.creations)).catch(() => {});
    }, 10000);
    return () => clearInterval(t);
  }, [filter, key, creations]);

  const shown = (creations ?? [])
    .filter((c) => {
      if (filter === 'featured') return c.status === 'completed' && (c.featured || leaving.has(c.id));
      if (filter === 'all') return c.status === 'completed';
      if (filter === 'failed') return c.status === 'failed';
      return true;
    })
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  // "All heroes" and "Failed" are admin views. Signed out there is only
  // Editors' choice, and one lone chip is no choice: no chips at all.
  const chips: { key: Filter; label: string; cls: string }[] = [
    { key: 'featured', label: 'Editors’ choice', cls: 'tb-chip-featured' },
    ...(isAdmin ? [{ key: 'all' as Filter, label: 'All heroes', cls: 'tb-chip-all' }] : []),
    ...(isLoggedIn ? [{ key: 'mine' as Filter, label: 'My heroes', cls: 'tb-chip-mine' }] : []),
    ...(isAdmin ? [{ key: 'failed' as Filter, label: 'Failed', cls: 'tb-chip-failed' }] : []),
  ];

  return (
    <div className="tb-gallery creation-gallery" ref={rootRef}>
      {chips.length > 1 && (
        <div className="tb-gallery-chips" role="tablist" aria-label="Show">
          {chips.map((c) => (
            <button key={c.key} type="button" role="tab" aria-selected={filter === c.key} className={`tb-chip ${c.cls}${filter === c.key ? ' tb-chip--on' : ''}`} onClick={() => setFilter(c.key)}>{c.label}</button>
          ))}
        </div>
      )}

      {starError && <div className="tb-gallery-note" role="status">Could not save that. Try again.</div>}
      {error && <div className="tb-gallery-empty">Could not load heroes. <button type="button" className="tb-link" onClick={() => setReload((n) => n + 1)}>Try again</button></div>}
      {!creations && !error && <div className="tb-gallery-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className={`tb-tile tb-tile--skeleton tb-plate-${(i % 6) + 1}`} />)}</div>}
      {creations && shown.length === 0 && (
        <div className="tb-gallery-empty">
          {filter === 'mine' ? 'No heroes yet. Make your first one.'
            : filter === 'featured' ? <>No picks yet. Check back soon!{isAdmin && <> <button type="button" className="tb-link" onClick={() => setFilter('all')}>All heroes</button></>}</>
            : 'No heroes here yet.'}
        </div>
      )}
      {creations && shown.length > 0 && (
        <div className="tb-gallery-grid">
          {shown.map((c, i) => (
            <div key={c.id} className={`tb-tile-wrap${leaving.has(c.id) ? ' tb-tile-wrap--leaving' : ''}`}>
              <Tile creation={c} index={i} eager={i < EAGER_TILES} onClick={() => onSelect(c)} />
              {isAdmin && c.status === 'completed' && !c.in_class && (
                <StarToggle on={!!c.featured} busy={pending.has(c.id)} onToggle={() => toggleStar(c)} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Admin only: star a hero into Editors' choice. A sibling of the tile, not
 * inside it (a button cannot hold a button), so a tap never opens the hero.
 */
function StarToggle({ on, busy, onToggle }: { on: boolean; busy: boolean; onToggle: () => void }) {
  const label = on ? 'Remove from Editors’ choice' : 'Add to Editors’ choice';
  return (
    <button
      type="button"
      className={`tb-tile-star${on ? ' tb-tile-star--on' : ''}`}
      aria-pressed={on}
      aria-label={label}
      title={label}
      aria-busy={busy || undefined}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
    >
      <span className="tb-tile-star-dot"><Icon name="star" size={20} /></span>
    </button>
  );
}

/**
 * How a tile's pictures load. The first rows load at once, the drawing (what
 * the tile shows first) at high priority; the rest are left to the browser
 * until they are scrolled near. Decoding never holds up the page.
 * (fetchpriority in lower case: React 18 does not know the attribute yet.)
 */
export function imgLoading(eager: boolean, first: boolean) {
  return {
    loading: eager ? 'eager' : 'lazy',
    decoding: 'async',
    ...(eager && first ? { fetchpriority: 'high' } : {}),
  } as const;
}

function Tile({ creation, index, eager, onClick }: { creation: CreationResponse; index: number; eager: boolean; onClick: () => void }) {
  const state = heroState(creation);
  const name = heroName(creation);
  const file = (f: string) => api.heroFileUrl(creation, f);
  const step = currentStep(creation);
  const done = creation.steps.filter((s) => s.status === 'completed').length;
  const pct = creation.steps.length ? Math.round(((done + 0.5) / creation.steps.length) * 100) : 0;
  const painted = creation.steps.find((s) => s.step_name === 'openai_render')?.status === 'completed';
  const by = creation.name ? `by ${creation.name}${creation.age ? `, ${creation.age}` : ''}` : '';

  return (
    <button
      type="button"
      className={`tb-tile tb-plate-${(index % 6) + 1} creation-gallery-item${state === 'ready' ? ' creation-gallery-status-completed' : ''}`}
      data-state={state}
      onClick={onClick}
    >
      {state === 'ready' ? (
        <TileFade drawing={file('thumb_original.jpg')} hero={file('thumb_rendered.png')} name={name} index={index} eager={eager} />
      ) : (
        <img className={`tb-tile-img${state === 'failed' ? ' tb-hero-faded' : ''}`} src={file(painted ? 'thumb_rendered.png' : 'thumb_original.jpg')} alt={name} {...imgLoading(eager, true)} />
      )}
      <span className="tb-tile-card">
        <span className="tb-tile-name">{name}</span>
        {state === 'ready' && <span className="tb-tile-by">{by}</span>}
        {state === 'making' && (
          <>
            <span className="tb-tile-progress"><span style={{ width: `${pct}%` }} /></span>
            <span className="tb-tile-status">{step ? STEP_UI[step.step_name]?.label : ''}</span>
          </>
        )}
        {state === 'failed' && <span className="tb-tile-status tb-tile-status--failed">Didn’t finish</span>}
        {state === 'idle' && <span className="tb-tile-status">Not started</span>}
      </span>
    </button>
  );
}

/** One full cycle of the cross-fade, in seconds. Must match `.tb-tile-fade--on` in Gallery.css. */
const FADE_CYCLE_S = 4;
/** Each tile runs this far behind the one before it: a wave across the gallery. */
const FADE_STAGGER_S = 0.3;

/**
 * Where tile `index` should be in its cycle right now, on ONE clock shared by
 * every tile (the page's performance.now()), as a negative animation-delay.
 *
 * A tile starts animating only once its images load, and they load at random
 * times; a plain per-tile delay was measured from that moment, so the wave
 * broke up into tiles flipping together or out of order. Measuring from the
 * shared clock puts a tile straight into its slot in the wave whenever it
 * starts, so neighbours always stay exactly FADE_STAGGER_S apart.
 */
function wavePhaseDelay(index: number): string {
  const now = performance.now() / 1000;
  const phase = (((now - index * FADE_STAGGER_S) % FADE_CYCLE_S) + FADE_CYCLE_S) % FADE_CYCLE_S;
  return `${(-phase).toFixed(3)}s`;
}

/**
 * A ready tile: the kid's drawing and the hero render stacked, cross-fading
 * between the two. The animation is pure CSS (Gallery.css); this only starts
 * it once BOTH images have loaded, so a tile never fades to a blank plate.
 * Neither waits for the other: whichever loads first shows at once, the
 * drawing preferred (the story starts there, and it is asked for first); if
 * it fails, the tile shows the render for good.
 */
export function TileFade({ drawing, hero, name, index, eager }: { drawing: string; hero: string; name: string; index: number; eager: boolean }) {
  const [loaded, setLoaded] = useState({ drawing: false, hero: false });
  const [drawingFailed, setDrawingFailed] = useState(false);
  const drawingRef = useRef<HTMLImageElement>(null);
  const heroRef = useRef<HTMLImageElement>(null);
  const done = (k: 'drawing' | 'hero') => setLoaded((l) => (l[k] ? l : { ...l, [k]: true }));

  // An image already in the cache can finish before React attaches onLoad.
  // Checked before the first paint, so a gallery coming back shows its
  // pictures (and joins the wave) in its very first frame.
  useLayoutEffect(() => {
    if (drawingRef.current?.complete && drawingRef.current.naturalWidth) done('drawing');
    if (heroRef.current?.complete && heroRef.current.naturalWidth) done('hero');
  }, []);

  const fading = loaded.drawing && loaded.hero && !drawingFailed;
  // Computed once, at the moment the tile joins the wave.
  const delay = useMemo(() => (fading ? wavePhaseDelay(index) : '0s'), [fading, index]);

  return (
    <span className={`tb-tile-fade${loaded.drawing && !drawingFailed ? ' tb-tile-fade--drawn' : ''}${fading ? ' tb-tile-fade--on' : ''}`} style={{ ['--tb-fade-delay' as string]: delay }}>
      <span className="tb-tile-drawing" aria-hidden="true">
        {!drawingFailed && (
          <img ref={drawingRef} src={drawing} alt="" {...imgLoading(eager, true)} onLoad={() => done('drawing')} onError={() => setDrawingFailed(true)} />
        )}
      </span>
      <img ref={heroRef} className="tb-tile-img tb-tile-hero" src={hero} alt={name} {...imgLoading(eager, false)} onLoad={() => done('hero')} />
    </span>
  );
}
