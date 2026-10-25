import { useState, useEffect } from 'react';
import { api, getAuthToken, ApiError } from '../api/client';
import { AuthModal, type AuthMode } from './AuthModal';
import { CouponRedeem } from './CouponRedeem';
import { BuyCredits } from './BuyCredits';
import { ProfileModal } from './ProfileModal';
import { Icon } from './tb/Icon';
import { Dialog, Sheet, SheetRow, SheetToggle } from './tb/parts';
import { ApiKeysSheet } from './ApiKeysSheet';
import './HeaderAuth.css';

/**
 * Confirm deleting the whole account. The danger button only wakes up once the
 * username is typed, the same check the backend makes (DELETE /api/v1/me).
 */
function DeleteAccountDialog({ username, onClose, onDeleted }: { username: string; onClose: () => void; onDeleted: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === username;

  const remove = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount(typed.trim());
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError && err.status !== 400
        ? err.message
        : 'Your account could not be deleted right now.');
      setBusy(false);
    }
  };

  return (
    <Dialog label="Delete your account?" onClose={busy ? () => {} : onClose}>
      <div className="tb-h2">Delete your account?</div>
      <div className="tb-muted">All your heroes and credits are deleted. This can’t be undone.</div>
      <div className="tb-field">
        <label htmlFor="tb-delete-account-confirm">Type <strong>{username}</strong> to confirm</label>
        <input
          id="tb-delete-account-confirm"
          className="tb-input"
          value={typed}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={username}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') remove(); }}
        />
      </div>
      {error && <div className="tb-notice tb-notice--error header-auth-delete-error" role="alert">{error}</div>}
      <div className="tb-stack">
        <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" disabled={busy} onClick={onClose}>Keep it</button>
        <button type="button" className="tb-btn tb-btn--danger tb-btn--full" disabled={!matches || busy} onClick={remove}>
          <Icon name="trash" />{busy ? 'Deleting…' : 'Delete account'}
        </button>
      </div>
    </Dialog>
  );
}

interface User {
  id: string;
  username: string;
  email: string;
  name: string | null;
  credits: number;
  is_admin: boolean;
  is_teacher?: boolean;
}

/**
 * The signed-in person in the header: their initials on one of the gallery's
 * plate colours, the same one every time (picked from their id). A hero's
 * picture was tried here and read worse: auto-cropping to the head is not
 * reliable across heroes.
 */
function AccountButton({ user, onClick }: { user: User; onClick: () => void }) {
  const words = (user.name?.trim() || user.username).split(/[\s._-]+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : words[0]?.slice(0, 2) || '?').toUpperCase();
  const plate = ([...user.id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 6) + 1;
  return (
    <button type="button" className={`tb-nav tb-avatar tb-plate-${plate} header-auth-user-button`} aria-label="Account" title="Account" onClick={onClick}>
      <span>{initials}</span>
    </button>
  );
}

interface HeaderAuthProps {
  onOpenAdmin?: () => void;
  /** After "I run classes" was switched: on shows My classes, off the gallery. */
  onClassesMode?: (on: boolean) => void;
  /** False on screens whose header has its own buttons: the dialogs stay mounted, the controls don't show. */
  controls?: boolean;
}

/**
 * The account last read, kept for the life of the page. The header remounts
 * each time the home screen comes back (from a hero, from a class); starting
 * from nothing, it showed "Sign in" for a moment before the account arrived.
 */
let lastUser: User | null = null;

export function HeaderAuth({ onOpenAdmin, onClassesMode, controls = true }: HeaderAuthProps = {}) {
  const [user, setUserState] = useState<User | null>(() => (getAuthToken() ? lastUser : null));
  const setUser = (u: User | null) => { lastUser = u; setUserState(u); };
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  // A line the sheet shows for whoever opened it, e.g. where a kept hero goes.
  const [authNote, setAuthNote] = useState<string | undefined>(undefined);
  const [showCouponModal, setShowCouponModal] = useState(false);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [buyNote, setBuyNote] = useState<string | undefined>(undefined);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState(false);
  const [savingClasses, setSavingClasses] = useState(false);

  // Check auth status on mount
  useEffect(() => {
    checkAuth();
    
    // Listen for auth events
    const handleUnauthorized = () => {
      setUser(null);
    };

    const handleCreditsUpdated = async () => {
      await checkAuth();
    };
    
    // Anywhere in the app can ask for the buy dialog, e.g. "not enough credits".
    // A detail.note says why (e.g. "A hero is 10 credits. You have 0.").
    const handleOpenBuy = (e: Event) => {
      const note = (e as CustomEvent).detail?.note;
      setBuyNote(typeof note === 'string' ? note : undefined);
      setShowBuyModal(true);
    };
    // Anywhere can ask for sign-in or sign-up, e.g. "Make a hero" while signed out.
    const handleOpenAuth = (e: Event) => {
      const { mode, note } = (e as CustomEvent).detail ?? {};
      setAuthMode(mode === 'signup' || mode === 'forgot' ? mode : 'login');
      setAuthNote(typeof note === 'string' ? note : undefined);
      setShowAuthModal(true);
    };
    window.addEventListener('auth:open', handleOpenAuth);

    window.addEventListener('auth:unauthorized', handleUnauthorized);
    // Signed out from elsewhere (the claim page's "Switch account").
    window.addEventListener('auth:logout', handleUnauthorized);
    window.addEventListener('auth:credits-updated', handleCreditsUpdated);
    window.addEventListener('credits:buy', handleOpenBuy);
    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
      window.removeEventListener('auth:logout', handleUnauthorized);
      window.removeEventListener('auth:credits-updated', handleCreditsUpdated);
      window.removeEventListener('credits:buy', handleOpenBuy);
      window.removeEventListener('auth:open', handleOpenAuth);
    };
  }, []);


  const checkAuth = async () => {
    const token = getAuthToken();
    if (!token) {
      setUser(null);
      return;
    }

    try {
      const userData = await api.getMe();
      setUser(userData);
      // App keeps the balance "Make this hero?" checks: hand it the new one.
      window.dispatchEvent(new CustomEvent('credits:seen', { detail: { credits: userData.credits } }));
    } catch (err) {
      setUser(null);
    }
  };

  const handleLoginSuccess = async () => {
    await checkAuth();
    setShowAuthModal(false);
  };

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
    setShowUserMenu(false);
  };

  const handleCouponSuccess = (newBalance: number) => {
    if (user) {
      setUser({ ...user, credits: newBalance });
    }
    // The header is not the only place that knows the balance: the "Make this
    // hero?" sheet reads App's copy. Tell it, or it keeps saying "you have 0".
    window.dispatchEvent(new CustomEvent('credits:changed'));
  };

  const handleOpenBuyModal = () => {
    setShowUserMenu(false);
    setShowBuyModal(true);
  };

  const handleOpenCouponModal = () => {
    setShowUserMenu(false);
    setShowCouponModal(true);
  };

  const handleOpenProfile = () => {
    setShowUserMenu(false);
    setShowProfileModal(true);
  };

  // "I run classes": group mode on or off, from the account sheet. On, the
  // home gets its switch and lands on My classes; off, the switch goes and
  // the classes are kept for when it is turned on again
  // (docs/product/creator-and-group-leader.md).
  const handleClassesMode = async (on: boolean) => {
    setSavingClasses(true);
    try {
      await api.updateProfile({ is_teacher: on });
    } catch {
      setSavingClasses(false);
      return; /* nothing changed; the switch shows what is true */
    }
    await checkAuth();
    setSavingClasses(false);
    setShowUserMenu(false);
    window.dispatchEvent(new CustomEvent('auth:login'));
    onClassesMode?.(on);
  };

  const handleOpenDeleteAccount = () => {
    setShowUserMenu(false);
    setShowDeleteAccount(true);
  };

  const handleOpenAdmin = () => {
    setShowUserMenu(false);
    if (onOpenAdmin) {
      onOpenAdmin();
    }
  };

  const handleProfileUpdated = async () => {
    await checkAuth();
  };

  if (!user) {
    return (
      <>
        {controls && (
          <button type="button" className="tb-btn tb-btn--secondary tb-btn--sm header-auth-button" onClick={() => { setAuthMode('login'); setAuthNote(undefined); setShowAuthModal(true); }}>
            Sign in
          </button>
        )}
        <AuthModal
          isOpen={showAuthModal}
          onClose={() => { setShowAuthModal(false); window.dispatchEvent(new CustomEvent('auth:closed')); }}
          onSuccess={handleLoginSuccess}
          initialMode={authMode}
          note={authNote}
        />
      </>
    );
  }

  return (
    <div className="header-auth">
      {controls && (
        <>
          <button type="button" className="tb-credits header-auth-credits" aria-label={`${user.credits} credits. Buy more`} onClick={handleOpenBuyModal}>
            <Icon name="coin" size={18} />{user.credits}
          </button>
          <AccountButton user={user} onClick={() => setShowUserMenu(true)} />
        </>
      )}

      {showUserMenu && (
        <Sheet title={user.username} onClose={() => setShowUserMenu(false)}>
          <div className="tb-muted header-auth-menu-email">{user.email} · {user.credits} credits</div>
          <SheetRow icon="coin" label="Buy credits" onClick={handleOpenBuyModal} />
          <SheetRow icon="ticket" label="Redeem a coupon" onClick={handleOpenCouponModal} />
          <SheetRow icon="pencil" label="Edit profile" onClick={handleOpenProfile} />
          {/* Three groups, two lines: you, your tools, the session. */}
          <div className="tb-sheet-divider" />
          <SheetToggle icon="school" label="I run classes" on={!!user.is_teacher} busy={savingClasses} onChange={handleClassesMode} className="header-auth-classes" />
          <SheetRow icon="key" label="API keys" onClick={() => { setShowUserMenu(false); setShowApiKeys(true); }} />
          {user.is_admin && <SheetRow icon="gear" label="Admin" onClick={handleOpenAdmin} />}
          <div className="tb-sheet-divider" />
          <SheetRow icon="logout" label="Sign out" onClick={handleLogout} />
          <SheetRow icon="trash" label="Delete account" danger onClick={handleOpenDeleteAccount} />
        </Sheet>
      )}

      {showApiKeys && <ApiKeysSheet onClose={() => setShowApiKeys(false)} />}

      {showDeleteAccount && (
        <DeleteAccountDialog
          username={user.username}
          onClose={() => setShowDeleteAccount(false)}
          onDeleted={() => { setShowDeleteAccount(false); setUser(null); }}
        />
      )}

      <BuyCredits isOpen={showBuyModal} note={buyNote} credits={user?.credits} onClose={() => { setShowBuyModal(false); setBuyNote(undefined); }} />
      <CouponRedeem
        isOpen={showCouponModal}
        onClose={() => setShowCouponModal(false)}
        onSuccess={handleCouponSuccess}
      />
      <ProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        user={user}
        onProfileUpdated={handleProfileUpdated}
      />
    </div>
  );
}
