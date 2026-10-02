import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { Header, NavButton } from './tb/parts';
import './AuthModal.css';

export const RESET_PASSWORD_PATH = '/reset-password';

/** The page a "Forgot password?" email links to: /reset-password?token=... */
export function ResetPassword({ token, onDone, onCancel }: { token: string; onDone: () => void; onCancel: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await api.resetPassword(token, password);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const askAgain = () => {
    onCancel();
    // After the gallery has mounted, so its sign-in sheet is the one listening.
    setTimeout(() => window.dispatchEvent(new CustomEvent('auth:open', { detail: { mode: 'forgot' } })), 0);
  };

  return (
    <form className="tb-screen reset-password" onSubmit={handleSubmit}>
      <Header left={<NavButton icon="back" label="Back" onClick={onCancel} />} title="New password" />
      <div className="tb-screen-body">
        <div className="tb-field">
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            className="tb-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            placeholder="At least 6 characters"
            autoComplete="new-password"
            autoFocus
            disabled={isLoading || !token}
          />
        </div>
        {(error || !token) && (
          <div className="auth-modal-error" role="alert">
            {error || 'This link is missing its code.'}{' '}
            <button type="button" className="tb-link" onClick={askAgain}>Get a new link</button>
          </div>
        )}
      </div>
      <div className="tb-bar">
        <button type="submit" className="tb-btn tb-btn--primary tb-btn--full reset-password-submit" disabled={isLoading || !token}>
          {isLoading ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
