import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { Sheet } from './tb/parts';
import { GoogleSignIn } from './GoogleSignIn';
import './AuthModal.css';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialMode?: 'login' | 'signup';
}

export function AuthModal({ isOpen, onClose, onSuccess, initialMode = 'login' }: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  useEffect(() => { if (isOpen) setMode(initialMode); }, [isOpen, initialMode]);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      if (mode === 'signup') {
        await api.signup(username, email, password, name, dateOfBirth);
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

  const handleGoogle = async (credential: string) => {
    setError(null);
    setIsLoading(true);
    try {
      await api.loginWithGoogle(credential);
      onSuccess();
      handleClose();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409
        ? err.message
        : 'Google sign-in didn\u2019t work. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setUsername('');
    setEmail('');
    setPassword('');
    setName('');
    setDateOfBirth('');
    setError(null);
    setMode('login');
    onClose();
  };

  const switchTo = (m: 'login' | 'signup') => { setMode(m); setError(null); };

  return (
    <Sheet title={mode === 'login' ? 'Welcome back' : 'Save every hero'} onClose={handleClose} className="auth-modal">
      <form className="auth-modal-form" onSubmit={handleSubmit}>
        <GoogleSignIn onCredential={handleGoogle} />
        <div className="auth-modal-fields">
          <div className="tb-field">
            <label htmlFor="username">Username</label>
            <input id="username" className="tb-input" type="text" value={username} onChange={(e) => setUsername(e.target.value)} required disabled={isLoading} autoComplete="username" />
          </div>
          {mode === 'signup' && (
            <>
          <div className="tb-field">
            <label htmlFor="email">Email</label>
            <input id="email" className="tb-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={isLoading} autoComplete="email" />
          </div>
          <div className="tb-field">
            <label htmlFor="name">Your name</label>
            <input id="name" className="tb-input" type="text" value={name} onChange={(e) => setName(e.target.value)} required disabled={isLoading} autoComplete="name" />
          </div>
              <div className="tb-field">
                <label htmlFor="dateOfBirth">Date of birth</label>
                <input
                  id="dateOfBirth"
                  className="tb-input"
                  type="date"
                  // The backend requires a birth date at least a year back; a
                  // phone's picker opens on today, which it would then reject.
                  max={new Date(Date.now() - 366 * 24 * 3600 * 1000).toISOString().slice(0, 10)}
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  required
                  disabled={isLoading}
                />
              </div>
            </>
          )}
          <div className="tb-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="tb-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              minLength={6}
              placeholder={mode === 'signup' ? 'At least 6 characters' : undefined}
              disabled={isLoading}
            />
          </div>
        </div>

        <div className="tb-stack auth-modal-actions">
          {error && <div className="auth-modal-error" role="alert">{error}</div>}
          <div className="tb-bar-note">
            {mode === 'login' ? 'New here? ' : 'Already have an account? '}
            <button type="button" className="tb-link auth-modal-tab" onClick={() => switchTo(mode === 'login' ? 'signup' : 'login')}>
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </button>
          </div>
          <button type="submit" className="tb-btn tb-btn--primary tb-btn--full auth-modal-submit" disabled={isLoading}>
            {isLoading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
