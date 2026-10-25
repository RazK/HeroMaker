import { useEffect, useMemo, useState } from 'react';
import { ApiError, fetchJson } from '../../api/client';
import { School } from '../../api/classes';
import { Icon } from '../tb/Icon';
import { shortDate } from './format';

const BASE = import.meta.env.VITE_API_BASE_URL || '';

interface TeacherRow {
  user_id: string;
  username: string;
  email: string | null;
  name: string | null;
  school: School | null;
  classes: number;
  seats_bought: number;
  heroes_made: number;
  last_class_at: string | null;
  teacher_since: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  kindergarten: 'Kindergarten',
  primary: 'Primary school',
  after_school: 'After-school',
  other: 'Other',
};

/**
 * Teachers and their schools: where classes happen, what kind of place, and
 * what each teacher did with us. Busiest first (backend: classes.schools_report).
 */
export function SchoolsSection() {
  const [rows, setRows] = useState<TeacherRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetchJson<{ teachers: TeacherRow[] }>(`${BASE}/api/v1/admin/schools`)
      .then((r) => setRows(r.teachers))
      .catch((e) => { setError(e instanceof ApiError ? e.message : 'Could not load schools.'); setRows([]); });
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!rows || !q) return rows;
    return rows.filter((r) => [r.school?.name, r.school?.city, r.school?.country, r.username, r.email]
      .join(' ').toLowerCase().includes(q));
  }, [rows, query]);

  const totals = useMemo(() => (rows ?? []).reduce(
    (t, r) => ({ classes: t.classes + r.classes, seats: t.seats + r.seats_bought, heroes: t.heroes + r.heroes_made }),
    { classes: 0, seats: 0, heroes: 0 },
  ), [rows]);

  return (
    <>
      <input className="tb-input" type="search" placeholder="Find a school, city or teacher" aria-label="Find a school"
        value={query} onChange={(e) => setQuery(e.target.value)} />
      {error && <div className="adm-error" role="alert">{error}</div>}
      {shown === null ? (
        <><div className="adm-card adm-skel" style={{ height: 96 }} /><div className="adm-card adm-skel" style={{ height: 96 }} /></>
      ) : (
        <>
          <div className="adm-summary-line">
            {shown.length} {shown.length === 1 ? 'teacher' : 'teachers'} · {totals.classes} {totals.classes === 1 ? 'class' : 'classes'} · {totals.seats} {totals.seats === 1 ? 'seat' : 'seats'} · {totals.heroes} {totals.heroes === 1 ? 'hero' : 'heroes'}
          </div>
          {shown.map((r) => (
            <div key={r.user_id} className="adm-card adm-user adm-school" data-teacher={r.username}>
              <div className="adm-user-main">
                <div className="adm-user-name" dir="auto">
                  {r.school?.name ?? 'No school yet'}
                  {r.school && <span className="adm-pill">{TYPE_LABEL[r.school.type] ?? r.school.type}</span>}
                </div>
                {r.school && (r.school.city || r.school.country) && (
                  <div className="adm-user-email" dir="auto">{[r.school.city, r.school.country].filter(Boolean).join(', ')}</div>
                )}
                <div className="adm-user-email">{r.name ? `${r.name} · ` : ''}{r.email ?? r.username}</div>
                <div className="adm-coupon-meta">
                  <span><Icon name="school" size={16} /> {r.classes} {r.classes === 1 ? 'class' : 'classes'}</span>
                  <span>{r.seats_bought} {r.seats_bought === 1 ? 'seat' : 'seats'} bought</span>
                  <span>{r.heroes_made} {r.heroes_made === 1 ? 'hero' : 'heroes'} made</span>
                  {r.last_class_at && <span>last class {shortDate(r.last_class_at)}</span>}
                </div>
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}
