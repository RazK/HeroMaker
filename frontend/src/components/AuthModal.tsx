import { useState } from 'react';
import { api, ApiError } from '../api/client';
import './AuthModal.css';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AuthModal({ isOpen, onClose, onSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      if (mode === 'signup') {
        await api.signup(username, email, password);
      } else {
        await api.login(username, password);
      }
      onSuccess();
      handleClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setUsername('');
    setEmail('');
    setPassword('');
    setError(null);
    setMode('login');
    onClose();
  };

  return (
    <div className="auth-modal-overlay" onClick={handleClose}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
        <button className="auth-modal-close" onClick={handleClose}>×</button>
        
        <div className="auth-modal-tabs">
          <button
            className={`auth-modal-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => {
              setMode('login');
              setError(null);
            }}
          >
            Login
          </button>
          <button
            className={`auth-modal-tab ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => {
              setMode('signup');
              setError(null);
            }}
          >
            Sign Up
          </button>
        </div>

        <form className="auth-modal-form" onSubmit={handleSubmit}>
          {error && (
            <div className="auth-modal-error">
              {error}
            </div>
          )}

          <div className="auth-modal-field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              disabled={isLoading}
            />
          </div>

          {mode === 'signup' && (
            <div className="auth-modal-field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                disabled={isLoading}
              />
            </div>
          )}

          <div className="auth-modal-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              minLength={6}
              disabled={isLoading}
            />
            {mode === 'signup' && (
              <small className="auth-modal-hint">At least 6 characters</small>
            )}
          </div>

          <button
            type="submit"
            className="auth-modal-submit"
            disabled={isLoading}
          >
            {isLoading ? 'Please wait...' : mode === 'login' ? 'Log In' : 'Sign Up'}
          </button>
        </form>
      </div>
    </div>
  );
}

