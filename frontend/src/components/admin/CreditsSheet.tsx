import { useState } from 'react';
import { api, ApiError } from '../../api/client';
import { Icon } from '../tb/Icon';
import { Dialog, Sheet } from '../tb/parts';

export type CreditsMode = 'give' | 'take';

const QUICK = [5, 10, 25, 50];

/**
 * Give credits, or take some back: an amount and a note (required), then a
 * confirmation, because it is money. Booked in the ledger as an admin
 * adjustment, and in the audit log with the note. Taking back stops at zero.
 */
export function CreditsSheet({ user, mode, onClose, onDone }: {
  user: { id: string; username: string; name?: string | null; credits: number };
  mode: CreditsMode;
  onClose: () => void;
  /** After the change: the balance it left. */
  onDone: (credits: number) => void;
}) {
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const who = user.name || user.username;
  const n = parseInt(value, 10);
  const max = mode === 'take' ? user.credits : 1000;
  const amountOk = Number.isFinite(n) && n > 0 && n <= max;
  const valid = amountOk && note.trim().length > 0;
  const after = mode === 'give' ? user.credits + (amountOk ? n : 0) : user.credits - (amountOk ? n : 0);

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.admin.changeCredits(user.id, mode === 'give' ? n : -n, note.trim());
      onDone(r.credits);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That did not work. Try again.');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'give' ? `Give ${who} credits` : `Take back credits`;
  return (
    <>
      <Sheet title={title} onClose={onClose} className="adm-credits-sheet">
        <div className="adm-form">
          <div className="tb-muted adm-sheet-sub">{who} has {user.credits} {user.credits === 1 ? 'credit' : 'credits'}</div>
          {mode === 'give' && (
            <div className="adm-chips adm-chips--tight" role="group" aria-label="Amount">
              {QUICK.map((q) => (
                <button key={q} type="button" className={`tb-chip${n === q ? ' tb-chip--on' : ''}`} aria-pressed={n === q} onClick={() => setValue(String(q))}>
                  {q}
                </button>
              ))}
            </div>
          )}
          <div className="tb-field">
            <label htmlFor="adm-credits-amount">{mode === 'give' ? 'Credits to give' : `Credits to take back (up to ${user.credits})`}</label>
            <input id="adm-credits-amount" className="tb-input" type="number" inputMode="numeric" min="1" max={max}
              value={value} autoFocus onChange={(e) => { setValue(e.target.value); setError(null); }} />
          </div>
          <div className="tb-field">
            <label htmlFor="adm-credits-note">Note (why)</label>
            <textarea id="adm-credits-note" className="tb-input adm-textarea" rows={2} maxLength={500}
              placeholder={mode === 'give' ? 'Sorry about the failed hero' : 'Given twice by mistake'}
              value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error && <div className="adm-error" role="alert">{error}</div>}
          <div className="tb-bar-note">Admin adjustment. Not revenue.</div>
          <button type="button" className={`tb-btn ${mode === 'give' ? 'tb-btn--primary' : 'tb-btn--danger'} tb-btn--full`} disabled={!valid || busy} onClick={() => setConfirming(true)}>
            <Icon name={mode === 'give' ? 'coin' : 'minus'} />
            {amountOk ? `${mode === 'give' ? 'Give' : 'Take back'} ${n} ${n === 1 ? 'credit' : 'credits'}` : mode === 'give' ? 'Give' : 'Take back'}
          </button>
        </div>
      </Sheet>
      {confirming && (
        <Dialog label={mode === 'give' ? `Give ${n} credits?` : `Take back ${n} credits?`} onClose={() => setConfirming(false)}>
          <div className="tb-h2">{mode === 'give' ? `Give ${who} ${n} credits?` : `Take ${n} credits from ${who}?`}</div>
          <div className="tb-muted">New balance: {after}.</div>
          <div className="tb-stack">
            <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={() => setConfirming(false)}>Cancel</button>
            <button type="button" className={`tb-btn ${mode === 'give' ? 'tb-btn--primary' : 'tb-btn--danger'} tb-btn--full`} disabled={busy} onClick={save}>
              <Icon name="check" />{mode === 'give' ? 'Give' : 'Take back'}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
