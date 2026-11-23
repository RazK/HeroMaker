import { lazy, ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { track } from '../../analytics';
import { createPortal } from 'react-dom';
import { ActionFigure, api, ApiError } from '../../api/client';
import { Icon } from './Icon';
import { TileCaption } from './HeroTile';
import { PartsBoundary, PartsFallback } from './PartsBoundary';

// three's React bindings are their own chunk: they load only once a figure is shown.
const PartsStage = lazy(() => import('./PartsViewer'));

const POLL_MS = 3000;

/**
 * The hero page's fourth slide, after the live hero: the hero as an action
 * figure, cut into parts that print on their own and click together with
 * ball joints, so arms and legs still move (backend action_figure.py).
 * Anyone who can open the hero sees it once made; an admin makes it, free
 * (and, while figures are for sale, the owner buys it with credits).
 * HeroScreen adds this slide only when there is a figure or one may be made.
 *
 * Like every slide, it fills the room above the stage's dock, and its own
 * controls sit in exactly the dock's box: locked, the buy button; being
 * made, a name card saying so; made, the pull-apart slider and the 3MF. They
 * are rendered into `dock` (HeroLive Dock: fixed while the slides move, fading
 * in as this slide comes in), and on the slide itself only if there is none.
 */
export function ActionFigureSlide({ heroId, heroName, credits, initial, picture, dock }: {
  heroId: string;
  heroName: string;
  /** What HeroScreen already read, so the slide opens without a wait. */
  initial?: ActionFigure;
  /** The viewer's balance, when known: too few opens Buy credits instead. */
  credits?: number;
  /** The hero's painting: the teaser, and what shows under the ring. */
  picture: ReactNode;
  /** The stage's dock layer for this slide's controls. */
  dock?: HTMLElement | null;
}) {
  const inDock = (node: ReactNode) => (dock ? createPortal(node, dock) : node);
  const [figure, setFigure] = useState<ActionFigure | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Taken apart: the pieces move out along their joints, with arrows to where each clicks in.
  const [apart, setApart] = useState(false);
  // Analytics: the pieces were pulled apart (once per look at this toy).
  const pulled = useRef(false);

  useEffect(() => {
    if (initial) return;
    let alive = true;
    api.getActionFigure(heroId).then((f) => { if (alive) setFigure(f); }, () => { /* the teaser stays */ });
    return () => { alive = false; };
  }, [heroId, initial]);

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

  // No price: an admin making it, free. A price: the owner buying it (while for sale).
  const price = figure?.price_credits;
  const buyMore = () => window.dispatchEvent(new CustomEvent('credits:buy', {
    detail: { note: `An action figure is ${price} credits. You have ${credits ?? 0}.` },
  }));
  const buy = async () => {
    if (price !== undefined && credits !== undefined && credits < price) { buyMore(); return; }
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
    const takeApart = () => {
      if (!apart && !pulled.current) { pulled.current = true; track('take_apart_tapped', { hero_id: heroId }); }
      setApart(!apart);
    };
    return (
      <>
        <div className="tb-live-room tb-figure-room">
          <PartsBoundary fallback={<PartsFallback preview={figure.files?.preview} alt={`${heroName}, the action figure`} />}>
            <Suspense fallback={<div className="tb-figure-wait"><div className="tb-ring" style={{ ['--p' as string]: '25%' }}><span>…</span></div></div>}>
              {/* Centred in the card like every slide's picture; the name card and
                  the toy's controls are laid over the card (Raz, 2026-11-22). */}
              <PartsStage url={url} apart={apart ? 1 : 0} ease arrows sway />
            </Suspense>
          </PartsBoundary>
        </div>
        {/* Two equal pills, icon and words on one line (the "Hero · toy" board).
            Making it again and the parts' .glb are in the hero's ⋯ menu. */}
        {inDock(<div className="tb-figure-dock tb-figure-dock--made">
          <button type="button" className="tb-btn tb-btn--secondary tb-figure-btn tb-figure-apart" aria-pressed={apart} onClick={takeApart}>
            <Icon name={apart ? 'together' : 'apart'} size={18} /><span>{apart ? 'Put together' : 'Take apart'}</span>
          </button>
          {figure.files?.parts_3mf && (
            <a className="tb-btn tb-btn--secondary tb-figure-btn tb-figure-get" href={figure.files.parts_3mf}
              download={`${heroName}-action-figure.3mf`} aria-label="Print file: download for a 3D printer (.3mf)"
              onClick={() => track('print_file_downloaded', { hero_id: heroId, format: '3mf' })}>
              <Icon name="download" size={18} /><span>Print file</span>
            </a>
          )}
        </div>)}
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
            <span className="tb-slide-status">Becoming a toy</span>
          </div>
        </div>
        {inDock(<TileCaption className="tb-live-name tb-figure-dock" title="Making the action figure" line="About a minute" tone="now" />)}
      </>
    );
  }

  // Not made: nothing for a visitor (HeroScreen leaves the slide out), the button for whoever may make it.
  if (!figure?.can_make) return null;
  // Locked (or failed, and refunded): the teaser and the button.
  const failed = figure?.status === 'failed' ? figure.error || 'That didn\'t work this time. Your credits are back.' : null;
  return (
    <>
      <div className="tb-live-room tb-figure-room">
        <div className="tb-figure-teaser">{picture}</div>
        <span className="tb-figure-tag"><Icon name="cube" size={18} />A toy you can print</span>
        {(error || failed) && <div className="tb-notice tb-notice--error tb-figure-note" role="alert">{error || failed}</div>}
      </div>
      {inDock(
        <button type="button" className="tb-btn tb-btn--primary tb-btn--with-trail tb-figure-dock tb-figure-buy" disabled={busy} onClick={buy}>
          <span className="tb-figure-buy-label"><Icon name="cube" size={22} />{busy ? 'Starting…' : price === undefined ? 'Make the action figure' : 'Make it a toy'}</span>
          <span className="tb-btn-trail">{price === undefined ? 'Admin' : `${price} credits`}</span>
        </button>,
      )}
    </>
  );
}
