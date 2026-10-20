import { useEffect, useRef, useState } from 'react';
import { api, ApiError, CreationResponse, CreationStepResponse, PAINTING_FILE, paintingFramed } from '../../api/client';
import { getTotalCost } from '../../config/steps';
import { arenaUrl, playUrl } from '../../config/play';
import { heroLink, leaveFromOverlay } from '../../routes';
import { HeroLive } from './HeroLive';
import { Icon } from './Icon';
import { Dialog, Header, NavButton, Polaroid, ProgressBar, Sheet, SheetRow, Stepper, useClearOfPolaroid, useFitScreen } from './parts';
import { STEP_UI, StepProgress, currentStep, etaText, failedLabel, failedLine, heroName, heroState, holdSteady, remainingCost, stepProgress, stepViews } from './pipeline';
import './HeroScreen.css';

interface HeroScreenProps {
  creation: CreationResponse;
  isLoggedIn: boolean;
  currentUserId?: string;
  isAdmin: boolean;
  creditBalance?: number;
  onBack: () => void;
  onRefresh: () => Promise<void>;
  onDeleted: () => void;
  onShowSteps: () => void;
  onMakeOwn: () => void;
  onCreditsChanged: () => void;
  /** Opened by a teacher from their class: read-only, back goes to the class. */
  fromClass?: boolean;
}

/**
 * One hero, in whichever state it is in: being made, failed, or ready.
 * The layout is the same in all three — header, the hero, a bottom bar — so
 * nothing jumps around as the hero comes to life. Ready, the hero is live in
 * 3D on this page, with its moves under it (HeroLive): how it was made plays
 * in the same stage the first time it is opened.
 */
export function HeroScreen(props: HeroScreenProps) {
  const { creation, isLoggedIn, currentUserId, isAdmin, creditBalance } = props;
  const state = heroState(creation);
  const owns = isLoggedIn && (isAdmin || creation.user_id === currentUserId);
  // A teacher looking at a student's hero shares it, never "makes their own".
  const shares = owns || !!props.fromClass;
  const backLabel = props.fromClass ? 'Back to class' : 'Back to heroes';
  const name = heroName(creation);
  const [sheet, setSheet] = useState<'more' | 'rename' | 'delete' | 'again' | 'games' | 'details' | null>(null);
  const [introRequest, setIntroRequest] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const shown = useRef<(StepProgress & { key: string }) | null>(null);
  useFitScreen();

  // The bar and the time left move every second, between the 2 s polls.
  useEffect(() => {
    if (state !== 'making') return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  const file = (f: string) => api.heroFileUrl(creation, f);
  const step = currentStep(creation);
  const now = Date.now();
  const measured = stepProgress(step, now);
  const stepKey = `${step?.step_name}:${step?.started_at}`;
  // Per run of a step: never backwards, and the time left never jumps up.
  const progress = measured ? (shown.current = holdSteady(shown.current, stepKey, measured)) : null;
  const stepIndex = step ? creation.steps.indexOf(step) : creation.steps.length;
  // What the user sees grow: the drawing until it is painted, then the painting.
  const painted = creation.steps.find((s) => s.step_name === 'openai_render')?.status === 'completed';
  // The painting stands on the stage as its cut-out (PAINTING_FILE), or as a
  // polaroid when it has no confident one.
  const art = painted ? file(PAINTING_FILE) : file('original.jpg');
  const framed = painted && paintingFramed(creation);
  useClearOfPolaroid(stageRef, `${state}:${art}`);

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

  // Share sends the hero's own link: whoever opens it (grandma, signed out)
  // sees the hero move. The picture goes along only where the platform takes
  // one, read ahead (the gallery's thumbnail, usually cached) so the tap
  // shares at once: a read after the tap can outlive its permission to share.
  const pic = useRef<File | null>(null);
  const [copied, setCopied] = useState(false);
  const canShareFiles = typeof navigator !== 'undefined' && !!navigator.canShare;
  useEffect(() => {
    pic.current = null;
    if (!canShareFiles || !shares || state !== 'ready') return;
    let alive = true;
    fetch(file('thumb_rendered.png'))
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (!alive || !b) return;
        // Storage can type a picture binary/octet-stream, which no share
        // target takes: name it by what it is (a thumbnail is WebP or PNG).
        const type = b.type.startsWith('image/') ? b.type : 'image/png';
        const f = new File([b], `${name}.${type === 'image/webp' ? 'webp' : 'png'}`, { type });
        if (navigator.canShare?.({ files: [f] })) pic.current = f;
      })
      .catch(() => { /* the link alone */ });
    return () => { alive = false; };
  }, [creation.id, shares, state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 4000);
    return () => window.clearTimeout(t);
  }, [copied]);
  const share = async () => {
    const url = heroLink(creation.id);
    const title = name;
    const text = `Meet ${name}! Tap to see it move.`;
    if (navigator.share) {
      const withPic = pic.current && { title, url, files: [pic.current], text: `${text} ${url}` };
      try {
        // Some apps keep the picture and drop the url field: with a picture, the link rides in the text too.
        if (withPic && navigator.canShare?.(withPic)) await navigator.share(withPic);
        else await navigator.share({ title, text, url });
        return;
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return;
      }
    }
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { window.prompt('Copy the link', url); }
  };

  const retryCost = remainingCost(creation);
  const short = creditBalance !== undefined && retryCost > creditBalance;

  const ready = state === 'ready';
  const canShare = ready || painted;
  // The sheet behind ⋯ : the same button for everyone, more rows for the owner.
  const moreRows = [
    canShare && <SheetRow key="share" icon="share" label="Share" onClick={() => { setSheet(null); share(); }} />,
    ready && <SheetRow key="made" icon="layers" label="How it was made" onClick={() => { setSheet(null); setIntroRequest((n) => n + 1); }} />,
    ...(owns ? [
      <SheetRow key="rename" icon="pencil" label="Rename" onClick={() => setSheet('rename')} />,
      ready && <SheetRow key="again" icon="redo" label="Make it again" trail={`${againCost} credits`} onClick={() => setSheet('again')} />,
      ready && <SheetRow key="vrm" icon="download" label="Download 3D file" trail=".vrm" onClick={downloadVrm} />,
      // The per-step admin view is a debugging tool, not designed for users.
      isAdmin && <SheetRow key="steps" icon="grid" label="Admin: every step" onClick={() => { setSheet(null); props.onShowSteps(); }} />,
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

  // Back | the hero's name | ⋯ — the same three things on every state, so
  // nothing moves as the hero comes to life. With nothing to offer (a visitor
  // watching a hero being made) the end keeps its width, empty.
  const header = (
    <Header
      left={<NavButton icon="back" label={backLabel} onClick={props.onBack} className="tb-back" />}
      title={name}
      titleClassName="hero-name"
      right={moreRows.length > 0 && <NavButton icon="more" label="More" onClick={() => setSheet('more')} className="tb-more" />}
    />
  );

  // Being made, or failed: the picture so far. (Ready, HeroLive has the stage.)
  const stage = (
    <div ref={stageRef} className="tb-stage tb-hero-stage">
      <img className={`tb-stage-img${framed ? ' tb-stage-img--framed' : ''}${state === 'failed' ? ' tb-hero-faded' : ''}`} src={art} alt={name} />
      {/* Something on the stage always moves while the hero is made: a scan
          over the drawing, then a gloss over the painting. */}
      {state === 'making' && (painted ? <div className="tb-shimmer" /> : <div className="tb-scanline" />)}
      {painted && <Polaroid src={file('thumb_original.jpg')} artist={creation.name} age={creation.age} />}
    </div>
  );

  const notice = error
    ? <div className="tb-notice tb-notice--error" role="alert">{error}<button type="button" className="tb-btn tb-btn--secondary tb-btn--sm" onClick={() => setError(null)}>OK</button></div>
    // Shared from ⋯ with no Share button on the bar to say so.
    : copied && !(state === 'ready' && shares) && <div className="tb-notice" role="status"><Icon name="check" />Link copied</div>;

  let body;
  let bar;
  if (state === 'ready') {
    // One secondary, then the primary last: the same place for it whoever is
    // looking. Only the secondary differs.
    bar = (
      <>
        {shares
          ? <button type="button" className="tb-btn tb-btn--secondary tb-btn--full tb-share" onClick={share}><Icon name={copied ? 'check' : 'share'} />{copied ? 'Link copied' : 'Share'}</button>
          : <button type="button" className="tb-btn tb-btn--secondary tb-btn--full tb-make-own" onClick={props.onMakeOwn}><Icon name="pencil" />Make your own</button>}
        <button type="button" className="tb-btn tb-btn--primary tb-btn--full tb-play" onClick={() => setSheet('games')}><Icon name="play" />Play</button>
      </>
    );
  } else if (state === 'idle') {
    // Picked, never made ("Make my hero" was not pressed). Nothing runs, so
    // nothing here moves or counts down: the drawing and what is true.
    body = (
      <>
        {stage}
        <div className="tb-making tb-idle">
          <div className="tb-status"><div className="tb-status-name">Never started</div></div>
          <div className="tb-failed-line" role="status">Nothing was charged.</div>
        </div>
      </>
    );
    bar = <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={props.onBack}>{backLabel}</button>;
  } else {
    const failed = state === 'failed';
    const label = failed ? failedLabel(step) : step ? STEP_UI[step.step_name]?.label ?? step.step_name : 'Waiting to start';
    const eta = progress ? etaText(progress.endsAt, now) : '';
    body = (
      <>
        {stage}
        <div className={failed ? 'tb-failed' : 'tb-making'} data-step={step?.step_name} data-step-index={stepIndex} data-error={failed ? step?.error_code ?? 'unknown' : undefined}>
          <Stepper steps={stepViews(creation)} />
          <div className="tb-status">
            <div className={`tb-status-name${failed ? ' tb-status-name--failed' : ''}`}>{label}</div>
            {failed
              // The raw provider error is an admin's, behind Details; never on the page.
              ? isAdmin && step?.error_detail && <button type="button" className="tb-chip tb-error-details" onClick={() => setSheet('details')}>Details</button>
              : <div className="tb-status-eta">{eta}</div>}
          </div>
          {failed && <div className="tb-failed-line" role="status">{failedLine(step)}</div>}
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
      </>
    );
    // Primary last (brand book). A picture the safety system refused will be
    // refused again, so there the way on is another picture; Try again stays
    // as the secondary. When our provider is down (its account is empty) a
    // retry fails the same way, so Back is the primary and Try again the
    // secondary. Everything else is worth trying again.
    const blocked = step?.error_code === 'safety_blocked';
    const down = step?.error_code === 'out_of_credits_provider';
    const buy = <button type="button" className={`tb-btn ${blocked ? 'tb-btn--secondary' : 'tb-btn--primary'} tb-btn--full`} onClick={() => window.dispatchEvent(new CustomEvent('credits:buy'))}><Icon name="coin" />Buy credits</button>;
    const again = short ? buy : (
      <button type="button" className={`tb-btn ${blocked || down ? 'tb-btn--secondary' : 'tb-btn--primary'} tb-btn--full tb-btn--with-trail tb-try-again`} disabled={busy} onClick={tryAgain}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="redo" />Try again</span>
        <span className="tb-btn-trail"><Icon name="coin" size={18} />{retryCost} credits</span>
      </button>
    );
    bar = failed && owns ? (
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
    <div className="tb-screen tb-screen--fit tb-hero-screen" data-state={state}>
      {header}
      {ready
        ? <HeroLive key={creation.id} creation={creation} introRequest={introRequest} notice={notice} />
        : <div className="tb-screen-body">{notice}{body}</div>}
      <div className="tb-bar">{bar}</div>

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
            <a className="tb-game" data-game="arena" href={arenaUrl(creation)} onClick={(e) => leaveFromOverlay(e, arenaUrl(creation))}>
              <span className="tb-game-pic"><img src="/games/robot-rumble.webp" srcSet="/games/robot-rumble.webp 1x, /games/robot-rumble@2x.webp 2x" alt="" width={400} height={500} /></span>
              <span className="tb-game-name">Robot Rumble</span>
              <span className="tb-game-line">Punch, jump, score!</span>
            </a>
            <a className="tb-game" data-game="dance" href={playUrl(creation)} onClick={(e) => leaveFromOverlay(e, playUrl(creation))}>
              <span className="tb-game-pic"><img src="/games/dance-party.webp" srcSet="/games/dance-party.webp 1x, /games/dance-party@2x.webp 2x" alt="" width={400} height={500} /><span className="tb-game-badge" aria-label="Uses the camera"><Icon name="camera" size={16} /></span></span>
              <span className="tb-game-name">Dance party</span>
              <span className="tb-game-line">Dance on camera</span>
            </a>
          </div>
        </Sheet>
      )}
      {sheet === 'details' && step && <ErrorDetailsSheet step={step} onClose={() => setSheet(null)} />}
      {sheet === 'rename' && <RenameSheet creation={creation} onClose={() => setSheet(null)} onSaved={props.onRefresh} />}
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
  const [copied, setCopied] = useState(false);
  const text = [
    `Step: ${step.step_name}`,
    `Code: ${step.error_code ?? 'unknown'}`,
    ...(step.error_request_id ? [`Request ID: ${step.error_request_id}`] : []),
    '',
    step.error_detail ?? '',
  ].join('\n');
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* the text is selectable */ }
  };
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

function RenameSheet({ creation, onClose, onSaved }: { creation: CreationResponse; onClose: () => void; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState(creation.character_name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setSaving(true);
    try {
      await api.updateCharacterName(creation.id, value.trim());
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
      setSaving(false);
    }
  };
  return (
    <Sheet title="Rename your hero" onClose={onClose}>
      <div className="tb-field">
        <label htmlFor="tb-rename">Hero name</label>
        <input id="tb-rename" className="tb-input" value={value} maxLength={60} autoFocus onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
      </div>
      {error && <div className="tb-muted" role="alert">{error}</div>}
      <div className="tb-stack" style={{ paddingTop: 16 }}>
        <button type="button" className="tb-btn tb-btn--primary tb-btn--full" disabled={saving || !value.trim()} onClick={save}>Save name</button>
        <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={onClose}>Cancel</button>
      </div>
    </Sheet>
  );
}
