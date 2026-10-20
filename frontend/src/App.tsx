import { useState, useEffect, useRef } from 'react';
import { FileUpload } from './components/FileUpload';
import { HeaderAuth } from './components/HeaderAuth';
import { PURCHASE_RETURN_PARAM } from './components/BuyCredits';
import { PipelineProgress } from './components/PipelineProgress';
import { HeroNameEditor } from './components/HeroNameEditor';
import { AdminPanel } from './components/AdminPanel';
import { ResetPassword, RESET_PASSWORD_PATH } from './components/ResetPassword';
import { Privacy } from './components/tb/Privacy';
import { Terms } from './components/tb/Terms';
import { Refunds } from './components/tb/Refunds';
import { LEGAL_OPEN_EVENT, LEGAL_PATHS, LegalPage, legalPageAt, openLegal } from './components/tb/Legal';
import { Gallery, Filter, Section, forgetGallery, galleryTabs, hadSwitch, rememberSection, rememberTab, rememberedSection, rememberedTab, resetGalleryScroll } from './components/tb/Gallery';
import { Segmented } from './components/tb/Segmented';
import { LiveStrip, MyClasses, NewClassFlow, hasLiveClass, useMyClasses } from './components/class/MyClasses';
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
import { ADMIN_PATH, CLASS_PATH, HeroFrom, adminPath, classPath, goUp, heroFrom, heroPath, navigate, overlayDepth, prevPath, replaceRoute, routeAt, stepsPath } from './routes';
import './styles/toybox.css';
import './App.css';

type View = 'gallery' | 'hero' | 'steps' | 'admin' | 'reset' | LegalPage | 'class' | 'claim';

// The link in a "Forgot password?" email.
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

// "Run a class" while signed out: remembered across the sign-up, so the new
// account lands on My classes with group mode on. This tab only.
const CLASSES_INTENT = 'heromaker.intent.classes';
const intendsClasses = () => { try { return sessionStorage.getItem(CLASSES_INTENT) === '1'; } catch { return false; } };
const setClassesIntent = (on: boolean) => { try { if (on) sessionStorage.setItem(CLASSES_INTENT, '1'); else sessionStorage.removeItem(CLASSES_INTENT); } catch { /* fine */ } };

// The class a teacher comes back to from a seat checkout (?class_paid=<id>).
const CLASS_PAID_ON_LOAD = new URLSearchParams(window.location.search).get(CLASS_PAID_PARAM);
// The screen this address is (routes.ts): a hero, a class, the admin console.
const ROUTE_ON_LOAD = routeAt(window.location.pathname);

function App() {
  const pin = joinPin();
  if (pin !== null) return <div className="app"><JoinFlow initialPin={pin} /></div>;
  return <MainApp />;
}

function MainApp() {
  const [view, setView] = useState<View>(isResetUrl() ? 'reset' : CLASS_PAID_ON_LOAD ? 'class' : legalPageAt(window.location.pathname) ?? (claimToken() ? 'claim' : ROUTE_ON_LOAD?.view ?? 'gallery'));
  const [claim] = useState(claimToken);
  // The path the screen shown is drawn for. A popstate to the same path is an
  // overlay's (a sheet closing), not a change of screen.
  const shownPath = useRef(window.location.pathname);
  const go = (path: string, extra?: { from?: HeroFrom }) => { navigate(path, extra); shownPath.current = path; };
  // A legal page, on its own URL, opened from the footer or a sheet.
  useEffect(() => {
    const open = (e: Event) => {
      const page = (e as CustomEvent<LegalPage>).detail;
      if (!(page in LEGAL_PATHS)) return;
      go(LEGAL_PATHS[page]);
      setView(page);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener(LEGAL_OPEN_EVENT, open);
    return () => window.removeEventListener(LEGAL_OPEN_EVENT, open);
  }, []);
  // Back from paying for a class's seats (?class_paid=<id>): open that class,
  // which watches its seats arrive by webhook. Read once per page load.
  const [classPaid] = useState(CLASS_PAID_ON_LOAD);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has(CLASS_PAID_PARAM)) return;
    params.delete(CLASS_PAID_PARAM);
    const query = params.toString();
    const path = classPaid ? classPath(classPaid) : window.location.pathname;
    replaceRoute(path + (query ? `?${query}` : ''));
    shownPath.current = path;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [classId, setClassId] = useState<string | null>(classPaid ?? (ROUTE_ON_LOAD?.view === 'class' ? ROUTE_ON_LOAD.id : null));
  // The user page open in the admin console (/admin/users/<id>), or the list.
  const [adminUser, setAdminUser] = useState<string | null>(ROUTE_ON_LOAD?.view === 'admin' ? ROUTE_ON_LOAD.userId : null);
  // Where Back from a hero goes: the gallery, or the class or the admin's
  // user page it was opened from. Kept in its history entry across a reload.
  const [openedFrom, setOpenedFrom] = useState<HeroFrom>(heroFrom);
  // Where the home screen is, on two levels: the place (a teacher's switch:
  // the gallery or My classes) and, in the gallery, the tab (the chips).
  // Each is the one last chosen, kept apart; a teacher back from paying for
  // a class is on My classes. Chosen once (a tap, or a flow that leads
  // there), neither is changed under the viewer's feet.
  const [section, setSectionState] = useState<Section>(() => (CLASS_PAID_ON_LOAD ? 'classes' : rememberedSection()));
  const [tab, setTabState] = useState<Filter>(rememberedTab);
  const placeChosen = useRef(!!CLASS_PAID_ON_LOAD);
  const setSection = (s: Section) => { placeChosen.current = true; rememberSection(s); setSectionState(s); };
  const setTab = (t: Filter) => { placeChosen.current = true; rememberTab(t); setTabState(t); };
  // A flow that ends on a gallery tab (a kept hero: My heroes).
  const showTab = (t: Filter) => { if (section !== 'gallery') setSection('gallery'); setTab(t); };
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

  // The balance as the server has it now (undefined: signed out, or unknown).
  const refreshCreditBalance = async (): Promise<number | undefined> => {
    const token = getAuthToken();
    // Read now, before any wait: the sign-in sheet forgets it as it closes.
    const wantsClasses = !!token && intendsClasses();
    if (!token) {
      setCreditBalance(undefined);
      setUserInfo(null);
      setAuthChecked(true);
      return undefined;
    }
    try {
      const user = await api.getMe();
      // Signed in after "Run a class": group mode on, and My classes.
      if (wantsClasses) {
        setClassesIntent(false);
        if (!user.is_teacher) {
          try { await api.updateProfile({ is_teacher: true }); user.is_teacher = true; } catch { /* stays a creator; the account sheet can turn it on */ }
        }
        if (user.is_teacher) setSection('classes');
      }
      setCreditBalance(user.credits);
      setUserInfo({ id: user.id, is_admin: user.is_admin, is_teacher: !!user.is_teacher });
      window.dispatchEvent(new CustomEvent('auth:credits-updated', { detail: { credits: user.credits } }));
      setAuthChecked(true);
      return user.credits;
    } catch {
      setCreditBalance(undefined);
      setUserInfo(null);
    }
    setAuthChecked(true);
    return undefined;
  };

  // Shown on the signed-out gallery right after the account is deleted.
  const [accountNotice, setAccountNotice] = useState<string | null>(null);

  useEffect(() => {
    refreshCreditBalance();
    const handleAuthChange = () => refreshCreditBalance();
    const handleUnauthorized = () => setCreditBalance(undefined);
    let noticeTimer: number | undefined;
    const handleAccountDeleted = () => {
      replaceRoute('/');
      shownPath.current = '/';
      setView('gallery');
      setCreation(null);
      setError(null);
      forgetGallery();
      setTabState('featured');
      setSectionState('gallery');
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
    // The sign-in sheet closed: a "Run a class" that did not sign in is forgotten.
    const handleAuthClosed = () => setClassesIntent(false);
    window.addEventListener('auth:closed', handleAuthClosed);
    // Anything that changes the balance outside App (a redeemed coupon) says
    // so; and coming back to the tab (from checkout, or another device's
    // purchase) re-reads it, so the app never acts on a stale balance.
    // ('auth:credits-updated' is App's own broadcast, so it is not listened to
    // here: that would loop.)
    const handleCreditsChanged = () => refreshCreditBalance();
    // The header reads the balance on its own too (each time it mounts, e.g.
    // back from Admin). Whatever it reads is the newest: take it, so the
    // header and "Make this hero?" can never disagree (Raz saw 50 above and
    // "You have 0" below).
    const handleCreditsSeen = (e: Event) => {
      const credits = (e as CustomEvent).detail?.credits;
      if (typeof credits === 'number') setCreditBalance(credits);
    };
    window.addEventListener('credits:seen', handleCreditsSeen);
    const handleVisible = () => { if (document.visibilityState === 'visible') refreshCreditBalance(); };
    window.addEventListener('credits:changed', handleCreditsChanged);
    document.addEventListener('visibilitychange', handleVisible);
    return () => {
      window.removeEventListener('credits:changed', handleCreditsChanged);
      window.removeEventListener('credits:seen', handleCreditsSeen);
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('auth:login', handleAuthChange);
      window.removeEventListener('auth:logout', handleAuthChange);
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
      window.removeEventListener('auth:account-deleted', handleAccountDeleted);
      window.removeEventListener('auth:closed', handleAuthClosed);
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

  // The gallery as it was left (Gallery remembers its list and scroll, and
  // refreshes behind the scenes).
  const showGallery = () => {
    setView('gallery');
    setCreation(null);
    setError(null);
    setGalleryKey((k) => k + 1);
    window.scrollTo({ top: 0 });
  };

  // The hero at /hero/<id>: the one in hand, or read (a reload, a link, Back).
  const creationRef = useRef(creation);
  creationRef.current = creation;
  const showHero = (id: string, v: 'hero' | 'steps') => {
    setError(null);
    setView(v);
    window.scrollTo({ top: 0 });
    if (creationRef.current?.id === id) return;
    setCreation(null);
    const stillHere = () => shownPath.current === heroPath(id) || shownPath.current === stepsPath(id);
    api.getCreation(id)
      .then((c) => { if (stillHere()) setCreation(c); })
      .catch(() => {
        if (!stillHere()) return;
        replaceRoute('/');
        shownPath.current = '/';
        showGallery();
        setError('That hero isn’t here any more.');
      });
  };

  // Draw the screen the address bar names: on load, on Back and Forward, and
  // after an in-app Back replaced the entry.
  const showLocation = () => {
    const path = window.location.pathname;
    shownPath.current = path;
    const legal = legalPageAt(path);
    if (legal) { setView(legal); window.scrollTo({ top: 0 }); return; }
    if (path === RESET_PASSWORD_PATH) { setView('reset'); return; }
    if (claim && claimToken() === claim) { setView('claim'); return; }
    const r = routeAt(path) ?? { view: 'gallery' as const };
    if (r.view === 'gallery') { showGallery(); return; }
    if (r.view === 'hero' || r.view === 'steps') { setOpenedFrom(heroFrom()); showHero(r.id, r.view); return; }
    setError(null);
    setCreation(null);
    window.scrollTo({ top: 0 });
    if (r.view === 'class') { setClassId(r.id); setView('class'); return; }
    setAdminUser(r.userId);
    setView('admin');
  };
  const showLocationRef = useRef(showLocation);
  showLocationRef.current = showLocation;
  useEffect(() => {
    // An overlay's entry from before a reload (or a page left from a sheet):
    // nothing is open over the screen now.
    if (overlayDepth()) replaceRoute(window.location.pathname + window.location.search);
    const onPop = () => { if (window.location.pathname !== shownPath.current) showLocationRef.current(); };
    window.addEventListener('popstate', onPop);
    // Opened at a hero's address: read it.
    if (ROUTE_ON_LOAD && (ROUTE_ON_LOAD.view === 'hero' || ROUTE_ON_LOAD.view === 'steps') && !CLASS_PAID_ON_LOAD) showHero(ROUTE_ON_LOAD.id, ROUTE_ON_LOAD.view);
    return () => window.removeEventListener('popstate', onPop);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // An in-app Back to `parent`: the browser's Back when that is where it
  // leads, else the entry becomes the parent (routes.ts goUp).
  const up = (parent: string) => { goUp(parent, () => showLocationRef.current()); };

  // Back to the gallery; the logo on the gallery itself starts it over from the top.
  const goHome = () => {
    if (view === 'gallery') { resetGalleryScroll(); showGallery(); return; }
    up('/');
  };

  const openHero = (c: CreationResponse, from: HeroFrom = 'gallery') => {
    setOpenedFrom(from);
    setCreation(c);
    setError(null);
    setView('hero');
    go(heroPath(c.id), { from });
    window.scrollTo({ top: 0 });
  };

  // A hero is made by people with an account: signed out, this opens sign-up.
  // And by people who can pay for it: short of credits, this opens Buy
  // credits first, before any photo is taken or uploaded (Raz: "why you let
  // me start making hero even though I don't have credits"). The balance is
  // re-read before saying no, so a stale copy never turns anyone away.
  const startNewHero = async () => {
    if (!isLoggedIn) {
      window.dispatchEvent(new CustomEvent('auth:open', { detail: { mode: 'signup' } }));
      return;
    }
    const enough = (b: number | undefined) => b === undefined || pipelineCost <= 0 || b >= pipelineCost;
    if (enough(creditBalance)) {
      setShowNewHero(true);
      refreshCreditBalance();
      return;
    }
    const balance = await refreshCreditBalance();
    if (enough(balance)) { setShowNewHero(true); return; }
    window.dispatchEvent(new CustomEvent('credits:buy', { detail: { note: `A hero is ${pipelineCost} credits. You have ${balance}.` } }));
  };

  const discardUnstarted = () => {
    const id = unstartedRef.current;
    unstartedRef.current = null;
    if (id) api.deleteCreation(id).catch((err) => console.error('[App] Failed to remove unstarted hero:', err));
  };

  const handleUpload = async (file: File, characterName?: string) => {
    if (uploadingRef.current) return;
    // The picker's accept="image/*" is only a hint: a text file got through
    // and was charged a painting (persona review). Nothing that is not a
    // picture is uploaded.
    if (!file.type.startsWith('image/')) {
      setShowNewHero(false);
      setError("That isn't a picture. Choose a photo or a drawing.");
      return;
    }
    uploadingRef.current = true;
    setShowNewHero(false);
    setIsUploading(true);
    setError(null);
    discardUnstarted();
    // "Make this hero?" says what the balance allows: the server's, not a copy.
    refreshCreditBalance();
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

  // The place shown: a teacher's choice; for everyone else the gallery. Until
  // the account is read, a remembered My classes is not judged.
  const isTeacher = !!userInfo?.is_teacher;
  const shownSection: Section = isTeacher || !authChecked ? section : 'gallery';
  const onClassesTab = shownSection === 'classes';
  // A teacher's classes: read when they sign in, kept fresh while My classes
  // shows, and now and then from the gallery, for the switch's live dot.
  const myClasses = useMyClasses(isTeacher, view === 'gallery' ? (onClassesTab ? 10000 : 60000) : false);
  // A class running right now opens My classes, once per visit, unless the
  // teacher already picked a place or a tab: mid-lesson, that is what they came for.
  const liveChecked = useRef(false);
  useEffect(() => {
    if (liveChecked.current || !myClasses.classes) return;
    liveChecked.current = true;
    if (!placeChosen.current && hasLiveClass(myClasses.classes)) setSectionState('classes');
  }, [myClasses.classes]);

  // A class is a teacher's, the console an admin's: at either address
  // without the account for it, the gallery.
  useEffect(() => {
    if (!authChecked) return;
    if ((view === 'class' && !userInfo) || (view === 'admin' && !userInfo?.is_admin)) {
      replaceRoute('/');
      showLocation();
    }
  }, [authChecked, view, userInfo]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <button type="button" className="tb-btn tb-btn--secondary tb-btn--sm" onClick={() => setAccountNotice(null)}>OK</button>
        </div>
      )}
      {error && (
        <div className="tb-notice tb-notice--error app-error" role="alert">
          {error}
          <button type="button" className="tb-btn tb-btn--secondary tb-btn--sm" onClick={() => setError(null)}>OK</button>
        </div>
      )}
    </>
  );

  const openClass = (id: string) => {
    setClassId(id);
    setView('class');
    go(classPath(id));
    window.scrollTo({ top: 0 });
  };
  const openAdmin = (userId: string | null = null) => {
    setAdminUser(userId);
    setCreation(null);
    setView('admin');
    go(adminPath(userId));
    window.scrollTo({ top: 0 });
  };
  // Back from a hero: to the class or the admin's user page it was opened
  // from (its entry knows, after a reload too), else the gallery.
  const backFromHero = () => {
    const prev = prevPath();
    if (openedFrom === 'class') { up(prev?.startsWith(CLASS_PATH) ? prev : classId ? classPath(classId) : '/'); return; }
    if (openedFrom === 'admin' && userInfo?.is_admin) { up(prev?.startsWith(ADMIN_PATH) ? prev : adminPath(adminUser)); return; }
    up('/');
  };
  const appHeader = (
    <Header
      left={(
        <button type="button" className="tb-logo app-header-center" onClick={goHome} aria-label="HeroMaker home">
          <img src="/app-icon.png" alt="" />
          <span>HeroMaker</span>
        </button>
      )}
      right={<HeaderAuth onOpenAdmin={() => openAdmin()} onClassesMode={(on) => { if (on) setSection('classes'); else leaveClasses(); }} />}
    />
  );
  const footer = (extra?: JSX.Element) => (
    <footer className="tb-footer">
      {extra}
      <div>Made by Raz Karl &amp; Elad Shikley</div>
      <div className="tb-chip-row tb-footer-row">
        <button type="button" className="tb-chip tb-footer-chip" onClick={() => openLegal('privacy')}>Privacy</button>
        <button type="button" className="tb-chip tb-footer-chip" onClick={() => openLegal('terms')}>Terms</button>
        <button type="button" className="tb-chip tb-footer-chip" onClick={() => openLegal('refunds')}>Refunds</button>
      </div>
      <div className="tb-version">{__APP_VERSION__}</div>
    </footer>
  );
  // The gallery's tabs (the chips). A teacher's classes are not one of them:
  // they are the other place, on a switch of their own above everything.
  const tabs = galleryTabs({ isLoggedIn, isAdmin: userInfo?.is_admin ?? false });
  const shownTab: Filter = !authChecked || tabs.includes(tab) ? tab : 'featured';
  const showSwitch = isTeacher || (!authChecked && hadSwitch());
  const homeSwitch = showSwitch && (
    <div className="tb-switchbar">
      <Segmented<Section>
        label="Home"
        value={shownSection}
        onChange={setSection}
        segments={[
          { id: 'gallery', label: 'Gallery', icon: 'grid' },
          { id: 'classes', label: 'My classes', icon: 'school' },
        ]}
      />
      {/* A class in session is one tap away from the gallery too. */}
      {shownSection === 'gallery' && <LiveStrip classes={myClasses.classes} onOpen={(c) => openClass(c.id)} />}
    </div>
  );
  // Group mode was turned off (the account sheet): the switch goes, the
  // gallery shows. The classes are kept for when it is turned on again.
  const leaveClasses = () => {
    rememberSection(null);
    setSectionState('gallery');
  };

  let screen;
  if (view === 'claim' && claim) {
    screen = (
      <ClaimScreen
        token={claim}
        onHome={goHome}
        onSeeHeroes={() => { showTab('mine'); goHome(); }}
        // The kept hero on its own page; Back from it lands on My heroes.
        onOpenHero={(id) => api.getCreation(id).then((c) => {
          replaceRoute('/');
          shownPath.current = '/';
          showTab('mine');
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
        // Back from a class is My classes, wherever it was opened from.
        onBack={() => { setSection('classes'); goHome(); }}
        onOpenHero={(id) => api.getCreation(id).then((c) => openHero(c, 'class')).catch(() => setError('Could not open that hero'))}
      />
    );
  } else if (view === 'privacy') {
    screen = <Privacy onBack={goHome} />;
  } else if (view === 'terms') {
    screen = <Terms onBack={goHome} />;
  } else if (view === 'refunds') {
    screen = <Refunds onBack={goHome} />;
  } else if (view === 'reset') {
    screen = <ResetPassword token={resetToken} onDone={goHome} onCancel={goHome} />;
  } else if (view === 'admin' && userInfo) {
    screen = (
      <AdminPanel
        onClose={goHome}
        currentUserId={userInfo.id}
        userId={adminUser}
        onUser={(id) => (id ? openAdmin(id) : up(ADMIN_PATH))}
        onOpenHero={(c) => openHero(c, 'admin')}
      />
    );
  } else if (view === 'steps' && creation && userInfo?.is_admin) {
    screen = (
      <div className="tb-screen tb-screen--wide">
        <Header left={<NavButton icon="back" label="Back to hero" onClick={() => up(heroPath(creation.id))} />} title="Every step" />
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
  } else if ((view === 'hero' || view === 'steps') && creation) {
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
        onShowSteps={() => { go(stepsPath(creation.id)); setView('steps'); }}
        onMakeOwn={startNewHero}
        onCreditsChanged={refreshCreditBalance}
        fromClass={openedFrom === 'class'}
      />
    );
  } else if (view === 'hero' || view === 'steps' || ((view === 'class' || view === 'admin') && !authChecked)) {
    // At an address whose screen is still being read (a hero, or who is
    // signed in): the header's Back, and nothing that is not there yet.
    screen = (
      <div className="tb-screen app-route-wait" aria-busy="true">
        <Header left={<NavButton icon="back" label="Back" onClick={view === 'hero' || view === 'steps' ? backFromHero : goHome} className="tb-back" />} />
        <div className="tb-screen-body" />
      </div>
    );
  } else {
    screen = (
      <div className="tb-screen tb-screen--wide tb-screen--app">
        <NoPageScroll />
        {appHeader}
        {homeSwitch}
        {notices}
        <div className="tb-screen-body">
          {!isLoggedIn && (
            <section className="tb-intro">
              <h2 className="tb-intro-title">Draw it. <br />We make it a real hero.</h2>
              <p className="tb-muted">Snap any drawing. Minutes later, it’s a 3D hero that moves.</p>
              {/* The way in for a teacher or a party host: sign up, then My classes. */}
              <button type="button" className="tb-btn tb-btn--secondary tb-btn--sm tb-intro-classes" onClick={() => {
                setClassesIntent(true);
                window.dispatchEvent(new CustomEvent('auth:open', { detail: { mode: 'signup', note: 'Then make your first class.' } }));
              }}>
                <Icon name="school" />Run a class
              </button>
            </section>
          )}
          <Gallery
            key={galleryKey}
            filter={shownTab}
            tabs={tabs}
            onFilter={setTab}
            section={shownSection}
            isAdmin={userInfo?.is_admin ?? false}
            userId={userInfo?.id}
            onSelect={(c) => openHero(c)}
            classes={onClassesTab ? {
              ready: !!myClasses.classes,
              content: <MyClasses data={myClasses} onOpen={(c) => openClass(c.id)} onEditSchool={() => setClassSheet('school')} />,
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
