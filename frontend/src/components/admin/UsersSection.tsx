import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, AdminUserResponse, ApiError } from '../../api/client';
import { Icon } from '../tb/Icon';
import { Dialog, NavButton, Sheet, SheetRow } from '../tb/parts';
import { CreditsSheet } from './CreditsSheet';
import { shortDate } from './format';

/** Does this user match the search: name, email or username, any part, any case. */
export function matchesUser(u: Pick<AdminUserResponse, 'username' | 'email' | 'name'>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [u.name, u.email, u.username].some((f) => (f ?? '').toLowerCase().includes(q));
}

/** The search and the test-accounts toggle: owned by the admin console, so a user's page and back keeps them. */
export interface UsersFilter { query: string; showTest: boolean }

export function UsersSection({ currentUserId, onOpen, filter, onFilter }: {
  currentUserId: string;
  onOpen: (userId: string) => void;
  filter: UsersFilter;
  onFilter: (f: UsersFilter) => void;
}) {
  const [users, setUsers] = useState<AdminUserResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { query, showTest } = filter;
  const setQuery = (q: string) => onFilter({ ...filter, query: q });
  const [menu, setMenu] = useState<AdminUserResponse | null>(null);
  const [creditsFor, setCreditsFor] = useState<AdminUserResponse | null>(null);
  const [deleting, setDeleting] = useState<AdminUserResponse | null>(null);
  const [busy, setBusy] = useState(false);
  // Test accounts (the staging robot's robot_*, anything @example.com) are
  // hidden by default, server-side, so leftovers never bury real people.
  const setShowTest = (on: boolean) => { setUsers(null); onFilter({ ...filter, showTest: on }); };
  const [testCount, setTestCount] = useState<number | null>(null);
  // Every account, test ones too: read only when a search finds no one with
  // test accounts hidden, to say whether a hidden one matches.
  const [everyone, setEveryone] = useState<AdminUserResponse[] | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, counts] = await Promise.all([
        api.admin.listUsers(showTest),
        api.admin.countUsers().catch(() => null),
      ]);
      setUsers(list);
      setTestCount(counts ? counts.test_accounts : null);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load users.');
      setUsers((u) => u ?? []);
    }
  }, [showTest]);
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
      setDeleting(null);
      load();
    }
  };

  const shown = useMemo(() => (users ? users.filter((u) => matchesUser(u, query)) : users), [users, query]);
  const searchMissed = !showTest && !!query.trim() && shown !== null && shown.length === 0 && (testCount ?? 0) > 0;
  useEffect(() => {
    if (!searchMissed || everyone) return;
    let live = true;
    api.admin.listUsers(true).then((all) => { if (live) setEveryone(all); }).catch(() => { /* the plain empty state stays */ });
    return () => { live = false; };
  }, [searchMissed, everyone]);
  const hiddenMatches = searchMissed && everyone ? everyone.filter((u) => u.is_test_account && matchesUser(u, query)).length : 0;

  return (
    <>
      <input
        className="tb-input"
        type="search"
        placeholder="Name, email or username"
        aria-label="Find a user by name, email or username"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && <div className="adm-error" role="alert">{error}</div>}
      {shown === null ? (
        <><div className="adm-card adm-skel" style={{ height: 84 }} /><div className="adm-card adm-skel" style={{ height: 84 }} /><div className="adm-card adm-skel" style={{ height: 84 }} /></>
      ) : (
        <>
          <div className="adm-users-bar">
            <div className="adm-summary-line">{shown.length} {shown.length === 1 ? 'user' : 'users'}</div>
            {(showTest || (testCount ?? 0) > 0) && (
              <button
                type="button"
                className={`tb-chip${showTest ? ' tb-chip--on' : ''}`}
                aria-pressed={showTest}
                onClick={() => setShowTest(!showTest)}
              >
                {showTest ? 'Hide test accounts' : 'Show test accounts'}{testCount !== null ? ` (${testCount})` : ''}
              </button>
            )}
          </div>
          {shown.length === 0 && query.trim() && (
            <div className="adm-card adm-empty" data-testid="users-empty">
              <Icon name="user" size={28} />
              {hiddenMatches > 0 ? (
                <>
                  <span>No one matches. {hiddenMatches} test {hiddenMatches === 1 ? 'account matches' : 'accounts match'}</span>
                  <button type="button" className="tb-btn tb-btn--secondary adm-btn-xs" onClick={() => setShowTest(true)}>Show</button>
                </>
              ) : <>No one matches “{query.trim()}”</>}
            </div>
          )}
          {shown.map((u) => (
            <div key={u.id} className="adm-card adm-user">
              {/* The whole card opens their page; ⋯ beside it is a sibling, not inside (a button cannot hold a button). */}
              <button type="button" className="adm-user-main adm-user-open" onClick={() => onOpen(u.id)} aria-label={`Open ${u.name || u.username}`}>
                <span className="adm-user-name">
                  {u.name || u.username}
                  {u.is_admin && <span className="adm-pill">Admin</span>}
                  {u.is_test_account && <span className="adm-pill adm-pill--off">Test</span>}
                  {u.id === currentUserId && <span className="adm-pill adm-pill--active">You</span>}
                </span>
                <span className="adm-user-email">{u.name ? `${u.username} · ` : ''}{u.email}</span>
                <span className="adm-coupon-meta">
                  <span className="adm-coupon-credits"><Icon name="coin" size={16} />{u.credits}</span>
                  <span>{u.creation_stats.completed} {u.creation_stats.completed === 1 ? 'hero' : 'heroes'}</span>
                  {u.creation_stats.failed > 0 && <span className="adm-bad">{u.creation_stats.failed} failed</span>}
                  {u.creation_stats.in_progress > 0 && <span>{u.creation_stats.in_progress} making</span>}
                  <span>since {shortDate(u.created_at)}</span>
                </span>
              </button>
              <NavButton icon="more" label={`More for ${u.username}`} className="adm-nav-sm" onClick={() => setMenu(u)} />
            </div>
          ))}
        </>
      )}

      {menu && (
        <Sheet title={menu.name || menu.username} onClose={() => setMenu(null)}>
          <div className="tb-muted adm-sheet-sub">{menu.email} · {menu.credits} credits</div>
          <SheetRow icon="user" label="Heroes and history" onClick={() => { const id = menu.id; setMenu(null); onOpen(id); }} />
          <SheetRow icon="coin" label="Give credits" onClick={() => { setCreditsFor(menu); setMenu(null); }} />
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

      {creditsFor && (
        <CreditsSheet
          user={creditsFor}
          mode="give"
          onClose={() => setCreditsFor(null)}
          onDone={() => { setCreditsFor(null); load(); }}
        />
      )}

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
