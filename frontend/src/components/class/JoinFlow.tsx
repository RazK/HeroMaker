import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, CreationResponse } from '../../api/client';
import { GuestView, studentApi } from '../../api/classes';
import { FileUpload } from '../FileUpload';
import { HeroLive } from '../tb/HeroLive';
import { Icon } from '../tb/Icon';
import { Header, NavButton, Polaroid, ProgressBar, Sheet, Stepper, useClearOfPolaroid, useFitScreen } from '../tb/parts';
import { STEP_UI, StepProgress, currentStep, etaText, heroState, holdSteady, stepProgress, stepViews } from '../tb/pipeline';
import { StylePicker, useRenderStyles, DEFAULT_STYLE } from '../tb/StylePicker';
import { PinDigits, Qr } from './parts';
import '../tb/HeroScreen.css';
import './class.css';

export const JOIN_PATH = '/join';

type Step = 'pin' | 'name' | 'loading' | 'hero';

/**
 * A student joining a class: the code, their first name and age, their
 * drawing, and their ONE hero. No account. Kid voice: short, playful.
 * The browser keeps a one-hero pass (api/classes.ts), so coming back shows
 * the same hero, and a second try is refused kindly.
 */
export function JoinFlow({ initialPin }: { initialPin: string }) {
  const [step, setStep] = useState<Step>(initialPin.length === 6 ? 'loading' : studentApi.hasPass() ? 'loading' : 'pin');
  const [pin, setPin] = useState(initialPin);
  const [title, setTitle] = useState('');
  const [me, setMe] = useState<GuestView | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Came back to a class this browser already made its hero in.
  const [again, setAgain] = useState(false);

  const showMe = (v: GuestView) => { setMe(v); setTitle(v.class.title); setStep('hero'); };

  const lookUp = useCallback(async (code: string) => {
    setError(null);
    setStep('loading');
    try {
      const found = await studentApi.find(code);
      setTitle(found.title);
      if (found.joined) {
        const v = await studentApi.me();
        setAgain(!!v.hero);
        showMe(v);
      } else {
        setStep('name');
      }
      window.history.replaceState(null, '', `${JOIN_PATH}/${code}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
      setPin('');
      setStep('pin');
    }
  }, []);

  useEffect(() => {
    if (initialPin.length === 6) { lookUp(initialPin); return; }
    if (studentApi.hasPass()) {
      studentApi.me().then(showMe).catch(() => setStep('pin'));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (step === 'pin') return <PinStep pin={pin} setPin={setPin} error={error} onDone={lookUp} />;
  if (step === 'name') {
    return <NameStep title={title} onBack={() => { setStep('pin'); setPin(''); }} onJoin={async (name, age) => {
      const v = await studentApi.join(pin, name, age);
      showMe(v);
    }} />;
  }
  if (step === 'hero' && me) {
    return <MyHero me={me} again={again} onChange={(v) => { setAgain(false); setMe(v); }} onNext={async () => {
      await studentApi.leave();
      setMe(null);
      setAgain(false);
      setStep('name');
    }} />;
  }
  return (
    <div className="tb-screen cls-kid-screen">
      <Header title={title || 'Join your class'} />
      <div className="tb-screen-body"><div className="cls-moment"><div className="cls-moment-art cls-wobble"><Icon name="school" /></div></div></div>
    </div>
  );
}

function KidHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <Header
      left={onBack ? <NavButton icon="back" label="Back" onClick={onBack} /> : <img className="cls-kid-logo" src="/logo-head-transparent.png" alt="HeroMaker" width={40} height={40} />}
      title={title}
    />
  );
}

function PinStep({ pin, setPin, error, onDone }: { pin: string; setPin: (p: string) => void; error: string | null; onDone: (p: string) => void }) {
  useFitScreen();
  const input = useRef<HTMLInputElement>(null);
  const press = (d: string) => setPin((pin + d).slice(0, 6));
  // A hardware keyboard types straight into the hidden field.
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
  return (
    <div className="tb-screen tb-screen--fit cls-kid-screen cls-pin-screen">
      <KidHeader title="Join your class" />
      <div className="tb-screen-body" onClick={() => input.current?.focus({ preventScroll: true })}>
        <div className="cls-kid">
          <div className="cls-kid-title">Type the class code</div>
          <div className="tb-muted">It’s on the board</div>
        </div>
        <input ref={input} className="cls-pin-input" inputMode="numeric" autoComplete="one-time-code" aria-label="Class code"
          value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => { if (e.key === 'Enter' && pin.length === 6) onDone(pin); }} />
        <PinDigits pin={pin} size="md" />
        <div className="cls-pin-error tb-bar-note" role="alert">{error}</div>
        <div className="cls-keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} type="button" className="cls-key" onClick={() => press(d)}>{d}</button>
          ))}
          <span />
          <button type="button" className="cls-key" onClick={() => press('0')}>0</button>
          <button type="button" className="cls-key cls-key--quiet" aria-label="Delete" onClick={() => setPin(pin.slice(0, -1))}><Icon name="back" /></button>
        </div>
      </div>
      <div className="tb-bar">
        <button type="button" className="tb-btn tb-btn--primary tb-btn--full cls-join" disabled={pin.length !== 6} onClick={() => onDone(pin)}>Join</button>
      </div>
    </div>
  );
}

const AGES = [4, 5, 6, 7, 8, 9, 10, 11, 12];

function NameStep({ title, onBack, onJoin }: { title: string; onBack: () => void; onJoin: (name: string, age: number | null) => Promise<void> }) {
  useFitScreen();
  const [name, setName] = useState('');
  const [age, setAge] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onJoin(name.trim(), age);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  };
  return (
    <div className="tb-screen tb-screen--fit cls-kid-screen">
      <KidHeader title={title} onBack={onBack} />
      <div className="tb-screen-body">
        <div className="cls-form">
          <div className="cls-kid">
            <div className="cls-kid-title">Hi! What’s your name?</div>
            <div className="tb-muted">Just your first name</div>
          </div>
          <input className="tb-input cls-name-input" aria-label="Your first name" value={name} maxLength={20} autoComplete="off"
            autoCapitalize="words" dir="auto" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} />
          <div className="tb-field">
            <label>How old are you?</label>
            <div className="cls-ages" role="radiogroup" aria-label="Your age">
              {AGES.map((a) => (
                <button key={a} type="button" role="radio" aria-checked={age === a} className={`cls-age${age === a ? ' cls-age--on' : ''}`}
                  onClick={() => setAge(age === a ? null : a)}>{a}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="tb-bar">
        {error && <div className="tb-bar-note" role="alert" style={{ color: 'var(--tb-red)' }}>{error}</div>}
        <button type="button" className="tb-btn tb-btn--primary tb-btn--full cls-go" disabled={!name.trim() || busy} onClick={go}>
          {busy ? 'Joining…' : 'Let’s go!'}
        </button>
      </div>
    </div>
  );
}

/** Everything after joining: waiting, drawing, making, ready, and the refusals. */
function MyHero({ me, again, onChange, onNext }: { me: GuestView; again: boolean; onChange: (v: GuestView) => void; onNext: () => void }) {
  const [creation, setCreation] = useState<CreationResponse | null>(null);
  const [parents, setParents] = useState(false);
  const [seen, setSeen] = useState(!again);

  // The pass's own state (approved yet? class over?) and the hero, polled.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const v = me.hero || me.guest.status !== 'waiting' ? me : await studentApi.me();
        if (alive && v !== me) onChange(v);
        if (v.hero) {
          const c = await api.getCreation(v.hero.creation_id);
          if (alive) setCreation(c);
        }
      } catch { /* try again on the next tick */ }
    };
    tick();
    const ready = creation && heroState(creation) === 'ready';
    if (ready) return () => { alive = false; };
    const t = window.setInterval(tick, 2500);
    return () => { alive = false; window.clearInterval(t); };
  }, [me, creation && heroState(creation)]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = me.guest.first_name;
  if (me.hero && !seen) return <AlreadyMade me={me} onSee={() => setSeen(true)} />;
  if (me.hero && creation) {
    return (
      <>
        <KidHero creation={creation} name={name} onRetry={async () => onChange(await studentApi.retry())}
          onParents={() => setParents(true)} onNext={onNext} />
        {parents && me.claim_path && <ShowParents name={name} path={me.claim_path} onClose={() => setParents(false)} />}
      </>
    );
  }
  if (me.hero) return <Moment title={`${name}’s hero`} big="Here it comes…" art={<Icon name="star" />} />;
  if (me.guest.status === 'waiting') return <Moment title={me.class.title} big="Almost!" line="Your teacher will say yes in a moment." art={<Icon name="users" />} wobble />;
  if (me.guest.status === 'blocked') return <Moment title={me.class.title} big="Ask your teacher" art={<Icon name="users" />} />;
  if (me.reason === 'ended') return <Moment title={me.class.title} big="Class time is over" line="Ask your teacher about next time." art={<Icon name="clock" />} />;
  if (me.reason === 'class_full' || me.reason === 'class_credits') return <Moment title={me.class.title} big="All the class heroes are made!" line="Ask your teacher." art={<Icon name="star" />} />;
  return <Draw me={me} onMade={onChange} />;
}

function Moment({ title, big, line, art, wobble, sun }: { title: string; big: string; line?: string; art: JSX.Element; wobble?: boolean; sun?: boolean }) {
  useFitScreen();
  return (
    <div className="tb-screen tb-screen--fit cls-kid-screen">
      <KidHeader title={title} />
      <div className="tb-screen-body">
        <div className="cls-moment">
          <div className={`cls-moment-art${sun ? ' cls-moment-art--sun' : ''}${wobble ? ' cls-wobble' : ''}`}>{art}</div>
          <div className="cls-kid-title">{big}</div>
          {line && <div className="tb-muted">{line}</div>}
        </div>
      </div>
    </div>
  );
}

function AlreadyMade({ me, onSee }: { me: GuestView; onSee: () => void }) {
  useFitScreen();
  const h = me.hero!;
  const art = `/api/files/${h.user_id}/${h.creation_id}/${h.state === 'ready' ? 'thumb_rendered.png' : 'thumb_original.jpg'}`;
  return (
    <div className="tb-screen tb-screen--fit cls-kid-screen cls-already">
      <KidHeader title={me.class.title} />
      <div className="tb-screen-body">
        <div className="cls-moment">
          <div className="cls-moment-art cls-moment-art--sun"><img src={art} alt={`${me.guest.first_name}’s hero`} /></div>
          <div className="cls-kid-title">You already made your hero!</div>
          <div className="tb-muted">One hero each. Yours is great!</div>
        </div>
      </div>
      <div className="tb-bar">
        <button type="button" className="tb-btn tb-btn--primary tb-btn--full cls-see-mine" onClick={onSee}><Icon name="star" />See my hero</button>
      </div>
    </div>
  );
}

function Draw({ me, onMade }: { me: GuestView; onMade: (v: GuestView) => void }) {
  useFitScreen();
  const styles = useRenderStyles();
  const [style, setStyle] = useState(DEFAULT_STYLE);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [webcam, setWebcam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const pick = (f: File) => {
    setFile(f);
    setError(null);
    const r = new FileReader();
    r.onload = (e) => setPreview(e.target?.result as string);
    r.readAsDataURL(f);
  };
  const make = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      onMade(await studentApi.makeHero(file, style));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  };

  return (
    <div className="tb-screen tb-screen--fit cls-kid-screen cls-draw">
      <KidHeader title={me.class.title} />
      <div className="tb-screen-body">
        <div className="cls-moment">
          <div className="cls-moment-art cls-wobble"><Icon name="camera" /></div>
          <div className="cls-kid-title">Show us your drawing, {me.guest.first_name}!</div>
          <div className="tb-muted">The whole drawing, in good light</div>
        </div>
      </div>
      <div className="tb-bar">
        <button type="button" className="tb-btn tb-btn--secondary tb-btn--full cls-choose" onClick={() => picker.current?.click()}><Icon name="image" />Choose a photo</button>
        <button type="button" className="tb-btn tb-btn--primary tb-btn--full cls-snap" onClick={() => setWebcam(true)}><Icon name="camera" />Take a photo</button>
      </div>
      <input ref={picker} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ''; }} />
      {webcam && <FileUpload showWebcamOnMount onClose={() => setWebcam(false)} onUpload={(f) => { setWebcam(false); pick(f); }} />}
      {file && (
        <Sheet title="Make this hero?" onClose={() => { if (!busy) { setFile(null); setPreview(null); } }} className="post-upload-actions-modal">
          {preview && <div className="tb-upload-preview"><img src={preview} alt="Your drawing" /></div>}
          <StylePicker styles={styles} value={style} onChange={setStyle} disabled={busy} />
          <div className="tb-stack post-upload-actions-bar">
            {error && <div className="tb-bar-note" role="alert" style={{ color: 'var(--tb-red)' }}>{error}</div>}
            <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" disabled={busy} onClick={() => { setFile(null); setPreview(null); }}>Another photo</button>
            <button type="button" className="tb-btn tb-btn--primary tb-btn--full cls-make" disabled={busy} onClick={make}>
              <Icon name="play" />{busy ? 'Starting…' : 'Make my hero'}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** The hero being made, then live: HeroScreen's layout, in the kid's words. */
function KidHero({ creation, name, onRetry, onParents, onNext }: {
  creation: CreationResponse;
  name: string;
  onRetry: () => Promise<void>;
  onParents: () => void;
  onNext: () => void;
}) {
  useFitScreen();
  const state = heroState(creation);
  const stageRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  const shown = useRef<(StepProgress & { key: string }) | null>(null);
  // The bar and the time left move every second, between polls (as HeroScreen).
  useEffect(() => {
    if (state !== 'making') return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [state]);
  const file = (f: string) => api.getFileUrl(creation.id, f, creation.user_id);
  const painted = creation.steps.find((s) => s.step_name === 'openai_render')?.status === 'completed';
  const art = painted ? file('rendered.png') : file('original.jpg');
  useClearOfPolaroid(stageRef, `${state}:${art}`);
  const step = currentStep(creation);
  const title = `${name}’s hero`;
  const now = Date.now();
  const measured = stepProgress(step, now);
  const stepKey = `${step?.step_name}:${step?.started_at}`;
  const progress = measured ? (shown.current = holdSteady(shown.current, stepKey, measured)) : null;
  const eta = progress ? etaText(progress.endsAt, now) : '';

  if (state === 'ready') {
    return (
      <div className="tb-screen tb-screen--fit tb-hero-screen cls-kid-hero" data-state="ready">
        <KidHeader title={title} />
        <HeroLive key={creation.id} creation={creation} introRequest={0} />
        <div className="tb-bar">
          <div className="cls-ready-line">{title} is ready!</div>
          <button type="button" className="tb-btn tb-btn--secondary tb-btn--full cls-next" onClick={onNext}><Icon name="users" />Next student</button>
          <button type="button" className="tb-btn tb-btn--primary tb-btn--full cls-show-parents" onClick={onParents}><Icon name="qr" />Show your parents</button>
        </div>
      </div>
    );
  }
  const failed = state === 'failed';
  const label = failed ? 'Oops, that didn’t work' : step ? STEP_UI[step.step_name]?.label ?? 'Making' : 'Getting ready';
  return (
    <div className="tb-screen tb-screen--fit tb-hero-screen cls-kid-hero" data-state={state}>
      <KidHeader title={title} />
      <div className="tb-screen-body">
        <div ref={stageRef} className="tb-stage tb-hero-stage">
          <img className={`tb-stage-img${failed ? ' tb-hero-faded' : ''}`} src={art} alt={title} />
          {!failed && (painted ? <div className="tb-shimmer" /> : <div className="tb-scanline" />)}
          {painted && <Polaroid src={file('thumb_original.jpg')} artist={creation.name} age={creation.age} />}
        </div>
        <div className={failed ? 'tb-failed' : 'tb-making'} data-step={step?.step_name}>
          <Stepper steps={stepViews(creation)} />
          <div className="tb-status">
            <div className={`tb-status-name${failed ? ' tb-status-name--failed' : ''}`}>{label}</div>
            <div className="tb-status-eta">{failed ? '' : eta}</div>
          </div>
          {!failed && (
            <ProgressBar
              key={stepKey}
              pct={progress?.pct ?? 0}
              showPct={progress?.real}
              label={label}
              valueText={progress ? `${Math.floor(progress.pct)}%${eta ? `, ${eta}` : ''}` : undefined}
            />
          )}
        </div>
      </div>
      <div className="tb-bar">
        {failed ? (
          <button type="button" className="tb-btn tb-btn--primary tb-btn--full" disabled={busy}
            onClick={async () => { setBusy(true); try { await onRetry(); } finally { setBusy(false); } }}>
            <Icon name="redo" />Try again
          </button>
        ) : (
          <>
            <div className="tb-bar-note">Your hero is on its way!</div>
            <button type="button" className="tb-btn tb-btn--secondary tb-btn--full cls-show-parents" onClick={onParents}><Icon name="qr" />Show your parents</button>
          </>
        )}
      </div>
    </div>
  );
}

function ShowParents({ name, path, onClose }: { name: string; path: string; onClose: () => void }) {
  const url = `${window.location.origin}${path}`;
  const [copied, setCopied] = useState(false);
  const send = async () => {
    try {
      if (navigator.share) { await navigator.share({ title: `${name}’s hero`, url }); return; }
    } catch { /* fall back to copying */ }
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { window.prompt('Copy the link', url); }
  };
  return (
    <Sheet title="Show your parents" onClose={onClose} className="cls-parents-sheet">
      <div className="cls-parents">
        <div className="cls-qr-frame"><Qr text={url} size={220} label={`Scan to keep ${name}’s hero`} /></div>
        <div className="tb-muted">Grown-ups: scan to keep {name}’s hero</div>
      </div>
      <div className="tb-stack cls-sheet-bar">
        <button type="button" className="tb-btn tb-btn--secondary tb-btn--full cls-send-link" onClick={send}><Icon name={copied ? 'check' : 'share'} />{copied ? 'Link copied' : 'Send the link'}</button>
        <button type="button" className="tb-btn tb-btn--primary tb-btn--full" onClick={onClose}>Done</button>
      </div>
    </Sheet>
  );
}
