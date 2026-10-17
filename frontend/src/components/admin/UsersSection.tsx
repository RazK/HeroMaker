import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, AdminUserResponse, ApiError } from '../../api/client';
import { Icon } from '../tb/Icon';
import { Dialog, NavButton, Sheet, SheetRow } from '../tb/parts';
import { shortDate } from './format';

export function UsersSection({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AdminUserResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<AdminUserResponse | null>(null);
  const [creditsFor, setCreditsFor] = useState<AdminUserResponse | null>(null);
  const [deleting, setDeleting] = useState<AdminUserResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setUsers(await api.admin.listUsers());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load users.');
      setUsers((u) => u ?? []);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
      setMenu(null);
      setCreditsFor(null);
      setDeleting(null);
      load();
    }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!users || !q) return users;
    return users.filter((u) => `${u.username} ${u.email} ${u.name ?? ''}`.toLowerCase().includes(q));
  }, [users, query]);

  return (
    <>
      <input
        className="tb-input"
        type="search"
        placeholder="Find a user"
        aria-label="Find a user"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && <div className="adm-error" role="alert">{error}</div>}
      {shown === null ? (
        <><div className="adm-card adm-skel" style={{ height: 84 }} /><div className="adm-card adm-skel" style={{ height: 84 }} /><div className="adm-card adm-skel" style={{ height: 84 }} /></>
      ) : (
        <>
          <div className="adm-summary-line">{shown.length} {shown.length === 1 ? 'user' : 'users'}</div>
          {shown.map((u) => (
            <div key={u.id} className="adm-card adm-user">
              <div className="adm-user-main">
                <div className="adm-user-name">
                  {u.username}
                  {u.is_admin && <span className="adm-pill">Admin</span>}
                  {u.id === currentUserId && <span className="adm-pill adm-pill--active">You</span>}
                </div>
                <div className="adm-user-email">{u.email}</div>
                <div className="adm-coupon-meta">
                  <span className="adm-coupon-credits"><Icon name="coin" size={16} />{u.credits}</span>
                  <span>{u.creation_stats.completed} heroes</span>
                  {u.creation_stats.failed > 0 && <span className="adm-bad">{u.creation_stats.failed} failed</span>}
                  {u.creation_stats.in_progress > 0 && <span>{u.creation_stats.in_progress} making</span>}
                  <span>since {shortDate(u.created_at)}</span>
                </div>
              </div>
              <NavButton icon="more" label={`More for ${u.username}`} className="adm-nav-sm" onClick={() => setMenu(u)} />
            </div>
          ))}
        </>
      )}

      {menu && (
        <Sheet title={menu.username} onClose={() => setMenu(null)}>
          <div className="tb-muted adm-sheet-sub">{menu.email} · {menu.credits} credits</div>
          <SheetRow icon="coin" label="Set credits" onClick={() => { setCreditsFor(menu); setMenu(null); }} />
          {menu.id !== currentUserId && (
            <SheetRow
              icon="gear"
              label={menu.is_admin ? 'Remove admin' : 'Make admin'}
              onClick={() => act(() => api.admin.updateUser(menu.id, { is_admin: !menu.is_admin }))}
            />
          )}
          {menu.id !== currentUserId && (
            <>
              <div className="tb-sheet-divider" />
              <SheetRow icon="trash" label="Delete account" danger onClick={() => { setDeleting(menu); setMenu(null); }} />
            </>
          )}
        </Sheet>
      )}

      {creditsFor && <CreditsSheet user={creditsFor} busy={busy} onClose={() => setCreditsFor(null)} onSave={(n) => act(() => api.admin.updateUser(creditsFor.id, { credits: n }))} />}

      {deleting && (
        <Dialog label={`Delete ${deleting.username}?`} onClose={() => setDeleting(null)}>
          <div className="tb-h2">Delete {deleting.username}?</div>
          <div className="tb-muted">Their heroes go too. Purchase records stay. This can’t be undone.</div>
          <div className="tb-stack">
            <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={() => setDeleting(null)}>Keep it</button>
            <button type="button" className="tb-btn tb-btn--danger tb-btn--full" disabled={busy} onClick={() => act(() => api.admin.deleteUser(deleting.id))}>
              <Icon name="trash" />Delete
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function CreditsSheet({ user, busy, onClose, onSave }: { user: AdminUserResponse; busy: boolean; onClose: () => void; onSave: (n: number) => void }) {
  const [value, setValue] = useState(String(user.credits));
  const n = parseInt(value, 10);
  const valid = Number.isFinite(n) && n >= 0 && n !== user.credits;
  return (
    <Sheet title={`Credits for ${user.username}`} onClose={onClose}>
      <div className="adm-form">
        <div className="tb-field">
          <label htmlFor="user-credits">Balance</label>
          <input id="user-credits" className="tb-input" type="number" inputMode="numeric" min="0" value={value} autoFocus onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="tb-muted">Recorded in the ledger as an admin adjustment.</div>
        <button type="button" className="tb-btn tb-btn--primary tb-btn--full" disabled={!valid || busy} onClick={() => onSave(n)}>
          <Icon name="check" />Save
        </button>
      </div>
    </Sheet>
  );
}
