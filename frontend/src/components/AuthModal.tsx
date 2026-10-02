import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { Sheet } from './tb/parts';
import './AuthModal.css';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialMode?: AuthMode;
}

export type AuthMode = 'login' | 'signup' | 'forgot';

export function AuthModal({ isOpen, onClose, onSuccess, initialMode = 'login' }: AuthModalProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  useEffect(() => { if (isOpen) { setMode(initialMode); setResetSent(false); } }, [isOpen, initialMode]);
  // "Forgot password?" shows only where the backend can actually send email.
  const [canReset, setCanReset] = useState(false);
  useEffect(() => { if (isOpen) api.getAuthConfig().then((c) => setCanReset(c.password_reset)); }, [isOpen]);
  const [resetSent, setResetSent] = useState(false);
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
      if (mode === 'forgot') {
        await api.forgotPassword(email);
        setResetSent(true);
        return;
      }
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

  const handleClose = () => {
    setUsername('');
    setEmail('');
    setPassword('');
    setName('');
    setDateOfBirth('');
    setError(null);
    setMode('login');
    setResetSent(false);
    onClose();
  };

  const switchTo = (m: AuthMode) => { setMode(m); setError(null); setResetSent(false); };

  if (mode === 'forgot') {
    return (
      <Sheet title={resetSent ? 'Check your email' : 'Forgot password?'} onClose={handleClose} className="auth-modal auth-modal--forgot">
        {resetSent ? (
          <div className="tb-stack auth-modal-actions">
            <div className="tb-muted auth-modal-sent">If <strong>{email}</strong> has an account, a link is on its way.</div>
            <button type="button" className="tb-btn tb-btn--secondary tb-btn--full auth-modal-back" onClick={() => switchTo('login')}>Back to sign in</button>
          </div>
        ) : (
          <form className="auth-modal-form" onSubmit={handleSubmit}>
            <div className="tb-field">
              <label htmlFor="forgot-email">Email</label>
              <input id="forgot-email" className="tb-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={isLoading} autoComplete="email" autoFocus />
            </div>
            <div className="tb-stack auth-modal-actions">
              {error && <div className="auth-modal-error" role="alert">{error}</div>}
              <button type="submit" className="tb-btn tb-btn--primary tb-btn--full auth-modal-submit" disabled={isLoading}>
                {isLoading ? 'Please wait…' : 'Send link'}
              </button>
            </div>
          </form>
        )}
      </Sheet>
    );
  }

  return (
    <Sheet title={mode === 'login' ? 'Welcome back' : 'Save every hero'} onClose={handleClose} className="auth-modal">
      <form className="auth-modal-form" onSubmit={handleSubmit}>
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
            {mode === 'login' && canReset && (
              <button type="button" className="tb-link auth-modal-forgot" onClick={() => switchTo('forgot')}>Forgot password?</button>
            )}
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
