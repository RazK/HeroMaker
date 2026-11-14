import { lazy, ReactNode, Suspense, useEffect, useState } from 'react';
import { ActionFigure, api, ApiError } from '../../api/client';
import { Icon } from './Icon';
import { TileCaption } from './HeroTile';

// three's React bindings are their own chunk: they load only once a figure is shown.
const PartsStage = lazy(() => import('./PartsViewer'));

const POLL_MS = 3000;

/**
 * The hero page's fourth slide, after the live hero: the hero as an action
 * figure, cut into parts that print on their own and click together with
 * ball joints, so arms and legs still move (backend action_figure.py, Hi3D).
 * The owner unlocks it with credits; a split that fails gives them back.
 *
 * Like every slide, it fills the room above the stage's dock and puts its own
 * controls in exactly the dock's box (HeroLive.css .tb-live-name /
 * .tb-hero-moves): locked, the buy button; being made, a name card saying
 * so; made, the pull-apart slider and the 3MF.
 */
export function ActionFigureSlide({ heroId, heroName, credits, picture }: {
  heroId: string;
  heroName: string;
  /** The viewer's balance, when known: too few opens Buy credits instead. */
  credits?: number;
  /** The hero's painting: the teaser, and what shows under the ring. */
  picture: ReactNode;
}) {
  const [figure, setFigure] = useState<ActionFigure | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apart, setApart] = useState(0.35);
  const [moving, setMoving] = useState(true);

  useEffect(() => {
    let alive = true;
    api.getActionFigure(heroId).then((f) => { if (alive) setFigure(f); }, () => { /* the teaser stays */ });
    return () => { alive = false; };
  }, [heroId]);

  const running = figure?.status === 'pending' || figure?.status === 'in_progress';
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => {
      api.getActionFigure(heroId).then((f) => {
        setFigure(f);
        // A refund (a failed split) changes the balance: tell the header.
        if (f.status === 'failed') window.dispatchEvent(new CustomEvent('credits:changed'));
      }, () => { /* next tick */ });
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [running, heroId]);

  const price = figure?.price_credits ?? 5;
  const buyMore = () => window.dispatchEvent(new CustomEvent('credits:buy', {
    detail: { note: `An action figure is ${price} credits. You have ${credits ?? 0}.` },
  }));
  const buy = async () => {
    if (credits !== undefined && credits < price) { buyMore(); return; }
    setBusy(true); setError(null);
    try {
      setFigure(await api.startActionFigure(heroId));
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) buyMore();
      else setError((e as Error).message || 'Action figures are not available right now.');
    } finally {
      setBusy(false);
      window.dispatchEvent(new CustomEvent('credits:changed'));
      window.dispatchEvent(new CustomEvent('auth:credits-updated'));
    }
  };

  const done = figure?.status === 'succeeded' && figure.files?.parts;
  if (done) {
    const url = figure.files!.parts_view || figure.files!.parts!;
    // Hi3D cut it with joints: the arms and legs turn about them (PartsViewer).
    const jointed = figure.provider === 'hi3d' && !!figure.joint && figure.joint !== 'none';
    return (
      <>
        <div className="tb-live-room tb-figure-room">
          <Suspense fallback={<div className="tb-figure-wait"><div className="tb-ring" style={{ ['--p' as string]: '25%' }}><span>…</span></div></div>}>
            <PartsStage url={url} apart={apart} spin jointed={jointed} moving={moving} />
          </Suspense>
          <span className="tb-figure-tag">{figure.part_count ?? '?'} parts{jointed ? ` · ${figure.joint} joints` : ''}</span>
        </div>
        <div className="tb-figure-dock tb-figure-dock--made">
          {/* A drag on the slider is the slider's, not a swipe of the carousel. */}
          {jointed && (
            <button type="button" className={`tb-chip tb-figure-move${moving ? ' tb-chip--on' : ''}`} aria-pressed={moving} onClick={() => setMoving(!moving)}>
              <Icon name="dance" size={18} />Move
            </button>
          )}
          <label className="tb-figure-slider" onPointerDown={(e) => e.stopPropagation()} title="Pull apart">
            <Icon name="expand" size={18} />
            <input type="range" aria-label="Pull apart" min={0} max={1} step={0.01} value={apart} onChange={(e) => setApart(Number(e.target.value))} />
          </label>
          {figure.files?.parts_3mf && (
            <a className="tb-btn tb-btn--secondary tb-btn--sm tb-figure-get" href={figure.files.parts_3mf}
              download={`${heroName}-action-figure.3mf`} aria-label="Download for a 3D printer (.3mf)">
              <Icon name="download" size={20} />.3mf
            </a>
          )}
        </div>
      </>
    );
  }

  if (running) {
    const pct = Math.max(4, figure?.progress ?? 0);
    return (
      <>
        <div className="tb-live-room">
          <div className="tb-slide-coming" role="status" aria-label={`Making the action figure, ${pct}%`}>
            <div className="tb-slide-dim">{picture}</div>
            <div className="tb-shimmer" />
            <div className="tb-ring" style={{ ['--p' as string]: `${pct}%` }}><span>{pct}%</span></div>
            <span className="tb-slide-status">Cutting into parts</span>
          </div>
        </div>
        <TileCaption className="tb-live-name tb-figure-dock" title="Making the action figure" line="About a minute" tone="now" />
      </>
    );
  }

  // Locked (or failed, and refunded): the teaser and the buy button.
  const failed = figure?.status === 'failed' ? figure.error || 'That didn\'t work this time. Your credits are back.' : null;
  return (
    <>
      <div className="tb-live-room tb-figure-room">
        <div className="tb-figure-teaser">{picture}</div>
        <span className="tb-figure-tag"><Icon name="cube" size={18} />A toy you can print</span>
        {(error || failed) && <div className="tb-notice tb-notice--error tb-figure-note" role="alert">{error || failed}</div>}
      </div>
      <button type="button" className="tb-btn tb-btn--primary tb-btn--with-trail tb-figure-dock tb-figure-buy" disabled={busy} onClick={buy}>
        <span className="tb-figure-buy-label"><Icon name="cube" size={22} />{busy ? 'Starting…' : 'Make it a toy'}</span>
        <span className="tb-btn-trail">{price} credits</span>
      </button>
    </>
  );
}
