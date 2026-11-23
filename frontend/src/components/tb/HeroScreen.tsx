import { KeyboardEvent, ReactNode, Suspense, lazy, useEffect, useRef, useState } from 'react';
import { ActionFigure, api, ApiError, CreationResponse, CreationStepResponse, getAuthToken } from '../../api/client';
import { getTotalCost } from '../../config/steps';
import { arenaUrl, canPlay, playUrl } from '../../config/play';
import { heroLink, leaveFromOverlay } from '../../routes';
import { flush, track } from '../../analytics';
import { HeroLive } from './HeroLive';
import { Icon } from './Icon';
import { Dialog, Header, NavButton, ProgressBar, Sheet, SheetRow, Stepper, useFitScreen } from './parts';
import { STEP_UI, StepProgress, currentStep, etaText, failedLabel, failedLine, heroName, heroState, holdSteady, refundWords, remainingCost, stepProgress, stepViews } from './pipeline';
import './HeroScreen.css';
import { useCopy } from '../../hooks/useCopy';

// Admin only, and it carries three.js: loaded when opened.
const PrintSplitSheet = lazy(() => import('./PrintSplit').then((m) => ({ default: m.PrintSplitSheet })));

interface HeroScreenProps {
  creation: CreationResponse;
  isLoggedIn: boolean;
  currentUserId?: string;
  isAdmin: boolean;
  creditBalance?: number;
  onBack: () => void;
  /** The logo: the gallery (on a phone, the way back: it has no Back button). */
  onHome: () => void;
  /** The site header's account controls (App's HeaderAuth): the credits and the account, or Sign in. */
  headerAuth?: ReactNode;
  onRefresh: () => Promise<void>;
  onDeleted: () => void;
  onShowSteps: () => void;
  onMakeOwn: () => void;
  onCreditsChanged: () => void;
  /** Opened by a teacher from their class: read-only, back goes to the class. */
  fromClass?: boolean;
  /** Opened from a user's page in the admin console: back goes to that page. */
  fromAdmin?: boolean;
}

/**
 * One hero, in whichever state it is in: being made, failed, or ready.
 * The layout is the same in all three — header, the hero, a bottom bar — so
 * nothing jumps around as the hero comes to life. The stage is one carousel
 * in every state (HeroLive): the drawing, the painting and the hero, built up
 * as each is made; ready, the hero is live in 3D, with its moves under it.
 */
/**
 * Opened by a shared link (`?via=share`, as Share writes it). A family who
 * gets a hero in WhatsApp goes straight into Robot Rumble with it: the game
 * says who drew it and, after a round, how to make their own (Raz,
 * 2026-11-23). The link stays the hero's page, so its preview card and the
 * share door (analytics) are unchanged; crawlers run no script.
 */
const SHARE_ARRIVAL = new URLSearchParams(window.location.search).get('via') === 'share';

export function HeroScreen(props: HeroScreenProps) {
  const { creation, isLoggedIn, currentUserId, isAdmin, creditBalance } = props;
  const state = heroState(creation);
  const owns = isLoggedIn && (isAdmin || creation.user_id === currentUserId);
  // A teacher looking at a student's hero shares it, never "makes their own".
  const makesOwn = !props.fromClass;
  // An admin looking at someone else's hero: support, not its owner. Their
  // own balance means nothing here, and the owner's buy/retry bar is not theirs.
  const supporting = isLoggedIn && isAdmin && creation.user_id !== currentUserId;
  const backLabel = props.fromClass ? 'Back to class' : props.fromAdmin ? 'Back to user' : 'Back to heroes';
  const name = heroName(creation);
  const [sheet, setSheet] = useState<'more' | 'rename' | 'artist' | 'delete' | 'again' | 'games' | 'details' | 'split' | 'split-again' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  // The action figure, if the hero has one (or this viewer may make one): the fourth slide.
  const [figure, setFigure] = useState<ActionFigure | null>(null);
  const figureReady = state === 'ready';
  useEffect(() => {
    if (!figureReady || props.fromClass) return;
    let alive = true;
    api.getActionFigure(creation.id).then((f) => { if (alive) setFigure(f); }, () => { /* no slide */ });
    return () => { alive = false; };
  }, [figureReady, creation.id, isLoggedIn, isAdmin, props.fromClass]);
  const showFigure = !!figure && (figure.status === 'succeeded' || figure.can_make);
  const toyMade = figure?.status === 'succeeded';
  // A share's visitor (never the owner, a teacher or support) is sent into
  // the game, once, as soon as we know who is looking and the hero can play.
  const sentToGame = useRef(false);
  useEffect(() => {
    if (!SHARE_ARRIVAL || sentToGame.current) return;
    if (getAuthToken() && !currentUserId) return; // still reading who this is
    if (owns || props.fromClass || props.fromAdmin || !canPlay(creation)) return;
    sentToGame.current = true;
    track('game_started', { game: 'arena', hero_id: creation.id });
    flush(true);
    window.location.replace(`${arenaUrl(creation)}&via=share`);
  }, [owns, currentUserId, creation, props.fromClass, props.fromAdmin]);
  const shown = useRef<(StepProgress & { key: string }) | null>(null);
  useFitScreen();

  // The bar and the time left move every second, between the 2 s polls.
  useEffect(() => {
    if (state !== 'making') return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  const step = currentStep(creation);
  const now = Date.now();
  const measured = stepProgress(step, now);
  const stepKey = `${step?.step_name}:${step?.started_at}`;
  // Per run of a step: never backwards, and the time left never jumps up.
  const progress = measured ? (shown.current = holdSteady(shown.current, stepKey, measured)) : null;
  const stepIndex = step ? creation.steps.indexOf(step) : creation.steps.length;
  const painted = creation.steps.find((s) => s.step_name === 'openai_render')?.status === 'completed';

  const run = async (what: () => Promise<unknown>, failMsg: string) => {
    setBusy(true);
    setError(null);
    try {
      await what();
      window.dispatchEvent(new CustomEvent('creation:refresh-now', { detail: { creationId: creation.id } }));
      await props.onRefresh();
      props.onCreditsChanged();
      setSheet(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : failMsg);
    } finally {
      setBusy(false);
    }
  };

  // One run, from the first unfinished step, in order: the server stops at the
  // first failure. Starting each unfinished step on its own ran them all at
  // once, and every step after the failed one failed on a missing input.
  const tryAgain = () => run(async () => {
    const from = creation.steps.find((x) => x.status === 'pending' || x.status === 'failed');
    if (from) await api.runPipeline(creation.id, from.step_name);
  }, 'Could not start again');
  // Spends credits, so it is asked first (sheet 'again'), never on one tap.
  const makeAgain = () => run(() => api.runPipeline(creation.id), 'Could not start again');
  const againCost = getTotalCost();
  const shortForAgain = creditBalance !== undefined && againCost > creditBalance;
  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteCreation(creation.id);
      props.onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete');
      setBusy(false);
    }
  };
  const downloadVrm = () => api.downloadFile(creation.id, 'avatar.vrm', creation.user_id).catch(() => setError('Download failed'));
  // A file the API already linked (the toy's parts): the browser saves it.
  const downloadUrl = (url: string, file: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = file;
    document.body.append(a);
    a.click();
    a.remove();
  };

  // Share sends the hero's own link: whoever opens it (grandma, signed out)
  // sees the hero move. The picture goes along only where the platform takes
  // one, read ahead (the gallery's thumbnail, usually cached) so the tap
  // shares at once: a read after the tap can outlive its permission to share.
  const pic = useRef<File | null>(null);
  const { copied, copy } = useCopy(4000);
  const canShareFiles = typeof navigator !== 'undefined' && !!navigator.canShare;
  useEffect(() => {
    pic.current = null;
    if (!canShareFiles || state !== 'ready') return;
    let alive = true;
    // The share picture is a flat JPEG (backend share_card.py): the cut
    // painting's PNG is transparent, and WhatsApp painted its background black.
    fetch(api.heroSharePictureUrl(creation.id))
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (!alive || !b) return;
        const f = new File([b], `${name}.jpg`, { type: 'image/jpeg' });
        if (navigator.canShare?.({ files: [f] })) pic.current = f;
      })
      .catch(() => { /* the link alone */ });
    return () => { alive = false; };
  }, [creation.id, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const share = async () => {
    track('share_tapped', { hero_id: creation.id });
    // `?via=share` makes the visits a share brings their own door (G-6), so a
    // share can be followed to a purchase. It carries no one's name.
    const url = `${heroLink(creation.id)}?via=share`;
    const title = name;
    const text = `Meet ${name}! Tap to see it move.`;
    if (navigator.share) {
      // With a picture the link rides in the text only: some apps drop the url
      // field, and WhatsApp, which keeps both, printed the link twice.
      const withPic = pic.current && { title, files: [pic.current], text: `${text} ${url}` };
      try {
        if (withPic && navigator.canShare?.(withPic)) await navigator.share(withPic);
        else await navigator.share({ title, text, url });
        return;
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return;
      }
    }
    await copy(url, 'Copy the link');
  };

  const retryCost = remainingCost(creation);
  const short = creditBalance !== undefined && retryCost > creditBalance;

  const ready = state === 'ready';
  const canShare = ready || painted;
  // The sheet behind ⋯ : the owner's (and an admin's) rows. Ready, Share is
  // at the foot for everyone (Raz, 2026-11-22); before that it is here.
  const moreRows = [
    canShare && !ready && <SheetRow key="share" icon="share" label="Share" onClick={() => { setSheet(null); share(); }} />,
    ...(owns ? [
      <SheetRow key="rename" icon="pencil" label="Rename" onClick={() => setSheet('rename')} />,
      <SheetRow key="artist" icon="brush" label="Who drew it" trail={artistLine(creation)} onClick={() => setSheet('artist')} />,
      ready && <SheetRow key="again" icon="redo" label="Make it again" trail={`${againCost} credits`} onClick={() => setSheet('again')} />,
      ready && <SheetRow key="vrm" icon="download" label="Download 3D file" trail=".vrm" onClick={downloadVrm} />,
      // The per-step admin view is a debugging tool, not designed for users.
      isAdmin && <SheetRow key="steps" icon="grid" label="Admin: every step" onClick={() => { setSheet(null); props.onShowSteps(); }} />,
      // The toy's parts as one file, for a 3D app (the toy slide keeps only Print file).
      toyMade && figure?.files?.parts && <SheetRow key="toy-glb" icon="download" label="Download toy parts" trail=".glb" onClick={() => { setSheet(null); downloadUrl(figure.files!.parts!, `${name}-toy-parts.glb`); }} />,
      // Cutting it into printable parts spends a provider's credits: admins only.
      // Made: make it again (the split sheet's options); not made: make one.
      isAdmin && ready && (toyMade
        ? <SheetRow key="split" icon="redo" label="Admin: make the toy again" onClick={() => setSheet('split-again')} />
        : <SheetRow key="split" icon="cube" label="Admin: make a printable toy" onClick={() => setSheet('split')} />),
      isAdmin && ready && !creation.in_class && (
        <SheetRow
          key="featured"
          icon="star"
          label={creation.featured ? 'Remove from Editors’ choice' : 'Add to Editors’ choice'}
          onClick={() => run(() => api.setFeatured(creation.id, !creation.featured), 'Could not update Editors’ choice')}
        />
      ),
      <div key="div" className="tb-sheet-divider" />,
      <SheetRow key="delete" icon="trash" label="Delete hero" danger onClick={() => setSheet('delete')} />,
    ] : []),
  ].filter(Boolean);

  // The site's header, as on the gallery (Raz: "the logo and everything in
  // the header stay with us across the site"): Back (a desktop's; a phone
  // goes back by the logo, or the system's Back) and the logo at the start;
  // Make your own (a desktop's), the credits and the account at the end.
  // Opened from a class or the admin console, Back is there on a phone too:
  // the logo goes to the gallery, not back to where it was opened.
  const header = (
    <Header
      left={(
        <>
          <NavButton icon="back" label={backLabel} onClick={props.onBack} className={`tb-back${props.fromClass || props.fromAdmin ? '' : ' tb-back--wide'}`} />
          <button type="button" className="tb-logo tb-logo-mark" onClick={props.onHome} aria-label="HeroMaker home">
            <img src="/app-icon.png" alt="" />
            <span>HeroMaker</span>
          </button>
        </>
      )}
      right={(
        <>
          {makesOwn && <button type="button" className="tb-btn tb-btn--secondary tb-btn--sm tb-make-own tb-header-make" onClick={props.onMakeOwn}><Icon name="pencil" />Make your own</button>}
          {props.headerAuth}
        </>
      )}
    />
  );
  // The ⋯ : only when it holds something for this viewer, over the card's top end.
  const more = moreRows.length > 0 && <NavButton icon="more" label="More" onClick={() => setSheet('more')} className="tb-more tb-hero-more" />;

  const notice = error
    ? <div className="tb-notice tb-notice--error" role="alert">{error}<button type="button" className="tb-btn tb-btn--secondary tb-btn--sm" onClick={() => setError(null)}>OK</button></div>
    // Shared from ⋯ with no Share button at the foot to say so.
    : copied && state !== 'ready' && <div className="tb-notice" role="status"><Icon name="check" />Link copied</div>;

  // Under the stage while the hero is not ready: what is happening.
  let info: ReactNode = null;
  let bar;
  if (state === 'ready') {
    // The hero's own actions, the same for whoever is looking (Raz,
    // 2026-11-22): Share, then Play, the primary, last. Make your own is the
    // site's, in a desktop's header.
    bar = (
      <>
        <button type="button" className="tb-btn tb-btn--secondary tb-btn--full tb-share" onClick={share}><Icon name={copied ? 'check' : 'share'} />{copied ? 'Link copied' : 'Share'}</button>
        <button type="button" className="tb-btn tb-btn--primary tb-btn--full tb-play" onClick={() => setSheet('games')}><Icon name="play" />Play</button>
      </>
    );
  } else if (state === 'idle') {
    // Picked, never made ("Make my hero" was not pressed). Nothing runs, so
    // nothing here moves or counts down: the drawing and what is true.
    info = (
      <div className="tb-making tb-idle">
        <div className="tb-status"><div className="tb-status-name">Never started</div></div>
        <div className="tb-failed-line" role="status">Nothing was charged.</div>
      </div>
    );
    bar = <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={props.onBack}>{backLabel}</button>;
  } else {
    const failed = state === 'failed';
    const label = failed ? failedLabel(step) : step ? STEP_UI[step.step_name]?.label ?? step.step_name : 'Waiting to start';
    const eta = progress ? etaText(progress.endsAt, now) : '';
    info = (
      <div className={failed ? 'tb-failed' : 'tb-making'} data-step={step?.step_name} data-step-index={stepIndex} data-error={failed ? step?.error_code ?? 'unknown' : undefined}>
        <Stepper steps={stepViews(creation)} />
        <div className="tb-status">
          <div className={`tb-status-name${failed ? ' tb-status-name--failed' : ''}`}>{label}</div>
          {failed
            // The raw provider error is an admin's, behind Details; never on the page.
            ? isAdmin && step?.error_detail && <button type="button" className="tb-chip tb-error-details" onClick={() => setSheet('details')}>Details</button>
            : <div className="tb-status-eta">{eta}</div>}
        </div>
        {failed && (supporting
          ? <SupportFacts creation={creation} step={step} />
          : <div className="tb-failed-line" role="status">{failedLine(step)}</div>)}
        {!failed && (
          // Keyed by the step's run, so a new step starts its bar from empty
          // instead of sliding backwards from the last one.
          <ProgressBar
            key={stepKey}
            pct={progress?.pct ?? 0}
            showPct={progress?.real}
            label={label}
            valueText={progress ? `${Math.floor(progress.pct)}%${eta ? `, ${eta}` : ''}` : undefined}
          />
        )}
      </div>
    );
    // Primary last (brand book). A picture the safety system refused will be
    // refused again, so there the way on is another picture; Try again stays
    // as the secondary. When our provider is down (its account is empty) a
    // retry fails the same way, so Back is the primary and Try again the
    // secondary. Everything else is worth trying again.
    const blocked = step?.error_code === 'safety_blocked';
    const down = step?.error_code === 'out_of_credits_provider' || step?.error_code === 'provider_setup';
    const buy = <button type="button" className={`tb-btn ${blocked ? 'tb-btn--secondary' : 'tb-btn--primary'} tb-btn--full`} onClick={() => window.dispatchEvent(new CustomEvent('credits:buy'))}><Icon name="coin" />Buy credits</button>;
    const again = short ? buy : (
      <button type="button" className={`tb-btn ${blocked || down ? 'tb-btn--secondary' : 'tb-btn--primary'} tb-btn--full tb-btn--with-trail tb-try-again`} disabled={busy} onClick={tryAgain}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="redo" />Try again</span>
        <span className="tb-btn-trail"><Icon name="coin" size={18} />{retryCost} credits</span>
      </button>
    );
    bar = failed && supporting ? (
      // Support: the facts are above; the per-step tools are one tap away.
      <>
        <button type="button" className="tb-btn tb-btn--secondary tb-btn--full tb-every-step" onClick={props.onShowSteps}><Icon name="grid" />Every step</button>
        <button type="button" className="tb-btn tb-btn--primary tb-btn--full" onClick={props.onBack}>{backLabel}</button>
      </>
    ) : failed && owns ? (
      <>
        {short && <div className="tb-bar-note">You need {retryCost} credits. You have {creditBalance}.</div>}
        {blocked ? (
          <>
            {again}
            <button type="button" className="tb-btn tb-btn--primary tb-btn--full tb-use-another" onClick={props.onMakeOwn}><Icon name="image" />Use another picture</button>
          </>
        ) : down ? (
          <>
            {again}
            <button type="button" className="tb-btn tb-btn--primary tb-btn--full" onClick={props.onBack}>Back to my heroes</button>
          </>
        ) : (
          <>
            <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={props.onBack}>Back to my heroes</button>
            {again}
          </>
        )}
      </>
    ) : (
      <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={props.onBack}>{backLabel}</button>
    );
  }

  return (
    <div className="tb-screen tb-screen--fit tb-hero-screen tb-hero-main" data-state={state} data-foot={ready ? 'row' : 'stack'}>
      {header}
      {/* One element in every state, so the carousel built while the hero is
          made is the one it lives on when ready. */}
      <HeroLive
        key={creation.id}
        creation={creation}
        notice={notice}
        // The action figure: everyone sees it once made (Raz: "for viewing, you
        // don't need to be the admin"); an admin also sees it to make it.
        figure={ready && showFigure && figure ? { credits: supporting ? undefined : creditBalance, initial: figure } : undefined}
        making={ready ? undefined : {
          step: step?.step_name,
          pct: progress?.pct ?? 0,
          failed: state === 'failed',
          failedLabel: failedLabel(step),
          idle: state === 'idle',
          info,
        }}
        page={{ foot: bar, more, onName: owns ? () => setSheet('rename') : undefined }}
      />

      {sheet === 'more' && (
        <Sheet title={name} onClose={() => setSheet(null)}>
          {moreRows}
        </Sheet>
      )}
      {sheet === 'games' && (
        // Two games, side by side and the same size, each behind its poster
        // (key art rendered from a gallery hero: games/hero-moves/tools/make-posters.mjs).
        // One needs nothing but a thumb; the other turns the camera on, and its badge says so.
        <Sheet title="Pick a game" onClose={() => setSheet(null)} className="tb-games-sheet">
          <div className="tb-games">
            {/* The sheet's entry is replaced: the game's Back lands on the hero, not on this sheet. */}
            <a className="tb-game" data-game="arena" href={arenaUrl(creation)} onClick={(e) => { track('game_started', { game: 'arena', hero_id: creation.id }); flush(true); leaveFromOverlay(e, arenaUrl(creation)); }}>
              <span className="tb-game-pic"><img src="/games/robot-rumble.webp" srcSet="/games/robot-rumble.webp 1x, /games/robot-rumble@2x.webp 2x" alt="" width={400} height={500} /></span>
              <span className="tb-game-name">Robot Rumble</span>
              <span className="tb-game-line">Punch, jump, score!</span>
            </a>
            <a className="tb-game" data-game="dance" href={playUrl(creation)} onClick={(e) => { track('game_started', { game: 'dance', hero_id: creation.id }); flush(true); leaveFromOverlay(e, playUrl(creation)); }}>
              <span className="tb-game-pic"><img src="/games/dance-party.webp" srcSet="/games/dance-party.webp 1x, /games/dance-party@2x.webp 2x" alt="" width={400} height={500} /><span className="tb-game-badge" aria-label="Uses the camera"><Icon name="camera" size={16} /></span></span>
              <span className="tb-game-name">Dance party</span>
              <span className="tb-game-line">Dance on camera</span>
            </a>
          </div>
        </Sheet>
      )}
      {sheet === 'details' && step && <ErrorDetailsSheet step={step} onClose={() => setSheet(null)} />}
      {(sheet === 'split' || sheet === 'split-again') && <Suspense fallback={null}><PrintSplitSheet creation={creation} again={sheet === 'split-again'} onClose={() => setSheet(null)} /></Suspense>}
      {(sheet === 'rename' || sheet === 'artist') && <RenameSheet creation={creation} focus={sheet === 'artist' ? 'artist' : 'hero'} onClose={() => setSheet(null)} onSaved={props.onRefresh} />}
      {sheet === 'again' && (
        // Money confirms first (brand book); primary last.
        <Dialog label="Make it again?" onClose={() => setSheet(null)}>
          <div className="tb-h2">Make it again?</div>
          <div className="tb-muted">{shortForAgain
            ? `You need ${againCost} credits. You have ${creditBalance}.`
            : `The same drawing, made again from the start. ${againCost}\u00a0credits.`}</div>
          {error && <div className="tb-muted" role="alert" style={{ color: 'var(--tb-red)' }}>{error}</div>}
          <div className="tb-stack">
            <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={() => setSheet(null)}>Not now</button>
            {shortForAgain ? (
              <button type="button" className="tb-btn tb-btn--primary tb-btn--full" onClick={() => { setSheet(null); window.dispatchEvent(new CustomEvent('credits:buy')); }}>
                <Icon name="coin" />Buy credits
              </button>
            ) : (
              <button type="button" className="tb-btn tb-btn--primary tb-btn--full tb-confirm-again" disabled={busy} onClick={makeAgain}>
                <Icon name="coin" />{busy ? 'Starting…' : `Pay ${againCost} credits`}
              </button>
            )}
          </div>
        </Dialog>
      )}
      {sheet === 'delete' && (
        <Dialog label={`Delete ${name}?`} onClose={() => setSheet(null)}>
          <div className="tb-h2">Delete {name}?</div>
          <div className="tb-muted">This can’t be undone.</div>
          <div className="tb-stack">
            <button type="button" className="tb-btn tb-btn--danger tb-btn--full tb-confirm-delete" disabled={busy} onClick={remove}><Icon name="trash" />Delete hero</button>
            <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={() => setSheet(null)}>Keep it</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/** Admins only: what the provider really said, and the request ID to quote to its support. */
function ErrorDetailsSheet({ step, onClose }: { step: CreationStepResponse; onClose: () => void }) {
  const { copied, copy: copyText } = useCopy();
  const text = [
    `Step: ${step.step_name}`,
    `Code: ${step.error_code ?? 'unknown'}`,
    ...(step.error_request_id ? [`Request ID: ${step.error_request_id}`] : []),
    '',
    step.error_detail ?? '',
  ].join('\n');
  const copy = () => copyText(text);
  return (
    <Sheet title="Details" onClose={onClose} className="tb-error-sheet">
      <dl className="tb-error-facts">
        <dt>Step</dt><dd>{step.step_name}</dd>
        <dt>Code</dt><dd>{step.error_code ?? 'unknown'}</dd>
        {step.error_request_id && <><dt>Request ID</dt><dd className="tb-error-id">{step.error_request_id}</dd></>}
      </dl>
      <pre className="tb-error-raw">{step.error_detail}</pre>
      <div className="tb-stack tb-error-sheet-bar">
        <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={copy}><Icon name={copied ? 'check' : 'copy'} />{copied ? 'Copied' : 'Copy details'}</button>
      </div>
    </Sheet>
  );
}

/** "Lia, 6": who drew it, as the polaroid credits them. */
function artistLine(c: CreationResponse): string {
  return c.name ? `${c.name}${c.age ? `, ${c.age}` : ''}` : '';
}

/**
 * Support's view of a failed hero that is not theirs: whose it is, the step
 * that failed and why (its error code), and whether its credits came back.
 * The provider's own words stay behind Details.
 */
function SupportFacts({ creation, step }: { creation: CreationResponse; step: CreationStepResponse | undefined }) {
  const owner = [creation.owner_name, creation.username].filter(Boolean).join(' · ');
  return (
    <dl className="tb-error-facts tb-support-facts" role="status">
      <dt>Owner</dt><dd dir="auto">{owner || 'Unknown'}</dd>
      <dt>Failed</dt><dd>{step ? `${STEP_UI[step.step_name]?.short ?? step.step_name} · ${step.error_code ?? 'unknown'}` : 'Unknown'}</dd>
      <dt>Credits</dt><dd>{refundWords(step) || 'Unknown'}</dd>
    </dl>
  );
}

/** Hero names are kept short enough for a tile; the artist as the server bounds it. */
const HERO_NAME_MAX = 60;
const ARTIST_NAME_MAX = 40;

/**
 * The hero's name and who drew it: the polaroid's "by Lia, 6". A parent's
 * account credits the parent until they say their child drew it.
 */
function RenameSheet({ creation, focus, onClose, onSaved }: { creation: CreationResponse; focus: 'hero' | 'artist'; onClose: () => void; onSaved: () => Promise<void> }) {
  const [hero, setHero] = useState(creation.character_name ?? '');
  const [artist, setArtist] = useState(creation.name ?? '');
  const [age, setAge] = useState(creation.age ? String(creation.age) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ageValue = age.trim() === '' ? null : Number(age.trim());
  const ageOk = ageValue === null || (Number.isInteger(ageValue) && ageValue >= 1 && ageValue <= 120);
  // A hero that has a name keeps one; an unnamed one may stay unnamed.
  const heroOk = hero.trim() !== '' || !creation.character_name;
  const changes: { character_name?: string; name?: string; age?: number | null } = {};
  if (hero.trim() !== (creation.character_name ?? '')) changes.character_name = hero.trim();
  if (artist.trim() !== (creation.name ?? '')) changes.name = artist.trim();
  if (ageValue !== (creation.age ?? null)) changes.age = ageValue;
  const changed = Object.keys(changes).length > 0;
  const save = async () => {
    if (!changed || !ageOk || !heroOk) return;
    setSaving(true);
    try {
      await api.updateHero(creation.id, changes);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
      setSaving(false);
    }
  };
  const enter = (e: KeyboardEvent) => { if (e.key === 'Enter') save(); };
  return (
    <Sheet title={focus === 'artist' ? 'Who drew it' : 'Rename your hero'} onClose={onClose} className="tb-rename-sheet">
      <div className="tb-field">
        <label htmlFor="tb-rename">Hero name</label>
        <input id="tb-rename" className="tb-input" value={hero} maxLength={HERO_NAME_MAX} autoFocus={focus === 'hero'} onChange={(e) => setHero(e.target.value)} onKeyDown={enter} />
      </div>
      <div className="tb-rename-artist">
        <div className="tb-field">
          <label htmlFor="tb-artist">Who drew it</label>
          <input id="tb-artist" className="tb-input" value={artist} maxLength={ARTIST_NAME_MAX} autoComplete="off" autoFocus={focus === 'artist'} placeholder="Name" onChange={(e) => setArtist(e.target.value)} onKeyDown={enter} />
        </div>
        <div className="tb-field tb-rename-age">
          <label htmlFor="tb-artist-age">Age</label>
          <input id="tb-artist-age" className="tb-input" value={age} inputMode="numeric" maxLength={3} autoComplete="off" aria-invalid={!ageOk} onChange={(e) => setAge(e.target.value.replace(/[^0-9]/g, ''))} onKeyDown={enter} />
        </div>
      </div>
      {error && <div className="tb-muted" role="alert">{error}</div>}
      {/* Secondary, then the primary last (brand book). */}
      <div className="tb-stack tb-rename-bar">
        <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={onClose}>Cancel</button>
        <button type="button" className="tb-btn tb-btn--primary tb-btn--full tb-rename-save" disabled={saving || !changed || !ageOk || !heroOk} onClick={save}>Save</button>
      </div>
    </Sheet>
  );
}
