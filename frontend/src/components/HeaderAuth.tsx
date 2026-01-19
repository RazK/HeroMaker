import { useState, useEffect, useRef } from 'react';
import { api, getAuthToken } from '../api/client';
import { AuthModal } from './AuthModal';
import { CouponRedeem } from './CouponRedeem';
import { ProfileModal } from './ProfileModal';
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
}

export function HeaderAuth({ onOpenAdmin }: HeaderAuthProps = {}) {
  const [user, setUser] = useState<User | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showCouponModal, setShowCouponModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
    
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    window.addEventListener('auth:credits-updated', handleCreditsUpdated);
    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
      window.removeEventListener('auth:credits-updated', handleCreditsUpdated);
    };
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showUserMenu]);

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
        <button className="header-auth-button" onClick={() => setShowAuthModal(true)}>
          Log In
        </button>
        <AuthModal
          isOpen={showAuthModal}
          onClose={() => setShowAuthModal(false)}
          onSuccess={handleLoginSuccess}
        />
      </>
    );
  }

  return (
    <div className="header-auth" ref={menuRef}>
      {/* Admin button - only visible for admins */}
      {user.is_admin && (
        <button
          className="header-button"
          onClick={handleOpenAdmin}
          title="Admin Panel"
        >
          <span className="header-button-text">Admin</span>
          <span className="header-button-icon">⚙️</span>
        </button>
      )}

      <button
        className="header-button header-auth-user-button"
        onClick={() => setShowUserMenu(!showUserMenu)}
      >
        <span className="header-button-text">{user.username}</span>
        <span className="header-auth-credits">🪙 {user.credits}</span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`header-auth-chevron ${showUserMenu ? 'open' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      
      {showUserMenu && (
        <div className="header-auth-menu">
          <div className="header-auth-menu-item header-auth-menu-user-info">
            <div className="header-auth-menu-username">{user.username}</div>
            <div className="header-auth-menu-email">{user.email}</div>
            <div className="header-auth-menu-credits">
              Credits: <strong>{user.credits}</strong>
            </div>
          </div>
          <div className="header-auth-menu-divider"></div>
          <button className="header-auth-menu-item header-auth-menu-action" onClick={handleOpenProfile}>
            Edit Profile ✏️
          </button>
          <button className="header-auth-menu-item header-auth-menu-action" onClick={handleOpenCouponModal}>
            Redeem Coupon 🎟️
          </button>
          <button className="header-auth-menu-item header-auth-menu-logout" onClick={handleLogout}>
            Log Out
          </button>
        </div>
      )}

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

