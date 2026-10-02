import { useEffect, useState } from 'react';
import { api, ApiError, CreationResponse } from '../../api/client';
import { getTotalCost } from '../../config/steps';
import { playUrl } from '../../config/play';
import { Icon } from './Icon';
import { Dialog, Header, NavButton, Sheet, SheetRow, Stepper } from './parts';
import { STEP_UI, currentStep, etaText, heroName, heroState, remainingCost, stepViews } from './pipeline';
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
}

/**
 * One hero, in whichever state it is in: being made, failed, or ready.
 * The layout is the same in all three — header, the hero, a bottom bar — so
 * nothing jumps around as the hero comes to life.
 */
export function HeroScreen(props: HeroScreenProps) {
  const { creation, isLoggedIn, currentUserId, isAdmin, creditBalance } = props;
  const state = heroState(creation);
  const owns = isLoggedIn && (isAdmin || creation.user_id === currentUserId);
  const name = heroName(creation);
  const [sheet, setSheet] = useState<'more' | 'rename' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);

  // The estimate counts down between polls.
  useEffect(() => {
    if (state !== 'making') return;
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [state]);

  const file = (f: string) => api.getFileUrl(creation.id, f, creation.user_id);
  const step = currentStep(creation);
  const stepIndex = step ? creation.steps.indexOf(step) : creation.steps.length;
  // What the user sees grow: the drawing until it is painted, then the painting.
  const painted = creation.steps.find((s) => s.step_name === 'openai_render')?.status === 'completed';
  const art = painted ? file('rendered.png') : file('original.jpg');

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

  const tryAgain = () => run(async () => {
    for (const s of creation.steps.filter((x) => x.status === 'pending' || x.status === 'failed')) {
      await api.runStep(creation.id, s.step_name);
    }
  }, 'Could not start again');
  const makeAgain = () => run(() => api.runPipeline(creation.id), 'Could not start again');
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
  const share = async () => {
    const url = file('rendered.png');
    try {
      const blob = await (await fetch(url)).blob();
      const pic = new File([blob], `${name}.png`, { type: blob.type || 'image/png' });
      if (navigator.canShare?.({ files: [pic] })) {
        await navigator.share({ files: [pic], title: name });
        return;
      }
    } catch { /* fall through to a plain link */ }
    window.open(url, '_blank', 'noopener');
  };

  const retryCost = remainingCost(creation);
  const short = creditBalance !== undefined && retryCost > creditBalance;

  const header = (
    <Header
      left={<NavButton icon="back" label="Back to heroes" onClick={props.onBack} className="tb-back" />}
      title={state === 'making' || state === 'idle' ? `Making ${name}` : undefined}
      right={owns && state !== 'making' ? <NavButton icon="more" label="More actions" onClick={() => setSheet('more')} className="tb-more" /> : undefined}
    />
  );

  const stage = (
    <div className="tb-stage tb-hero-stage">
      {state === 'ready' && <div className="tb-stage-sun" />}
      <img className={`tb-stage-img${state === 'failed' ? ' tb-hero-faded' : ''}`} src={art} alt={name} />
      {state === 'making' && !painted && <div className="tb-scanline" />}
      {(state === 'ready' || painted) && (
        <div className="tb-polaroid">
          <img src={file('thumb_original.jpg')} alt="The drawing" />
          <div>{creation.name ? `${creation.name}${creation.age ? `, ${creation.age}` : ''}` : 'The drawing'}</div>
        </div>
      )}
    </div>
  );

  let body;
  let bar;
  if (state === 'ready') {
    body = (
      <>
        <div className="tb-hero-title tb-ready">
          <div className="tb-eyebrow">{creation.name ? `${creation.name}’s hero is ready` : 'Your hero is ready'}</div>
          <div className="tb-h1 hero-name">{name}</div>
        </div>
        {stage}
      </>
    );
    bar = owns ? (
      <>
        <a className="tb-btn tb-btn--primary tb-btn--full tb-play control-bar-play" href={playUrl(creation)}><Icon name="play" />Play with {name}</a>
        <div className="tb-bar-row">
          <button type="button" className="tb-btn tb-btn--secondary tb-btn--sm" onClick={share}><Icon name="share" />Share</button>
          <button type="button" className="tb-btn tb-btn--secondary tb-btn--sm" onClick={downloadVrm}><Icon name="download" />Download</button>
        </div>
      </>
    ) : (
      <>
        <a className="tb-btn tb-btn--primary tb-btn--full tb-play" href={playUrl(creation)}><Icon name="play" />Play with {name}</a>
        <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={props.onMakeOwn}><Icon name="camera" />Make your own hero</button>
      </>
    );
  } else {
    const label = state === 'failed' && step ? `${STEP_UI[step.step_name]?.label ?? step.step_name} failed` : step ? STEP_UI[step.step_name]?.label ?? step.step_name : 'Waiting to start';
    body = (
      <>
        {stage}
        <div className={state === 'failed' ? 'tb-failed' : 'tb-making'} data-step={step?.step_name} data-step-index={stepIndex}>
          <Stepper steps={stepViews(creation)} />
          <div className="tb-status">
            <div className={`tb-status-name${state === 'failed' ? ' tb-status-name--failed' : ''}`}>{label}</div>
            <div className="tb-status-eta">{state === 'failed' ? 'Credits returned' : etaText(step)}</div>
          </div>
          {state === 'failed' && step?.error_message && isAdmin && <div className="tb-muted tb-error-detail">{step.error_message}</div>}
        </div>
      </>
    );
    bar = state === 'failed' && owns ? (
      <>
        {short && <div className="tb-bar-note">You need {retryCost} credits. You have {creditBalance}.</div>}
        {short
          ? <button type="button" className="tb-btn tb-btn--primary tb-btn--full" onClick={() => window.dispatchEvent(new CustomEvent('credits:buy'))}><Icon name="coin" />Buy credits</button>
          : <button type="button" className="tb-btn tb-btn--primary tb-btn--full tb-btn--with-trail tb-try-again" disabled={busy} onClick={tryAgain}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="redo" />Try again</span>
              <span className="tb-btn-trail"><Icon name="coin" size={18} />{retryCost} credits</span>
            </button>}
        <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={props.onBack}>Back to my heroes</button>
      </>
    ) : (
      <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={props.onBack}>Back to heroes</button>
    );
  }

  return (
    <div className="tb-screen tb-hero-screen" data-state={state}>
      {header}
      <div className="tb-screen-body">
        {error && <div className="tb-notice tb-notice--error" role="alert">{error}<button type="button" className="tb-link" onClick={() => setError(null)}>OK</button></div>}
        {body}
      </div>
      <div className="tb-bar">{bar}</div>

      {sheet === 'more' && (
        <Sheet title={name} onClose={() => setSheet(null)}>
          <SheetRow icon="pencil" label="Rename" onClick={() => setSheet('rename')} />
          {state === 'ready' && <SheetRow icon="redo" label="Make it again" trail={`${getTotalCost()} credits`} onClick={makeAgain} />}
          {state === 'ready' && <SheetRow icon="download" label="Download 3D file" trail=".vrm" onClick={downloadVrm} />}
          <SheetRow icon="grid" label="See every step" onClick={() => { setSheet(null); props.onShowSteps(); }} />
          <div className="tb-sheet-divider" />
          <SheetRow icon="trash" label="Delete hero" danger onClick={() => setSheet('delete')} />
        </Sheet>
      )}
      {sheet === 'rename' && <RenameSheet creation={creation} onClose={() => setSheet(null)} onSaved={props.onRefresh} />}
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
