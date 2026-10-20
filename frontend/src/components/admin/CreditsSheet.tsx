import { useState } from 'react';
import { api, ApiError } from '../../api/client';
import { Icon } from '../tb/Icon';
import { Dialog, Sheet } from '../tb/parts';

export type CreditsMode = 'give' | 'take';

const QUICK = [5, 10, 25, 50];

/**
 * The amount as typed, or why it cannot be used. Whole positive numbers only:
 * "1e3" is not 1, "5.7" is not 5, and 0 or a minus sign is refused, never
 * quietly rounded into something else.
 */
export function parseAmount(raw: string, max: number): { n: number } | { reason: string | null } {
  const t = raw.trim();
  if (!t) return { reason: null };
  if (!/^\d+$/.test(t)) return { reason: 'Whole numbers only.' };
  const n = Number(t);
  if (n <= 0) return { reason: 'At least 1.' };
  if (n > max) return { reason: `Up to ${max}.` };
  return { n };
}

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
  const max = mode === 'take' ? user.credits : 1000;
  const parsed = parseAmount(value, max);
  const amountOk = 'n' in parsed;
  const n = 'n' in parsed ? parsed.n : NaN;
  const reason = 'reason' in parsed ? parsed.reason : null;
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
            <input id="adm-credits-amount" className="tb-input" type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off"
              aria-invalid={reason ? true : undefined} aria-describedby={reason ? 'adm-credits-why' : undefined}
              value={value} autoFocus onChange={(e) => { setValue(e.target.value); setError(null); }} />
            {reason && <div id="adm-credits-why" className="adm-note adm-note--bad">{reason}</div>}
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
