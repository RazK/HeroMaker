import { useState, useEffect, useRef } from 'react';
import { FileUpload } from './components/FileUpload';
import { HeaderAuth } from './components/HeaderAuth';
import { PURCHASE_RETURN_PARAM } from './components/BuyCredits';
import { PipelineProgress } from './components/PipelineProgress';
import { HeroNameEditor } from './components/HeroNameEditor';
import { AdminPanel } from './components/AdminPanel';
import { ResetPassword, RESET_PASSWORD_PATH } from './components/ResetPassword';
import { Privacy, PRIVACY_PATH } from './components/tb/Privacy';
import { Gallery, Filter, forgetGallery, galleryTabs, rememberTab, rememberedTab, resetGalleryScroll } from './components/tb/Gallery';
import { MyClasses, NewClassFlow, hasLiveClass, useMyClasses } from './components/class/MyClasses';
import { ClassScreen } from './components/class/ClassScreen';
import { CLASS_PAID_PARAM } from './api/classes';
import { JoinFlow, JOIN_PATH } from './components/class/JoinFlow';
import { ClaimScreen, CLAIM_PATH } from './components/class/ClaimScreen';
import { HeroScreen } from './components/tb/HeroScreen';
import { Icon } from './components/tb/Icon';
import { Header, NavButton, NoPageScroll, Sheet } from './components/tb/parts';
import { StylePicker, useRenderStyles, DEFAULT_STYLE } from './components/tb/StylePicker';
import { useCreationPolling } from './hooks/useCreationPolling';
import { api, CreationResponse, ApiError, getAuthToken } from './api/client';
import { loadStepConfig, getTotalCost } from './config/steps';
import './styles/toybox.css';
import './App.css';

type View = 'gallery' | 'hero' | 'steps' | 'admin' | 'reset' | 'privacy' | 'class' | 'claim';

// The only URL the app routes on: the link in a "Forgot password?" email.
const isResetUrl = () => window.location.pathname === RESET_PASSWORD_PATH;

// A student joining a class (/join, /join/123456): no account, nothing else of the app.
const joinPin = (): string | null => {
  const p = window.location.pathname;
  if (p !== JOIN_PATH && !p.startsWith(`${JOIN_PATH}/`)) return null;
  return p.slice(JOIN_PATH.length + 1).replace(/\D/g, '').slice(0, 6);
};
// A parent keeping a child's class hero (/claim/<token>).
const claimToken = (): string | null => {
  const p = window.location.pathname;
  return p.startsWith(CLAIM_PATH) ? decodeURIComponent(p.slice(CLAIM_PATH.length)) : null;
};

// The class a teacher comes back to from a seat checkout (?class_paid=<id>).
const CLASS_PAID_ON_LOAD = new URLSearchParams(window.location.search).get(CLASS_PAID_PARAM);

function App() {
  const pin = joinPin();
  if (pin !== null) return <div className="app"><JoinFlow initialPin={pin} /></div>;
  return <MainApp />;
}

function MainApp() {
  const [view, setView] = useState<View>(isResetUrl() ? 'reset' : CLASS_PAID_ON_LOAD ? 'class' : window.location.pathname === PRIVACY_PATH ? 'privacy' : claimToken() ? 'claim' : 'gallery');
  const [claim] = useState(claimToken);
  // Back from paying for a class's seats (?class_paid=<id>): open that class,
  // which watches its seats arrive by webhook. Read once per page load.
  const [classPaid] = useState(CLASS_PAID_ON_LOAD);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has(CLASS_PAID_PARAM)) return;
    params.delete(CLASS_PAID_PARAM);
    const query = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
  }, []);
  const [classId, setClassId] = useState<string | null>(classPaid);
  // Where Back from a hero goes: the gallery, or the class it was opened from.
  const [heroFrom, setHeroFrom] = useState<'gallery' | 'class' | 'admin'>('gallery');
  // The gallery's tab: the one last chosen, or My classes for a teacher back
  // from paying for a class. Chosen once (a tap, or a flow that leads to a
  // tab), it is never changed under the viewer's feet.
  const [tab, setTabState] = useState<Filter>(() => (CLASS_PAID_ON_LOAD ? 'classes' : rememberedTab()));
  const tabChosen = useRef(!!CLASS_PAID_ON_LOAD);
  const setTab = (t: Filter) => { tabChosen.current = true; rememberTab(t); setTabState(t); };
  // New class (asks for the school first, once), or the school alone.
  const [classSheet, setClassSheet] = useState<'new' | 'school' | null>(null);
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
  const [userInfo, setUserInfo] = useState<{ id: string; is_admin: boolean; is_teacher: boolean } | null>(null);
  const [galleryKey, setGalleryKey] = useState(0);
  const renderStyles = useRenderStyles();
  const [renderStyle, setRenderStyle] = useState<string>(DEFAULT_STYLE);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Guards that hold across a double tap, which React state cannot: two taps
  // land before the re-render that disables the button.
  const uploadingRef = useRef(false);
  const startingRef = useRef(false);
  // The hero made from the photo just picked, until "Make my hero" starts it.
  // Picking a photo creates the hero right away, so leaving without starting it
  // (Cancel, tapping outside, picking another photo) must remove it again, or
  // it sits in "My heroes" as "Not started" for good.
  const unstartedRef = useRef<string | null>(null);
  const isLoggedIn = creditBalance !== undefined;
  // Who is looking is known: signed out, or the account read. Until then a
  // remembered tab is not judged (My heroes is not dropped while signing in).
  const [authChecked, setAuthChecked] = useState(() => !getAuthToken());

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
      setAuthChecked(true);
      return;
    }
    try {
      const user = await api.getMe();
      setCreditBalance(user.credits);
      setUserInfo({ id: user.id, is_admin: user.is_admin, is_teacher: !!user.is_teacher });
      window.dispatchEvent(new CustomEvent('auth:credits-updated', { detail: { credits: user.credits } }));
    } catch {
      setCreditBalance(undefined);
      setUserInfo(null);
    }
    setAuthChecked(true);
  };

  // Shown on the signed-out gallery right after the account is deleted.
  const [accountNotice, setAccountNotice] = useState<string | null>(null);

  useEffect(() => {
    refreshCreditBalance();
    const handleAuthChange = () => refreshCreditBalance();
    const handleUnauthorized = () => setCreditBalance(undefined);
    let noticeTimer: number | undefined;
    const handleAccountDeleted = () => {
      setView('gallery');
      setCreation(null);
      setError(null);
      forgetGallery();
      setTabState('featured');
      setGalleryKey((k) => k + 1);
      window.scrollTo({ top: 0 });
      setAccountNotice('Account deleted');
      window.clearTimeout(noticeTimer);
      noticeTimer = window.setTimeout(() => setAccountNotice(null), 6000);
    };
    window.addEventListener('auth:login', handleAuthChange);
    window.addEventListener('auth:logout', handleAuthChange);
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    window.addEventListener('auth:account-deleted', handleAccountDeleted);
    // Anything that changes the balance outside App (a redeemed coupon) says
    // so; and coming back to the tab (from checkout, or another device's
    // purchase) re-reads it, so the app never acts on a stale balance.
    // ('auth:credits-updated' is App's own broadcast, so it is not listened to
    // here: that would loop.)
    const handleCreditsChanged = () => refreshCreditBalance();
    const handleVisible = () => { if (document.visibilityState === 'visible') refreshCreditBalance(); };
    window.addEventListener('credits:changed', handleCreditsChanged);
    document.addEventListener('visibilitychange', handleVisible);
    return () => {
      window.removeEventListener('credits:changed', handleCreditsChanged);
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('auth:login', handleAuthChange);
      window.removeEventListener('auth:logout', handleAuthChange);
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
      window.removeEventListener('auth:account-deleted', handleAccountDeleted);
      window.clearTimeout(noticeTimer);
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

  // Back to the gallery. From another screen it comes back as it was left
  // (Gallery remembers its list and scroll, and refreshes behind the scenes);
  // the logo on the gallery itself starts it over from the top.
  const goHome = () => {
    if (view === 'gallery') resetGalleryScroll();
    if (isResetUrl() || window.location.pathname === PRIVACY_PATH || claimToken()) window.history.replaceState(null, '', '/');
    setView('gallery');
    setCreation(null);
    setError(null);
    setGalleryKey((k) => k + 1);
    window.scrollTo({ top: 0 });
  };

  const openHero = (c: CreationResponse, from: 'gallery' | 'class' | 'admin' = 'gallery') => {
    setHeroFrom(from);
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

  const discardUnstarted = () => {
    const id = unstartedRef.current;
    unstartedRef.current = null;
    if (id) api.deleteCreation(id).catch((err) => console.error('[App] Failed to remove unstarted hero:', err));
  };

  const handleUpload = async (file: File, characterName?: string) => {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    setShowNewHero(false);
    setIsUploading(true);
    setError(null);
    discardUnstarted();
    try {
      const reader = new FileReader();
      reader.onload = (e) => setUploadedFilePreview(e.target?.result as string);
      reader.readAsDataURL(file);
      const newCreation = await api.createCreation(file, characterName);
      unstartedRef.current = newCreation.id;
      setCreation(newCreation);
      setRenderStyle(DEFAULT_STYLE);
      setShowPostUploadActions(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to upload image');
      setUploadedFilePreview(null);
    } finally {
      uploadingRef.current = false;
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const cancelUpload = () => {
    discardUnstarted();
    setShowPostUploadActions(false);
    setCreation(null);
    setUploadedFilePreview(null);
  };

  const handleStartPipeline = async () => {
    if (!creation || startingRef.current) return;
    startingRef.current = true;
    setIsStarting(true);
    setError(null);
    try {
      await api.runPipeline(creation.id, undefined, renderStyle);
      unstartedRef.current = null;
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
      startingRef.current = false;
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

  // A teacher's classes: read when they sign in, kept fresh while My classes shows.
  const myClasses = useMyClasses(!!userInfo?.is_teacher, view === 'gallery' && tab === 'classes');
  // A class running right now opens My classes, once per visit, unless the
  // teacher already picked a tab: mid-lesson, that is what they came for.
  const liveChecked = useRef(false);
  useEffect(() => {
    if (liveChecked.current || !myClasses.classes) return;
    liveChecked.current = true;
    if (!tabChosen.current && hasLiveClass(myClasses.classes)) setTabState('classes');
  }, [myClasses.classes]);

  const hasProcessingStep = creation?.steps.some((s) => s.status === 'processing');
  const shouldPoll = view !== 'gallery' && creation && (hasProcessingStep || creation.status === 'pending');
  useCreationPolling(shouldPoll ? creation.id : null, (updated) => setCreation(updated));

  const short = creditBalance !== undefined && pipelineCost > creditBalance;
  const notices = (
    <>
      {purchaseNotice && <div className="tb-notice app-purchase-notice" role="status"><Icon name="coin" />{purchaseNotice}</div>}
      {accountNotice && (
        <div className="tb-notice app-account-notice" role="status">
          <Icon name="check" />{accountNotice}
          <button type="button" className="tb-link" onClick={() => setAccountNotice(null)}>OK</button>
        </div>
      )}
      {error && (
        <div className="tb-notice tb-notice--error app-error" role="alert">
          {error}
          <button type="button" className="tb-link" onClick={() => setError(null)}>OK</button>
        </div>
      )}
    </>
  );

  const openClass = (id: string) => {
    setClassId(id);
    setView('class');
    window.scrollTo({ top: 0 });
  };
  const backFromHero = () => {
    if (heroFrom === 'class' && classId) { setCreation(null); setView('class'); return; }
    // Opened from a user's page in the admin console: back to that page.
    if (heroFrom === 'admin' && userInfo?.is_admin) { setCreation(null); setView('admin'); return; }
    goHome();
  };
  const appHeader = (
    <Header
      left={(
        <button type="button" className="tb-logo app-header-center" onClick={goHome} aria-label="HeroMaker home">
          <img src="/logo-head-transparent.png" alt="" />
          <span>HeroMaker</span>
        </button>
      )}
      right={<HeaderAuth onOpenAdmin={() => setView('admin')} onRunClass={() => setTab('classes')} />}
    />
  );
  const footer = (extra?: JSX.Element) => (
    <footer className="tb-footer">
      {extra}
      <div>Made by Raz Karl &amp; Elad Shikley</div>
      <div><a href={PRIVACY_PATH} onClick={(e) => { e.preventDefault(); window.history.pushState(null, "", PRIVACY_PATH); setView("privacy"); }}>Privacy</a> · <span className="tb-version">{__APP_VERSION__}</span></div>
    </footer>
  );
  // The gallery's tabs. A teacher's classes are one of them (My classes), so
  // classes and the public gallery are one tap apart, under the same header.
  const isTeacher = !!userInfo?.is_teacher;
  const tabs = galleryTabs({ isLoggedIn, isAdmin: userInfo?.is_admin ?? false, isTeacher });
  const shownTab: Filter = !authChecked || tabs.includes(tab) ? tab : 'featured';
  const onClassesTab = shownTab === 'classes';
  const stopClasses = async () => {
    try {
      await api.updateProfile({ is_teacher: false });
    } catch {
      setError('Could not save that. Try again.');
      return;
    }
    setTab('featured');
    await refreshCreditBalance();
  };

  let screen;
  if (view === 'claim' && claim) {
    screen = (
      <ClaimScreen
        token={claim}
        onHome={goHome}
        onSeeHeroes={() => { setTab('mine'); goHome(); }}
        // The kept hero on its own page; Back from it lands on My heroes.
        onOpenHero={(id) => api.getCreation(id).then((c) => {
          window.history.replaceState(null, '', '/');
          setTab('mine');
          openHero(c);
        }).catch(() => setError('Could not open that hero'))}
      />
    );
  } else if (view === 'class' && classId && userInfo) {
    screen = (
      <ClassScreen
        classId={classId}
        credits={creditBalance}
        paid={classPaid === classId}
        onBack={goHome}
        onOpenHero={(id) => api.getCreation(id).then((c) => openHero(c, 'class')).catch(() => setError('Could not open that hero'))}
      />
    );
  } else if (view === 'privacy') {
    screen = <Privacy onBack={goHome} />;
  } else if (view === 'reset') {
    screen = <ResetPassword token={resetToken} onDone={goHome} onCancel={goHome} />;
  } else if (view === 'admin' && userInfo) {
    screen = <AdminPanel onClose={goHome} currentUserId={userInfo.id} onOpenHero={(c) => openHero(c, 'admin')} />;
  } else if (view === 'steps' && creation && userInfo?.is_admin) {
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
        onBack={backFromHero}
        onRefresh={refreshCreation}
        onDeleted={backFromHero}
        onShowSteps={() => setView('steps')}
        onMakeOwn={startNewHero}
        onCreditsChanged={refreshCreditBalance}
        fromClass={heroFrom === 'class'}
      />
    );
  } else {
    screen = (
      <div className="tb-screen tb-screen--wide tb-screen--app">
        <NoPageScroll />
        {appHeader}
        {notices}
        <div className="tb-screen-body">
          {!isLoggedIn && (
            <section className="tb-intro">
              <h2 className="tb-intro-title">Draw it.<br />We make it a real hero.</h2>
              <p className="tb-muted">Snap a photo of any drawing. In a few minutes it is a 3D hero that moves, and your kid can play with it.</p>
            </section>
          )}
          <Gallery
            key={galleryKey}
            filter={shownTab}
            tabs={tabs}
            onFilter={setTab}
            isAdmin={userInfo?.is_admin ?? false}
            userId={userInfo?.id}
            onSelect={(c) => openHero(c)}
            classes={onClassesTab ? {
              ready: !!myClasses.classes,
              content: <MyClasses data={myClasses} onOpen={(c) => openClass(c.id)} onEditSchool={() => setClassSheet('school')} onStop={stopClasses} />,
            } : undefined}
          />
          {footer()}
        </div>
        <div className="tb-bar">
          {onClassesTab ? (
            // A class running now has the screen's grape action (Open class), so New class steps back.
            <button type="button" className={`tb-btn tb-btn--${hasLiveClass(myClasses.classes) ? 'secondary' : 'primary'} tb-btn--full cls-new-class`}
              onClick={() => setClassSheet('new')}>
              <Icon name="plus" />New class
            </button>
          ) : (
            <button type="button" className="tb-btn tb-btn--primary tb-btn--full tb-new-hero" disabled={isUploading} onClick={startNewHero}>
              <Icon name="camera" />{isUploading ? 'Uploading…' : 'Make a hero'}
            </button>
          )}
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
      {view !== 'gallery' && <div className="tb-toasts">{notices}</div>}

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

      {classSheet && view === 'gallery' && (
        <NewClassFlow
          mode={classSheet}
          data={myClasses}
          credits={creditBalance}
          onClose={() => setClassSheet(null)}
          onCreated={(c) => { setClassSheet(null); openClass(c.id); }}
        />
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
          <StylePicker styles={renderStyles} value={renderStyle} onChange={setRenderStyle} disabled={isStarting} />
          {/* Helper line, secondary, primary LAST: the brand book's bar order. */}
          <div className="tb-stack post-upload-actions-bar">
            {short && <div className="tb-bar-note post-upload-actions-error">You need {pipelineCost} credits. You have {creditBalance}.</div>}
            <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" disabled={isStarting} onClick={cancelUpload}>Cancel</button>
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
          </div>
        </Sheet>
      )}
    </div>
  );
}

export default App;
