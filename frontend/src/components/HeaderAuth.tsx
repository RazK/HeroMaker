import { useState, useEffect } from 'react';
import { api, getAuthToken } from '../api/client';
import { AuthModal, type AuthMode } from './AuthModal';
import { CouponRedeem } from './CouponRedeem';
import { BuyCredits } from './BuyCredits';
import { ProfileModal } from './ProfileModal';
import { Icon } from './tb/Icon';
import { NavButton, Sheet, SheetRow } from './tb/parts';
import './HeaderAuth.css';

interface User {
  id: string;
  username: string;
  email: string;
  name: string | null;
  credits: number;
  is_admin: boolean;
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
          <NavButton icon="user" label="Account" className="header-auth-user-button" onClick={() => setShowUserMenu(true)} />
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
        </Sheet>
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
