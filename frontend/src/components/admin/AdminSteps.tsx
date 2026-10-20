import { ReactNode, useEffect, useState } from 'react';
import { api, ApiError, CreationResponse, CreationStepResponse } from '../../api/client';
import { getStepByName } from '../../config/steps';
import { ModelPreview } from '../LazyModelPreview';
import { Icon, IconName } from '../tb/Icon';
import { Dialog, Header, NavButton } from '../tb/parts';
import { STEP_UI, etaText, heroName, refundWords, stepProgress } from '../tb/pipeline';
import './admin.css';

/** Something that spends credits or deletes: asked first (brand book). */
interface Ask { title: string; line: string; action: string; danger?: boolean; run: () => Promise<unknown> }

const STATUS_WORD: Record<CreationStepResponse['status'], string> = {
  pending: 'Waiting',
  processing: 'Running',
  completed: 'Done',
  failed: 'Failed',
};
const STATUS_PILL: Record<CreationStepResponse['status'], string> = {
  pending: 'adm-pill--off',
  processing: '',
  completed: 'adm-pill--active',
  failed: 'adm-pill--bad',
};

/**
 * "Admin: every step": one hero's pipeline, step by step, for support and
 * debugging. Each step's state, its error (code, refund, the provider's own
 * words), its output, and the tools: run, retry, redo, cancel, download. All
 * of it charges the hero's OWNER, never the admin, and says so.
 */
export function AdminSteps({ creation, currentUserId, onBack, onRefresh, onCreditsChanged, onDeleted }: {
  creation: CreationResponse;
  currentUserId: string;
  onBack: () => void;
  onRefresh: () => Promise<void>;
  onCreditsChanged: () => void;
  onDeleted: () => void;
}) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [, tick] = useState(0);
  const running = creation.steps.some((s) => s.status === 'processing');
  // The time left moves every second, between the polls.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  const mine = creation.user_id === currentUserId;
  const owner = mine ? 'you' : creation.owner_name || creation.username || 'the owner';
  const ownerFull = [creation.owner_name, creation.username].filter(Boolean).join(' · ');
  const toRun = creation.steps.find((s) => s.status === 'pending' || s.status === 'failed');
  // The first step not done is the one that can run next, while nothing runs.
  const next = running ? undefined : creation.steps.find((s) => s.status !== 'completed');
  const cost = (s: CreationStepResponse) => getStepByName(s.step_name)?.credit_cost ?? 0;
  const label = (s: CreationStepResponse) => getStepByName(s.step_name)?.display_name || STEP_UI[s.step_name]?.short || s.step_name;
  const charge = (n: number) => (n ? `It charges ${owner} ${n} ${n === 1 ? 'credit' : 'credits'}.` : 'It costs nothing.');
  const fromHere = (s: CreationStepResponse) => creation.steps.slice(creation.steps.indexOf(s))
    .filter((x) => x.status !== 'completed' || x === s).reduce((n, x) => n + cost(x), 0);

  const act = async (what: () => Promise<unknown>, fail: string, leaves = false) => {
    setBusy(true);
    setError(null);
    try {
      await what();
      if (leaves) return;  // the hero is gone: nothing to read again
      window.dispatchEvent(new CustomEvent('creation:refresh-now', { detail: { creationId: creation.id } }));
      window.dispatchEvent(new CustomEvent('credits:changed'));
      onCreditsChanged();
      await onRefresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : fail);
    } finally {
      setBusy(false);
      setAsk(null);
    }
  };
  const confirm = (a: Ask) => setAsk(a);

  const copyId = async () => {
    try { await navigator.clipboard.writeText(creation.id); setCopied(true); } catch { /* the id is selectable */ }
  };
  const download = (file: string) => api.downloadFile(creation.id, file, creation.user_id).catch(() => setError(`Could not download ${file}`));

  const allCost = creation.steps.reduce((n, s) => n + cost(s), 0);

  return (
    <div className="tb-screen tb-screen--wide adm-steps-screen">
      <Header left={<NavButton icon="back" label="Back to hero" onClick={onBack} className="tb-back" />} title="Every step" />
      <div className="tb-screen-body">
        <div className="adm">
          <section className="adm-card adm-steps-facts" aria-label="Hero">
            <h2 className="adm-title" dir="auto">{heroName(creation)}</h2>
            <dl className="adm-facts">
              <dt>Owner</dt><dd dir="auto">{mine ? 'You' : ownerFull || 'Unknown'}</dd>
              {creation.name && <><dt>Drawn by</dt><dd dir="auto">{creation.name}{creation.age ? `, ${creation.age}` : ''}</dd></>}
              <dt>Hero ID</dt>
              <dd className="adm-facts-id">
                <span className="adm-copyable">{creation.id}</span>
                <button type="button" className="tb-btn tb-btn--secondary adm-btn-xs" onClick={copyId}><Icon name={copied ? 'check' : 'copy'} size={18} />{copied ? 'Copied' : 'Copy'}</button>
              </dd>
            </dl>
            <div className="adm-note">Every run here is paid from {mine ? 'your' : `${owner}’s`} credits.</div>
          </section>

          {error && <div className="adm-error" role="alert">{error}</div>}

          {creation.steps.map((s, i) => (
            <AdminStepCard
              key={s.step_name}
              creation={creation}
              step={s}
              index={i}
              label={label(s)}
              busy={busy}
              actions={stepActions(s)}
            />
          ))}

          <section className="adm-card" aria-label="Delete">
            <button type="button" className="tb-btn tb-btn--danger tb-btn--full" disabled={busy}
              onClick={() => confirm({
                title: `Delete ${heroName(creation)}?`, line: 'This can’t be undone.', action: 'Delete hero', danger: true,
                run: () => api.deleteCreation(creation.id).then(onDeleted),
              })}>
              <Icon name="trash" />Delete hero
            </button>
          </section>
        </div>
      </div>
      <div className="tb-bar">
        <button type="button" className={`tb-btn ${toRun ? 'tb-btn--secondary' : 'tb-btn--primary'} tb-btn--full`} disabled={busy || running}
          onClick={() => confirm({
            title: 'Restart every step?', line: `The outputs are made again. ${charge(allCost)}`, action: 'Restart',
            run: () => api.runPipeline(creation.id),
          })}>
          <Icon name="redo" />Restart
        </button>
        {toRun && (
          <button type="button" className="tb-btn tb-btn--primary tb-btn--full adm-continue" disabled={busy || running}
            onClick={() => confirm({
              title: `Continue from ${label(toRun)}?`, line: charge(fromHere(toRun)), action: 'Continue',
              run: () => api.runPipeline(creation.id, toRun.step_name),
            })}>
            <Icon name="play" />Continue
          </button>
        )}
      </div>

      {ask && (
        <Dialog label={ask.title} onClose={() => { if (!busy) setAsk(null); }}>
          <div className="tb-h2">{ask.title}</div>
          <div className="tb-muted">{ask.line}</div>
          <div className="tb-stack">
            <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" disabled={busy} onClick={() => setAsk(null)}>Cancel</button>
            <button type="button" className={`tb-btn ${ask.danger ? 'tb-btn--danger' : 'tb-btn--primary'} tb-btn--full adm-ask-go`} disabled={busy}
              onClick={() => act(ask.run, 'That did not work. Try again.', ask.danger)}>
              {ask.action}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );

  /** The tools for one step, by its state: all secondary, the bar holds the grape. */
  function stepActions(s: CreationStepResponse): ReactNode {
    const n = cost(s);
    const priced = (icon: IconName, text: string, onClick: () => void, cls = '') => (
      <button type="button" className={`tb-btn tb-btn--secondary adm-btn-xs ${cls}`.trim()} disabled={busy || running} onClick={onClick}>
        <Icon name={icon} size={18} />{text}{n > 0 && <span className="adm-step-cost"><Icon name="coin" size={16} />{n}</span>}
      </button>
    );
    const runStep = (verb: string) => () => confirm({
      title: `${verb} ${label(s)}?`, line: charge(n), action: verb,
      run: () => api.runStep(creation.id, s.step_name),
    });
    if (s.status === 'processing') {
      return (
        <button type="button" className="tb-btn tb-btn--secondary adm-btn-xs" disabled={busy}
          onClick={() => act(() => api.cancelStep(creation.id, s.step_name), 'Could not cancel')}>
          <Icon name="close" size={18} />Cancel
        </button>
      );
    }
    const output = getStepByName(s.step_name)?.output_file;
    if (s.status === 'completed') {
      return (
        <>
          {output && (
            <button type="button" className="tb-btn tb-btn--secondary adm-btn-xs" onClick={() => download(output)}>
              <Icon name="download" size={18} />Download
            </button>
          )}
          {priced('redo', 'Redo', runStep('Redo'))}
        </>
      );
    }
    if (s.status === 'failed') {
      return (
        <>
          {priced('redo', 'Retry', runStep('Retry'), 'adm-retry')}
          <button type="button" className="tb-btn tb-btn--secondary adm-btn-xs" disabled={busy || running}
            onClick={() => confirm({
              title: `Continue from ${label(s)}?`, line: charge(fromHere(s)), action: 'Continue',
              run: () => api.runPipeline(creation.id, s.step_name),
            })}>
            <Icon name="play" size={18} />Retry and continue
          </button>
        </>
      );
    }
    return s === next ? priced('play', 'Run', runStep('Run')) : null;
  }
}

/** One step: its number and name (whole, never cut), its state, its error or output, its tools. */
function AdminStepCard({ creation, step, index, label, busy, actions }: {
  creation: CreationResponse;
  step: CreationStepResponse;
  index: number;
  label: string;
  busy: boolean;
  actions: ReactNode;
}) {
  const now = Date.now();
  const progress = stepProgress(step, now);
  const output = getStepByName(step.step_name)?.output_file;
  const file = (f: string) => api.heroFileUrl(creation, f);
  const done = step.status === 'completed' && !!output;
  const image = done && /\.(png|jpe?g)$/.test(output!) ? file(output!) : null;
  const walking = step.step_name === 'meshy_rig' ? step.metadata_json?.walking_glb_url as string | undefined : undefined;
  const model = done && output!.endsWith('.glb') ? file(`opt_${walking || output}`) : null;
  const detail = step.error_detail || step.error_message;
  return (
    <section className="adm-card adm-step" data-step={step.step_name} data-status={step.status} aria-label={label} aria-busy={busy || undefined}>
      <div className="adm-step-head">
        <span className={`adm-step-num adm-step-num--${step.status}`} aria-hidden="true">
          {step.status === 'completed' ? <Icon name="check" size={20} /> : index + 1}
        </span>
        <span className="adm-step-title">
          <span className="adm-title">{label}</span>
          <small>
            {step.status === 'processing'
              ? [progress?.real ? `${Math.floor(progress.pct)}%` : null, progress ? etaText(progress.endsAt, now) : null].filter(Boolean).join(' · ') || 'Running'
              : step.step_name}
          </small>
        </span>
        <span className={`adm-pill ${STATUS_PILL[step.status]}`}>{STATUS_WORD[step.status]}</span>
      </div>

      {step.status === 'failed' && (
        <div className="adm-step-error">
          <div className="adm-step-error-line">
            <span className="adm-pill adm-pill--bad">{step.error_code ?? 'unknown'}</span>
            <span>{refundWords(step)}</span>
          </div>
          {step.error_request_id && <div className="adm-note">Request ID <span className="adm-copyable">{step.error_request_id}</span></div>}
          {detail && <pre className="adm-step-raw">{detail}</pre>}
        </div>
      )}

      {image && (
        <div className="adm-step-output">
          <img src={image} alt={label} loading="lazy" decoding="async" />
        </div>
      )}
      {model && (
        <div className="adm-step-output adm-step-output--3d">
          <ModelPreview
            url={model}
            isRigged={step.step_name === 'meshy_rig'}
            walkingUrl={walking ? model : null}
            riggedUrl={step.step_name === 'meshy_rig' ? file(`opt_${output}`) : null}
          />
        </div>
      )}

      {actions && <div className="adm-step-actions">{actions}</div>}
    </section>
  );
}
