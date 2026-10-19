import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, CreationResponse } from '../../api/client';
import { HeroTile, SkeletonTile, TileGrid, makingLine, makingPct } from './HeroTile';
import { Icon } from './Icon';
import { STEP_UI, currentStep, heroName, heroState, stepProgress } from './pipeline';
import './Gallery.css';

/** The gallery's tabs. 'classes' is a teacher's classes, in the same screen. */
export type Filter = 'featured' | 'all' | 'mine' | 'classes' | 'failed';

/** How long an unstarred hero stays in Editors' choice before it leaves, in ms. */
const LEAVE_MS = 700;

/** Tiles this close to the top load first and at once; the rest wait until scrolled near. */
const EAGER_TILES = 6;

/**
 * What the gallery last showed, kept for the life of the page. The gallery
 * unmounts whenever a hero opens, and coming back used to start from nothing:
 * skeleton plates while the list reloaded, then every picture fetched again,
 * scrolled back to the top. Now it comes back exactly as it was left (same
 * tab, same list, same scroll) and refreshes the list behind the scenes,
 * changing only the tiles that actually changed. Each tab keeps its own
 * scroll, so switching tabs and back finds each where it was.
 */
const memory = {
  lists: new Map<string, CreationResponse[]>(),
  scroll: new Map<Filter, number>(),
};

/** The last tab is also kept across visits, in this browser only. */
const TAB_KEY = 'heromaker.gallery.tab';
const TABS: Filter[] = ['featured', 'all', 'mine', 'classes', 'failed'];

/** The tab the viewer last chose (Editors' choice the first time). */
export function rememberedTab(): Filter {
  try {
    const saved = localStorage.getItem(TAB_KEY) as Filter | null;
    if (saved && TABS.includes(saved)) return saved;
  } catch { /* private window: no memory, no harm */ }
  return 'featured';
}

export function rememberTab(tab: Filter) {
  try { localStorage.setItem(TAB_KEY, tab); } catch { /* fine */ }
}

/** The tabs this viewer has, in the order the chips show them. */
export function galleryTabs({ isLoggedIn, isAdmin, isTeacher }: { isLoggedIn: boolean; isAdmin: boolean; isTeacher: boolean }): Filter[] {
  return TABS.filter((t) => t === 'featured'
    || (t === 'mine' && isLoggedIn)
    || (t === 'classes' && isLoggedIn && isTeacher)
    || ((t === 'all' || t === 'failed') && isAdmin));
}

/** Next time, start the gallery at the top (the logo was tapped). */
export function resetGalleryScroll() {
  memory.scroll.clear();
}

/** Forget everything the gallery remembers (the account is gone). */
export function forgetGallery() {
  memory.lists.clear();
  memory.scroll.clear();
  try { localStorage.removeItem(TAB_KEY); } catch { /* fine */ }
}

/** Editors' choice is the same for everyone; every other list is the viewer's own. */
const listKey = (filter: Filter, userId?: string) => (filter === 'featured' ? filter : `${filter}:${userId ?? ''}`);

const sameList = (a: CreationResponse[], b: CreationResponse[]) =>
  a.length === b.length && JSON.stringify(a) === JSON.stringify(b);

interface GalleryProps {
  isAdmin: boolean;
  userId?: string;
  onSelect: (c: CreationResponse) => void;
  /** The tab shown. App owns it (the bar under the gallery follows it) and
   * remembers it (rememberedTab); `tabs` are the chips offered. */
  filter: Filter;
  tabs: Filter[];
  onFilter: (f: Filter) => void;
  /** What My classes shows (a teacher's classes, class/MyClasses.tsx), and
   * whether it has loaded, so the tab's scroll is restored onto its cards. */
  classes?: { content: ReactNode; ready: boolean };
}

/**
 * Every finished hero, on colored plates like toys on a shelf. It opens on
 * Editors' choice: the heroes an admin starred. "Mine" also shows the heroes
 * still being made and the ones that failed, because those are the owner's
 * to finish. Admins get a star on every tile to curate Editors' choice.
 * A teacher's classes are one more tab, My classes: one tap away, same screen.
 */
export function Gallery({ isAdmin, userId, onSelect, filter, tabs, onFilter: setFilter, classes }: GalleryProps) {
  const isClasses = filter === 'classes';
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

  useEffect(() => { if (data) memory.lists.set(data.key, data.list); }, [data]);

  // A new list replaces the old one only if something in it changed, so a
  // refresh that finds nothing new re-renders nothing.
  const receive = (forKey: string, list: CreationResponse[]) =>
    setData((d) => (d && d.key === forKey && sameList(d.list, list) ? d : { key: forKey, list }));

  // Stale-while-revalidate: whatever is remembered shows at once (above), and
  // the list is always asked for again. An error only shows with nothing to show.
  useEffect(() => {
    if (isClasses) return undefined;
    let cancelled = false;
    setError(false);
    api.listCreations(0, 0, filter === 'mine', filter === 'featured')
      .then((r) => { if (!cancelled) receive(key, r.creations); })
      .catch(() => { if (!cancelled && !memory.lists.has(key)) setError(true); });
    return () => { cancelled = true; };
  }, [key, filter, reload, isClasses]);

  // Back where it was left. The screen body is the gallery's scroller (the
  // page itself never scrolls, see NoPageScroll). Each tab's scroll is
  // restored once its tiles (or class cards) are there to scroll to, before
  // the first paint, so it never visibly jumps. Until then the scroll is not
  // recorded: a short list's clamped scroll must not overwrite the memory.
  const ready = isClasses ? !!classes?.ready : !!creations;
  const restoredFor = useRef<Filter | null>(null);
  useLayoutEffect(() => {
    const list = rootRef.current?.closest<HTMLElement>('.tb-screen-body');
    if (!list || restoredFor.current === filter) return;
    if (!ready) { restoredFor.current = null; return; }
    restoredFor.current = filter;
    list.scrollTop = memory.scroll.get(filter) ?? 0;
  }, [filter, ready]);
  useEffect(() => {
    const list = rootRef.current?.closest<HTMLElement>('.tb-screen-body');
    if (!list) return;
    const onScroll = () => { if (restoredFor.current) memory.scroll.set(restoredFor.current, list.scrollTop); };
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

  // "All heroes" and "Failed" are admin views, My classes a teacher's (see
  // galleryTabs). Signed out there is only Editors' choice, and one lone chip
  // is no choice: no chips at all.
  const chipsRef = useRef<HTMLDivElement>(null);
  // The chosen chip in view: an admin who teaches has five, and the row scrolls.
  // (Only the row moves: scrollIntoView would also scroll the list.)
  useLayoutEffect(() => {
    const row = chipsRef.current;
    const on = row?.querySelector<HTMLElement>('.tb-chip--on');
    if (!row || !on || row.scrollWidth <= row.clientWidth) return;
    const r = row.getBoundingClientRect();
    const c = on.getBoundingClientRect();
    if (c.left < r.left || c.right > r.right) row.scrollLeft += c.left + c.width / 2 - (r.left + r.width / 2);
  }, [filter, tabs.length]);

  return (
    <div className="tb-gallery creation-gallery" ref={rootRef}>
      {tabs.length > 1 && (
        <div className="tb-gallery-chips" role="tablist" aria-label="Show" ref={chipsRef}>
          {tabs.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={filter === t} className={`tb-chip tb-chip-${t}${filter === t ? ' tb-chip--on' : ''}`} onClick={() => setFilter(t)}>{CHIP_LABEL[t]}</button>
          ))}
        </div>
      )}

      {isClasses ? classes?.content : <>

      {starError && <div className="tb-gallery-note" role="status">Could not save that. Try again.</div>}
      {error && <div className="tb-gallery-empty">Could not load heroes. <button type="button" className="tb-link" onClick={() => setReload((n) => n + 1)}>Try again</button></div>}
      {!creations && !error && <TileGrid>{Array.from({ length: 6 }, (_, i) => <SkeletonTile key={i} index={i} />)}</TileGrid>}
      {creations && shown.length === 0 && (
        <div className="tb-gallery-empty">
          {filter === 'mine' ? 'No heroes yet. Make your first one.'
            : filter === 'featured' ? <>No picks yet. Check back soon!{isAdmin && <> <button type="button" className="tb-link" onClick={() => setFilter('all')}>All heroes</button></>}</>
            : 'No heroes here yet.'}
        </div>
      )}
      {creations && shown.length > 0 && (
        <TileGrid>
          {shown.map((c, i) => (
            <div key={c.id} className={`tb-tile-wrap${leaving.has(c.id) ? ' tb-tile-wrap--leaving' : ''}`}>
              <Tile creation={c} index={i} eager={i < EAGER_TILES} onClick={() => onSelect(c)} />
              {isAdmin && c.status === 'completed' && !c.in_class && (
                <StarToggle on={!!c.featured} busy={pending.has(c.id)} onToggle={() => toggleStar(c)} />
              )}
            </div>
          ))}
        </TileGrid>
      )}
      </>}
    </div>
  );
}

const CHIP_LABEL: Record<Filter, string> = {
  featured: 'Editors’ choice',
  all: 'All heroes',
  mine: 'My heroes',
  classes: 'My classes',
  failed: 'Failed',
};

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

/** One of the viewer's heroes as THE tile (HeroTile.tsx). */
function Tile({ creation, index, eager, onClick }: { creation: CreationResponse; index: number; eager: boolean; onClick: () => void }) {
  const state = heroState(creation);
  const name = heroName(creation);
  const file = (f: string) => api.heroFileUrl(creation, f);
  const step = currentStep(creation);
  const done = creation.steps.filter((s) => s.status === 'completed').length;
  const progress = stepProgress(step);
  const painted = creation.steps.find((s) => s.step_name === 'openai_render')?.status === 'completed';
  const by = creation.name ? `by ${creation.name}${creation.age ? `, ${creation.age}` : ''}` : '';
  const drawing = file('thumb_original.jpg');
  // Ready, or painted and still being made: the drawing cross-fades to the
  // hero. Otherwise the drawing alone, greyed if it stopped.
  const art = state === 'ready' || (state === 'making' && painted)
    ? { kind: 'fade' as const, drawing, hero: file('thumb_rendered.png') }
    : { kind: 'drawing' as const, src: drawing };
  const line =
    state === 'ready' ? by
    : state === 'making' ? makingLine(step ? STEP_UI[step.step_name]?.short : undefined,
      makingPct(done, creation.steps.length, step?.status === 'processing', progress?.real ? progress.pct / 100 : undefined))
    : state === 'failed' ? 'Didn’t finish'
    : 'Not started';
  return (
    <HeroTile
      art={art}
      alt={name}
      index={index}
      eager={eager}
      title={name}
      line={line}
      tone={state === 'ready' ? 'by' : state === 'failed' ? 'failed' : 'now'}
      faded={state === 'failed'}
      state={state}
      onClick={onClick}
      className={`creation-gallery-item${state === 'ready' ? ' creation-gallery-status-completed' : ''}`}
    />
  );
}
