import { useState, useEffect, useRef } from 'react';
import { api, getAuthToken } from '../api/client';
import { AuthModal } from './AuthModal';
import './HeaderAuth.css';

interface User {
  id: string;
  username: string;
  email: string;
  tokens: number;
  is_admin: boolean;
}

export function HeaderAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Check auth status on mount
  useEffect(() => {
    checkAuth();
    
    // Listen for auth events
    const handleUnauthorized = () => {
      setUser(null);
    };
    
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
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
      <button
        className="header-auth-user-button"
        onClick={() => setShowUserMenu(!showUserMenu)}
      >
        <span className="header-auth-username">{user.username}</span>
        <span className="header-auth-tokens">🪙 {user.tokens}</span>
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
            <div className="header-auth-menu-tokens">
              Tokens: <strong>{user.tokens}</strong>
            </div>
          </div>
          <div className="header-auth-menu-divider"></div>
          <button className="header-auth-menu-item header-auth-menu-logout" onClick={handleLogout}>
            Log Out
          </button>
        </div>
      )}
    </div>
  );
}

