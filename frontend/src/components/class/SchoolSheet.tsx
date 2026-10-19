import { useState } from 'react';
import { ApiError } from '../../api/client';
import { School, SchoolType, teacherApi } from '../../api/classes';
import { Sheet } from '../tb/parts';
import './class.css';

const TYPES: { id: SchoolType; label: string }[] = [
  { id: 'kindergarten', label: 'Kindergarten' },
  { id: 'primary', label: 'Primary school' },
  { id: 'after_school', label: 'After-school' },
  { id: 'other', label: 'Other' },
];

/** The kind of school, as My classes' school card names it. */
export const SCHOOL_TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.id, t.label])) as Record<SchoolType, string>;

/** The country the browser is set to, e.g. "en-IL" -> "Israel". Editable. */
function browserCountry(): string {
  try {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const lang of langs) {
      const region = new Intl.Locale(lang).maximize().region;
      if (region) return new Intl.DisplayNames(['en'], { type: 'region' }).of(region) ?? '';
    }
  } catch { /* old browser: the teacher types it */ }
  return '';
}

/**
 * "Your school": asked once, before the first class, on one phone screen.
 * Only the name and the type are needed; the type is a tap.
 */
export function SchoolSheet({ school, onClose, onSaved }: {
  school: School | null;
  onClose: () => void;
  onSaved: (s: School) => void;
}) {
  const [name, setName] = useState(school?.name ?? '');
  const [type, setType] = useState<SchoolType | null>(school?.type ?? null);
  const [city, setCity] = useState(school?.city ?? '');
  const [country, setCountry] = useState(school?.country ?? browserCountry);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = !!name.trim() && !!type;

  const save = async () => {
    if (!type) return;
    setBusy(true);
    setError(null);
    try {
      onSaved((await teacherApi.saveSchool({ name: name.trim(), type, city: city.trim(), country: country.trim() })).school);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save. Try again.');
      setBusy(false);
    }
  };

  return (
    <Sheet title="Your school" onClose={onClose} className="cls-school-sheet">
      <div className="cls-sheet-body">
        <div className="tb-field">
          <label htmlFor="cls-school">School or group name</label>
          <input id="cls-school" className="tb-input" value={name} maxLength={80} placeholder="Oak Tree Primary" dir="auto"
            autoComplete="organization" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="cls-school-types" role="radiogroup" aria-label="Kind of place">
          {TYPES.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={type === t.id}
              className={`tb-chip cls-chip-lg${type === t.id ? ' tb-chip--on' : ''}`} onClick={() => setType(t.id)}>{t.label}</button>
          ))}
        </div>
        <div className="cls-school-where">
          <div className="tb-field">
            <label htmlFor="cls-city">City</label>
            <input id="cls-city" className="tb-input" value={city} maxLength={60} dir="auto"
              autoComplete="address-level2" onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="tb-field">
            <label htmlFor="cls-country">Country</label>
            <input id="cls-country" className="tb-input" value={country} maxLength={60} dir="auto"
              autoComplete="country-name" onChange={(e) => setCountry(e.target.value)} />
          </div>
        </div>
        {error && <div className="tb-muted" role="alert" style={{ color: 'var(--tb-red)' }}>{error}</div>}
      </div>
      <div className="tb-stack cls-sheet-bar">
        <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={onClose}>Not now</button>
        <button type="button" className="tb-btn tb-btn--primary tb-btn--full cls-school-save" disabled={!ready || busy} onClick={save}>
          {busy ? 'Saving…' : 'Continue'}
        </button>
      </div>
    </Sheet>
  );
}
