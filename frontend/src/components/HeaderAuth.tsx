import { useState, useEffect } from 'react';
import { api, getAuthToken, ApiError } from '../api/client';
import { AuthModal, type AuthMode } from './AuthModal';
import { CouponRedeem } from './CouponRedeem';
import { BuyCredits } from './BuyCredits';
import { ProfileModal } from './ProfileModal';
import { Icon } from './tb/Icon';
import { Dialog, Sheet, SheetRow } from './tb/parts';
import './HeaderAuth.css';

/**
 * Confirm deleting the whole account. The danger button only wakes up once the
 * username is typed, the same check the backend makes (DELETE /api/auth/me).
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
  /** False on screens whose header has its own buttons: the dialogs stay mounted, the controls don't show. */
  controls?: boolean;
}

export function HeaderAuth({ onOpenAdmin, controls = true }: HeaderAuthProps = {}) {
  const [user, setUser] = useState<User | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [showCouponModal, setShowCouponModal] = useState(false);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);

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
    const handleOpenBuy = () => setShowBuyModal(true);
    // Anywhere can ask for sign-in or sign-up, e.g. "Make a hero" while signed out.
    const handleOpenAuth = (e: Event) => {
      const mode = (e as CustomEvent).detail?.mode;
      setAuthMode(mode === 'signup' || mode === 'forgot' ? mode : 'login');
      setShowAuthModal(true);
    };
    window.addEventListener('auth:open', handleOpenAuth);

    window.addEventListener('auth:unauthorized', handleUnauthorized);
    window.addEventListener('auth:credits-updated', handleCreditsUpdated);
    window.addEventListener('credits:buy', handleOpenBuy);
    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
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
          <button type="button" className="tb-btn tb-btn--secondary tb-btn--sm header-auth-button" onClick={() => { setAuthMode('login'); setShowAuthModal(true); }}>
            Sign in
          </button>
        )}
        <AuthModal
          isOpen={showAuthModal}
          onClose={() => setShowAuthModal(false)}
          onSuccess={handleLoginSuccess}
          initialMode={authMode}
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
          {user.is_admin && <SheetRow icon="gear" label="Admin" onClick={handleOpenAdmin} />}
          <div className="tb-sheet-divider" />
          <SheetRow icon="logout" label="Sign out" onClick={handleLogout} />
          <SheetRow icon="trash" label="Delete account" danger onClick={handleOpenDeleteAccount} />
        </Sheet>
      )}

      {showDeleteAccount && (
        <DeleteAccountDialog
          username={user.username}
          onClose={() => setShowDeleteAccount(false)}
          onDeleted={() => { setShowDeleteAccount(false); setUser(null); }}
        />
      )}

      <BuyCredits isOpen={showBuyModal} onClose={() => setShowBuyModal(false)} />
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
