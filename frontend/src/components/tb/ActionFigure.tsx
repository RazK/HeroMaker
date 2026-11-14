import { lazy, ReactNode, Suspense, useEffect, useState } from 'react';
import { ActionFigure, api, ApiError } from '../../api/client';
import { Icon } from './Icon';
import { TileCaption } from './HeroTile';
import { PartsBoundary, PartsFallback } from './PartsBoundary';

// three's React bindings are their own chunk: they load only once a figure is shown.
const PartsStage = lazy(() => import('./PartsViewer'));

const POLL_MS = 3000;

/**
 * Two designs for the made figure, side by side for Raz to pick (?af=a or
 * ?af=b; a by default):
 *  a "Toy tiles": the dock is the moves row's own four tiles, Apart / Pose /
 *    Spin / Print, and the figure idles facing you.
 *  b "One big action": the figure shows itself off on a loop (together,
 *    apart, hover, together, a pose); the dock is two bar buttons, "Take me
 *    apart" and "Print".
 */
function chosenDesign(): 'a' | 'b' {
  try { return new URLSearchParams(window.location.search).get('af') === 'b' ? 'b' : 'a'; } catch { return 'a'; }
}

/**
 * The hero page's fourth slide, after the live hero: the hero as an action
 * figure, cut into parts that print on their own and click together with
 * ball joints, so arms and legs still move (backend action_figure.py).
 * Anyone who can open the hero sees it once made; an admin makes it, free
 * (and, while figures are for sale, the owner buys it with credits).
 * HeroScreen adds this slide only when there is a figure or one may be made.
 *
 * Like every slide, it fills the room above the stage's dock and puts its own
 * controls in exactly the dock's box (HeroLive.css .tb-live-name /
 * .tb-hero-moves): locked, the buy button; being made, a name card saying
 * so; made, the pull-apart slider and the 3MF.
 */
export function ActionFigureSlide({ heroId, heroName, credits, initial, picture }: {
  heroId: string;
  heroName: string;
  /** What HeroScreen already read, so the slide opens without a wait. */
  initial?: ActionFigure;
  /** The viewer's balance, when known: too few opens Buy credits instead. */
  credits?: number;
  /** The hero's painting: the teaser, and what shows under the ring. */
  picture: ReactNode;
}) {
  const [figure, setFigure] = useState<ActionFigure | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apart, setApart] = useState(false);
  const [poseKey, setPoseKey] = useState(0);
  const [spinKey, setSpinKey] = useState(0);
  // Option b: the loop plays until the kid takes the figure apart.
  const [looping, setLooping] = useState(true);
  const design = chosenDesign();

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
    // Cut with joints (Hi3D ball joints): the arms and legs pose about them.
    const jointed = figure.provider === 'hi3d' && !!figure.joint && figure.joint !== 'none';
    const print = figure.files?.parts_3mf;
    const fileName = `${heroName}-action-figure.3mf`;
    const play = design === 'a'
      ? { poseKey, spinKey, idle: !apart, loop: false }
      : { poseKey, spinKey: 0, idle: !looping && !apart, loop: looping };
    return (
      <>
        <div className="tb-live-room tb-figure-room">
          <PartsBoundary fallback={<PartsFallback preview={figure.files?.preview} alt={`${heroName}, the action figure`} />}>
            <Suspense fallback={<div className="tb-figure-wait"><div className="tb-ring" style={{ ['--p' as string]: '25%' }}><span>…</span></div></div>}>
              <PartsStage url={url} apart={apart ? 1 : 0} jointed={jointed} play={play} />
            </Suspense>
          </PartsBoundary>
        </div>
        {design === 'a' ? (
          // The moves row's own tiles (HeroLive .tb-hero-moves): icon over a word, on the stage.
          <div className="tb-hero-moves tb-figure-tiles">
            <div className="tb-moves" role="toolbar" aria-label="Action figure">
              <button type="button" className="tb-btn tb-btn--secondary tb-move" aria-pressed={apart} onClick={() => setApart(!apart)}>
                <Icon name={apart ? 'box' : 'layers'} size={26} /><span>{apart ? 'Together' : 'Apart'}</span>
              </button>
              <button type="button" className="tb-btn tb-btn--secondary tb-move" disabled={!jointed}
                onClick={() => { setApart(false); setPoseKey((k) => k + 1); }}>
                <Icon name="run" size={26} /><span>Pose</span>
              </button>
              <button type="button" className="tb-btn tb-btn--secondary tb-move" onClick={() => setSpinKey((k) => k + 1)}>
                <Icon name="redo" size={26} /><span>Spin</span>
              </button>
              {print && (
                <a className="tb-btn tb-btn--secondary tb-move" href={print} download={fileName} aria-label="Print: download the file for a 3D printer">
                  <Icon name="download" size={26} /><span>Print</span>
                </a>
              )}
            </div>
          </div>
        ) : (
          // Two bar buttons in the dock's box: the one big action, and Print.
          <div className="tb-figure-dock tb-figure-pair">
            <button type="button" className="tb-btn tb-btn--primary tb-figure-main" aria-pressed={apart}
              onClick={() => {
                if (apart) { setApart(false); setPoseKey((k) => k + 1); window.setTimeout(() => setLooping(true), 2500); }
                else { setLooping(false); setApart(true); }
              }}>
              <Icon name={apart ? 'box' : 'layers'} size={22} />{apart ? 'Put me together' : 'Take me apart'}
            </button>
            {print && (
              <a className="tb-btn tb-btn--secondary tb-figure-print" href={print} download={fileName} aria-label="Print: download the file for a 3D printer">
                <Icon name="download" size={22} />Print
              </a>
            )}
          </div>
        )}
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
      <button type="button" className="tb-btn tb-btn--primary tb-btn--with-trail tb-figure-dock tb-figure-buy" disabled={busy} onClick={buy}>
        <span className="tb-figure-buy-label"><Icon name="cube" size={22} />{busy ? 'Starting…' : price === undefined ? 'Make the action figure' : 'Make it a toy'}</span>
        <span className="tb-btn-trail">{price === undefined ? 'Admin' : `${price} credits`}</span>
      </button>
    </>
  );
}
