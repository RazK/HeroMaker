import { useEffect, useState } from 'react';
import { api, CreationResponse } from '../../api/client';
import { Icon } from './Icon';
import { STEP_UI, currentStep, heroName, heroState } from './pipeline';
import './Gallery.css';

type Filter = 'all' | 'mine' | 'failed';

interface GalleryProps {
  isLoggedIn: boolean;
  isAdmin: boolean;
  onSelect: (c: CreationResponse) => void;
}

/**
 * Every finished hero, on colored plates like toys on a shelf. "Mine" also
 * shows the heroes still being made and the ones that failed, because those
 * are the owner's to finish.
 */
export function Gallery({ isLoggedIn, isAdmin, onSelect }: GalleryProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [creations, setCreations] = useState<CreationResponse[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => { if (!isLoggedIn && filter !== 'all') setFilter('all'); }, [isLoggedIn, filter]);

  useEffect(() => {
    let cancelled = false;
    setCreations(null);
    setError(false);
    api.listCreations(0, 0, filter === 'mine')
      .then((r) => { if (!cancelled) setCreations(r.creations); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [filter, isLoggedIn]);

  // Mine keeps in-progress heroes moving without a reload.
  useEffect(() => {
    if (filter !== 'mine' || !creations?.some((c) => heroState(c) === 'making')) return;
    const t = setInterval(() => {
      api.listCreations(0, 0, true).then((r) => setCreations(r.creations)).catch(() => {});
    }, 10000);
    return () => clearInterval(t);
  }, [filter, creations]);

  const shown = (creations ?? [])
    .filter((c) => (filter === 'all' ? c.status === 'completed' : filter === 'failed' ? c.status === 'failed' : true))
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  return (
    <div className="tb-gallery creation-gallery">
      <div className="tb-gallery-head">
        {isLoggedIn ? (
          <div className="tb-gallery-chips" role="tablist" aria-label="Show">
            <button type="button" role="tab" aria-selected={filter === 'all'} className={`tb-chip${filter === 'all' ? ' tb-chip--on' : ''}`} onClick={() => setFilter('all')}>All heroes</button>
            <button type="button" role="tab" aria-selected={filter === 'mine'} className={`tb-chip tb-chip-mine${filter === 'mine' ? ' tb-chip--on' : ''}`} onClick={() => setFilter('mine')}>My heroes</button>
            {isAdmin && <button type="button" role="tab" aria-selected={filter === 'failed'} className={`tb-chip${filter === 'failed' ? ' tb-chip--on' : ''}`} onClick={() => setFilter('failed')}>Failed</button>}
          </div>
        ) : <span />}
        {creations && <span className="tb-muted tb-gallery-count">{shown.length}</span>}
      </div>

      {error && <div className="tb-gallery-empty">Could not load heroes. <button type="button" className="tb-link" onClick={() => setFilter(filter)}>Try again</button></div>}
      {!creations && !error && <div className="tb-gallery-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className={`tb-tile tb-tile--skeleton tb-plate-${(i % 6) + 1}`} />)}</div>}
      {creations && shown.length === 0 && (
        <div className="tb-gallery-empty">{filter === 'mine' ? 'No heroes yet. Make your first one.' : 'No heroes here yet.'}</div>
      )}
      {creations && shown.length > 0 && (
        <div className="tb-gallery-grid">
          {shown.map((c, i) => <Tile key={c.id} creation={c} index={i} onClick={() => onSelect(c)} />)}
        </div>
      )}
    </div>
  );
}

function Tile({ creation, index, onClick }: { creation: CreationResponse; index: number; onClick: () => void }) {
  const state = heroState(creation);
  const name = heroName(creation);
  const file = (f: string) => api.getFileUrl(creation.id, f, creation.user_id);
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
      <img className={`tb-tile-img${state === 'failed' ? ' tb-hero-faded' : ''}`} src={file(painted ? 'thumb_rendered.png' : 'thumb_original.jpg')} alt={name} loading="lazy" />
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
      {state === 'ready' && <span className="tb-tile-play" aria-hidden="true"><Icon name="play" size={16} /></span>}
    </button>
  );
}
