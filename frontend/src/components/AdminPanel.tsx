import { useState } from 'react';
import { Icon, IconName } from './tb/Icon';
import { MoneySection } from './admin/MoneySection';
import { CouponsSection } from './admin/CouponsSection';
import { UsersSection } from './admin/UsersSection';
import { SchoolsSection } from './admin/SchoolsSection';
import './admin/admin.css';

interface AdminPanelProps {
  onClose: () => void;
  currentUserId: string;
}

type Section = 'money' | 'coupons' | 'users' | 'schools';

const SECTIONS: { id: Section; label: string; icon: IconName }[] = [
  { id: 'money', label: 'Money', icon: 'wallet' },
  { id: 'coupons', label: 'Coupons', icon: 'ticket' },
  { id: 'users', label: 'Users', icon: 'user' },
  { id: 'schools', label: 'Schools', icon: 'school' },
];

const KEY = 'heromaker.admin.section';

function initialSection(): Section {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'money' || saved === 'coupons' || saved === 'users' || saved === 'schools') return saved;
  } catch { /* private mode: default */ }
  return 'money';
}

/**
 * The admin console: Money (is the company net positive, what is left at each
 * provider, what is due), Coupons (give people credits), Users, and Schools
 * (teachers: where, what kind, classes, seats bought, heroes made). Rendered
 * under App's "Admin" header; this owns everything below it.
 */
export function AdminPanel({ currentUserId }: AdminPanelProps) {
  const [section, setSection] = useState<Section>(initialSection);
  const pick = (s: Section) => {
    setSection(s);
    try { localStorage.setItem(KEY, s); } catch { /* fine */ }
  };

  return (
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
      {section === 'users' && <UsersSection currentUserId={currentUserId} />}
      {section === 'schools' && <SchoolsSection />}
    </div>
  );
}
