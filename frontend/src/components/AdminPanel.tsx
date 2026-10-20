import { useState } from 'react';
import { CreationResponse } from '../api/client';
import { Icon, IconName } from './tb/Icon';
import { Header, NavButton } from './tb/parts';
import { MoneySection } from './admin/MoneySection';
import { CouponsSection } from './admin/CouponsSection';
import { UsersFilter, UsersSection } from './admin/UsersSection';
import { SchoolsSection } from './admin/SchoolsSection';
import { UserDetail } from './admin/UserDetail';
import './admin/admin.css';

interface AdminPanelProps {
  onClose: () => void;
  currentUserId: string;
  /** The user page shown (/admin/users/<id>), or null for the console. */
  userId: string | null;
  /** Open a user's page, or (null) go back to the list. App puts it in the URL. */
  onUser: (id: string | null) => void;
  /** Open a hero's own page (from a user's page). Back from it returns here. */
  onOpenHero: (c: CreationResponse) => void;
}

type Section = 'money' | 'coupons' | 'users' | 'schools';

const SECTIONS: { id: Section; label: string; icon: IconName }[] = [
  { id: 'money', label: 'Money', icon: 'wallet' },
  { id: 'coupons', label: 'Coupons', icon: 'ticket' },
  { id: 'users', label: 'Users', icon: 'user' },
  { id: 'schools', label: 'Schools', icon: 'school' },
];

const KEY = 'heromaker.admin.section';
// The Users search and test-accounts toggle, per tab.
const FILTER_KEY = 'heromaker.admin.usersFilter';

function initialSection(): Section {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'money' || saved === 'coupons' || saved === 'users' || saved === 'schools') return saved;
  } catch { /* private mode: default */ }
  return 'money';
}

function initialFilter(): UsersFilter {
  try {
    const f = JSON.parse(sessionStorage.getItem(FILTER_KEY) ?? 'null');
    if (f && typeof f.query === 'string' && typeof f.showTest === 'boolean') return { query: f.query, showTest: f.showTest };
  } catch { /* fine */ }
  return { query: '', showTest: false };
}

/**
 * The admin console: Money (is the company net positive, what is left at each
 * provider, what is due), Coupons (give people credits), Users (and each
 * user's page: their heroes, credits and audit log), and Schools (teachers:
 * where, what kind, classes, seats bought, heroes made). Owns its whole
 * screen, header included, so a user's page has its own Back. A user's page
 * has its own address, so it can be pasted into a ticket and survives a reload.
 */
export function AdminPanel({ onClose, currentUserId, userId, onUser, onOpenHero }: AdminPanelProps) {
  const [section, setSection] = useState<Section>(initialSection);
  // Lives here, not in the list: Back to users finds the same search and toggle.
  const [usersFilter, setUsersFilter] = useState<UsersFilter>(initialFilter);
  const filterUsers = (f: UsersFilter) => {
    setUsersFilter(f);
    try { sessionStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch { /* fine */ }
  };
  const pick = (s: Section) => {
    setSection(s);
    try { localStorage.setItem(KEY, s); } catch { /* fine */ }
  };
  const setUserId = (id: string | null) => {
    onUser(id);
    window.scrollTo({ top: 0 });
  };

  if (userId) {
    return (
      <div className="tb-screen tb-screen--wide">
        <Header left={<NavButton icon="back" label="Back to users" onClick={() => setUserId(null)} />} title="User" />
        <div className="tb-screen-body">
          <div className="adm adm--wide">
            <UserDetail userId={userId} currentUserId={currentUserId} onOpenHero={onOpenHero} onGone={() => setUserId(null)} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tb-screen tb-screen--wide">
      <Header left={<NavButton icon="back" label="Back" onClick={onClose} />} title="Admin" />
      <div className="tb-screen-body">
        <div className="adm">
          <div className="adm-tabs" role="tablist" aria-label="Admin sections">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={section === s.id}
                className={`adm-tab${section === s.id ? ' adm-tab--on' : ''}`}
                onClick={() => pick(s.id)}
              >
                <Icon name={s.icon} size={20} />
                {s.label}
              </button>
            ))}
          </div>
          {section === 'money' && <MoneySection />}
          {section === 'coupons' && <CouponsSection />}
          {section === 'users' && <UsersSection currentUserId={currentUserId} onOpen={(id) => setUserId(id)} filter={usersFilter} onFilter={filterUsers} />}
          {section === 'schools' && <SchoolsSection />}
        </div>
      </div>
    </div>
  );
}
