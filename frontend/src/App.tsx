import { useState, useEffect, useRef } from 'react';
import { FileUpload } from './components/FileUpload';
import { HeaderAuth } from './components/HeaderAuth';
import { PURCHASE_RETURN_PARAM } from './components/BuyCredits';
import { PipelineProgress } from './components/PipelineProgress';
import { HeroNameEditor } from './components/HeroNameEditor';
import { AdminPanel } from './components/AdminPanel';
import { ResetPassword, RESET_PASSWORD_PATH } from './components/ResetPassword';
import { Gallery } from './components/tb/Gallery';
import { HeroScreen } from './components/tb/HeroScreen';
import { MakingOf } from './components/tb/MakingOf';
import { Icon } from './components/tb/Icon';
import { Header, NavButton, Sheet } from './components/tb/parts';
import { useCreationPolling } from './hooks/useCreationPolling';
import { api, CreationResponse, ApiError, getAuthToken } from './api/client';
import { loadStepConfig, getTotalCost } from './config/steps';
import './styles/toybox.css';
import './App.css';

type View = 'gallery' | 'hero' | 'steps' | 'making' | 'admin' | 'reset';

// The only URL the app routes on: the link in a "Forgot password?" email.
const isResetUrl = () => window.location.pathname === RESET_PASSWORD_PATH;

function App() {
  const [view, setView] = useState<View>(isResetUrl() ? 'reset' : 'gallery');
  const [resetToken] = useState(() => (isResetUrl() ? new URLSearchParams(window.location.search).get('token') ?? '' : ''));
  const [creation, setCreation] = useState<CreationResponse | null>(null);
  const [uploadedFilePreview, setUploadedFilePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNewHero, setShowNewHero] = useState(false);
  const [showWebcamModal, setShowWebcamModal] = useState(false);
  const [showPostUploadActions, setShowPostUploadActions] = useState(false);
  const [pipelineCost, setPipelineCost] = useState<number>(0);
  const [creditBalance, setCreditBalance] = useState<number | undefined>(undefined);
  const [userInfo, setUserInfo] = useState<{ id: string; is_admin: boolean } | null>(null);
  const [galleryKey, setGalleryKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isLoggedIn = creditBalance !== undefined;

  useEffect(() => {
    loadStepConfig()
      .then(() => setPipelineCost(getTotalCost()))
      .catch(console.error);
  }, []);

  const refreshCreditBalance = async () => {
    const token = getAuthToken();
    if (!token) {
      setCreditBalance(undefined);
      setUserInfo(null);
      return;
    }
    try {
      const user = await api.getMe();
      setCreditBalance(user.credits);
      setUserInfo({ id: user.id, is_admin: user.is_admin });
      window.dispatchEvent(new CustomEvent('auth:credits-updated', { detail: { credits: user.credits } }));
    } catch {
      setCreditBalance(undefined);
      setUserInfo(null);
    }
  };

  useEffect(() => {
    refreshCreditBalance();
    const handleAuthChange = () => refreshCreditBalance();
    const handleUnauthorized = () => setCreditBalance(undefined);
    window.addEventListener('auth:login', handleAuthChange);
    window.addEventListener('auth:logout', handleAuthChange);
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('auth:login', handleAuthChange);
      window.removeEventListener('auth:logout', handleAuthChange);
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, []);

  // Back from a Lemon Squeezy checkout. The browser never reports a payment:
  // the signed webhook grants the credits, usually within a second or two, so
  // all this does is re-read the balance until it moves (or give up quietly).
  const [purchaseNotice, setPurchaseNotice] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get(PURCHASE_RETURN_PARAM) !== 'done') return;
    params.delete(PURCHASE_RETURN_PARAM);
    const query = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));

    if (!getAuthToken()) return;
    setPurchaseNotice('Thanks! Adding your credits…');
    let cancelled = false;
    (async () => {
      let start: number | undefined;
      for (let attempt = 0; attempt < 15 && !cancelled; attempt++) {
        try {
          const me = await api.getMe();
          if (start === undefined) start = me.credits;
          if (me.credits !== start) break;
        } catch {
          break;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (cancelled) return;
      await refreshCreditBalance();
      setPurchaseNotice('Thanks! Your credits are in.');
      setTimeout(() => setPurchaseNotice(null), 6000);
    })();
    return () => { cancelled = true; };
  }, []);

  const goHome = () => {
    if (isResetUrl()) window.history.replaceState(null, '', '/');
    setView('gallery');
    setCreation(null);
    setError(null);
    setGalleryKey((k) => k + 1);
    window.scrollTo({ top: 0 });
  };

  const openHero = (c: CreationResponse) => {
    setCreation(c);
    setError(null);
    setView('hero');
    window.scrollTo({ top: 0 });
  };

  // A hero is made by people with an account: signed out, this opens sign-up.
  const startNewHero = () => {
    if (!isLoggedIn) {
      window.dispatchEvent(new CustomEvent('auth:open', { detail: { mode: 'signup' } }));
      return;
    }
    setShowNewHero(true);
  };

  const handleUpload = async (file: File, characterName?: string) => {
    setShowNewHero(false);
    setIsUploading(true);
    setError(null);
    try {
      const reader = new FileReader();
      reader.onload = (e) => setUploadedFilePreview(e.target?.result as string);
      reader.readAsDataURL(file);
      const newCreation = await api.createCreation(file, characterName);
      setCreation(newCreation);
      setShowPostUploadActions(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to upload image');
      setUploadedFilePreview(null);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const cancelUpload = () => {
    setShowPostUploadActions(false);
    setCreation(null);
    setUploadedFilePreview(null);
  };

  const handleStartPipeline = async () => {
    if (!creation) return;
    setIsStarting(true);
    setError(null);
    try {
      await api.runPipeline(creation.id);
      window.dispatchEvent(new CustomEvent('creation:refresh-now', { detail: { creationId: creation.id } }));
      await refreshCreditBalance();
      setShowPostUploadActions(false);
      setUploadedFilePreview(null);
      const fresh = await api.getCreation(creation.id).catch(() => creation);
      openHero(fresh);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start pipeline');
      await refreshCreditBalance();
    } finally {
      setIsStarting(false);
    }
  };

  const refreshCreation = async () => {
    if (!creation) return;
    try {
      setCreation(await api.getCreation(creation.id));
    } catch (err) {
      console.error('[App] Failed to refresh creation:', err);
    }
  };

  const hasProcessingStep = creation?.steps.some((s) => s.status === 'processing');
  const shouldPoll = view !== 'gallery' && creation && (hasProcessingStep || creation.status === 'pending');
  useCreationPolling(shouldPoll ? creation.id : null, (updated) => setCreation(updated));

  const short = creditBalance !== undefined && pipelineCost > creditBalance;
  const notices = (
    <>
      {purchaseNotice && <div className="tb-notice app-purchase-notice" role="status"><Icon name="coin" />{purchaseNotice}</div>}
      {error && (
        <div className="tb-notice tb-notice--error app-error" role="alert">
          {error}
          <button type="button" className="tb-link" onClick={() => setError(null)}>OK</button>
        </div>
      )}
    </>
  );

  let screen;
  if (view === 'reset') {
    screen = <ResetPassword token={resetToken} onDone={goHome} onCancel={goHome} />;
  } else if (view === 'admin' && userInfo) {
    screen = (
      <div className="tb-screen tb-screen--wide">
        <Header left={<NavButton icon="back" label="Back" onClick={goHome} />} title="Admin" />
        <div className="tb-screen-body"><AdminPanel onClose={goHome} currentUserId={userInfo.id} /></div>
      </div>
    );
  } else if (view === 'making' && creation) {
    screen = <MakingOf creation={creation} onBack={() => setView('hero')} />;
  } else if (view === 'steps' && creation) {
    screen = (
      <div className="tb-screen tb-screen--wide">
        <Header left={<NavButton icon="back" label="Back to hero" onClick={() => setView('hero')} />} title="Every step" />
        <div className="tb-screen-body app-pipeline-section">
          <HeroNameEditor
            creationId={creation.id}
            characterName={creation.character_name}
            name={creation.name}
            age={creation.age}
            isAdmin={userInfo?.is_admin ?? false}
            isLoggedIn={isLoggedIn}
            onCharacterNameUpdated={(v) => setCreation({ ...creation, character_name: v })}
            onNameUpdated={(v) => setCreation({ ...creation, name: v })}
            onAgeUpdated={(v) => setCreation({ ...creation, age: v })}
          />
          <PipelineProgress
            creation={creation}
            creditBalance={creditBalance}
            isLoggedIn={isLoggedIn}
            currentUserId={userInfo?.id}
            isAdmin={userInfo?.is_admin ?? false}
            onStepRun={() => refreshCreditBalance()}
            onCreationRefresh={refreshCreation}
            onDelete={goHome}
          />
        </div>
      </div>
    );
  } else if (view === 'hero' && creation) {
    screen = (
      <HeroScreen
        creation={creation}
        isLoggedIn={isLoggedIn}
        currentUserId={userInfo?.id}
        isAdmin={userInfo?.is_admin ?? false}
        creditBalance={creditBalance}
        onBack={goHome}
        onRefresh={refreshCreation}
        onDeleted={goHome}
        onShowSteps={() => setView('steps')}
        onShowMaking={() => setView('making')}
        onMakeOwn={startNewHero}
        onCreditsChanged={refreshCreditBalance}
      />
    );
  } else {
    screen = (
      <div className="tb-screen tb-screen--wide">
        <Header
          left={(
            <button type="button" className="tb-logo app-header-center" onClick={goHome} aria-label="HeroMaker home">
              <img src="/logo-head-transparent.png" alt="" />
              <span>HeroMaker</span>
            </button>
          )}
          right={<HeaderAuth onOpenAdmin={() => setView('admin')} />}
        />
        {notices}
        <div className="tb-screen-body">
          {!isLoggedIn && (
            <section className="tb-intro">
              <h2 className="tb-intro-title">Draw it.<br />We make it a real hero.</h2>
              <p className="tb-muted">Snap a photo of any drawing. In a few minutes it is a 3D hero that moves, and your kid can play with it.</p>
            </section>
          )}
          <Gallery key={galleryKey} isLoggedIn={isLoggedIn} isAdmin={userInfo?.is_admin ?? false} onSelect={openHero} />
          <footer className="tb-footer">Made by Raz Karl &amp; Elad Shikley</footer>
        </div>
        <div className="tb-bar">
          <button type="button" className="tb-btn tb-btn--primary tb-btn--full tb-new-hero" disabled={isUploading} onClick={startNewHero}>
            <Icon name="camera" />{isUploading ? 'Uploading…' : 'Make a hero'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {screen}
      {/* Off the gallery the account controls are hidden, but its dialogs
          (buy credits, sign-in) must stay mounted for any screen to open. */}
      {view !== 'gallery' && <HeaderAuth controls={false} />}
      {view !== 'gallery' && notices}

      {/* Always mounted, so "Photos" can open it from the sheet. */}
      <div className="header-upload-buttons" hidden>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
        />
      </div>

      {showNewHero && (
        <Sheet title="New hero" onClose={() => setShowNewHero(false)}>
          <div className="tb-muted tb-new-hero-tip">Whole character in frame · good light</div>
          <div className="tb-stack">
            <button type="button" className="tb-btn tb-btn--primary tb-btn--full" onClick={() => { setShowNewHero(false); setShowWebcamModal(true); }}>
              <Icon name="camera" />Take a photo
            </button>
            <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={() => fileInputRef.current?.click()}>
              <Icon name="image" />Choose from photos
            </button>
          </div>
        </Sheet>
      )}

      {showWebcamModal && (
        <FileUpload
          onUpload={(file, characterName) => {
            handleUpload(file, characterName);
            setShowWebcamModal(false);
          }}
          disabled={isUploading}
          showWebcamOnMount={true}
          onClose={() => setShowWebcamModal(false)}
          creditBalance={creditBalance}
          creationCost={pipelineCost}
        />
      )}

      {showPostUploadActions && creation && (
        <Sheet title="Make this hero?" onClose={() => { if (!isStarting) cancelUpload(); }} className="post-upload-actions-modal">
          {uploadedFilePreview && (
            <div className="tb-upload-preview">
              <img src={uploadedFilePreview} alt="Your drawing" />
            </div>
          )}
          <div className="tb-stack" style={{ paddingTop: 8 }}>
            {short && <div className="tb-bar-note post-upload-actions-error">You need {pipelineCost} credits. You have {creditBalance}.</div>}
            {short ? (
              <button type="button" className="tb-btn tb-btn--primary tb-btn--full" onClick={() => window.dispatchEvent(new CustomEvent('credits:buy'))}>
                <Icon name="coin" />Buy credits
              </button>
            ) : (
              <button type="button" className="tb-btn tb-btn--primary tb-btn--full tb-btn--with-trail post-upload-action-primary" disabled={isStarting} onClick={handleStartPipeline}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="play" />{isStarting ? 'Starting…' : 'Make my hero'}</span>
                {pipelineCost > 0 && <span className="tb-btn-trail"><Icon name="coin" size={18} />{pipelineCost} credits</span>}
              </button>
            )}
            <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" disabled={isStarting} onClick={cancelUpload}>Cancel</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

export default App;
