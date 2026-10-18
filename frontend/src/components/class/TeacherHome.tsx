import { ReactNode, useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import { ClassView, heroFile, teacherApi } from '../../api/classes';
import { Icon } from '../tb/Icon';
import { Dialog, NoPageScroll, Sheet } from '../tb/parts';
import { Stepper } from './parts';
import './class.css';

/**
 * A teacher's home: their classes. Each class is paid for up front (its seats
 * move from the teacher's credits to the class), so creating one is "spending
 * money" and confirms first (BRANDBOOK.md). Parent voice: calm and precise.
 */
export function TeacherHome({ header, credits, onOpen, footer }: {
  header: ReactNode;
  credits: number | undefined;
  onOpen: (c: ClassView) => void;
  footer?: ReactNode;
}) {
  const [classes, setClasses] = useState<ClassView[] | null>(null);
  const [heroCost, setHeroCost] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = () => teacherApi.list()
    .then((r) => { setClasses(r.classes); setHeroCost(r.hero_cost); setError(null); })
    .catch(() => setError('Could not load your classes.'));
  useEffect(() => {
    load();
    const t = window.setInterval(load, 10000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div className="tb-screen tb-screen--wide tb-screen--app cls-home">
      <NoPageScroll />
      {header}
      <div className="tb-screen-body">
        {error && <div className="tb-notice tb-notice--error" role="alert">{error}<button type="button" className="tb-link" onClick={load}>Try again</button></div>}
        {classes && classes.length === 0 ? (
          <div className="cls-empty">
            <div className="cls-empty-art"><Icon name="school" /></div>
            <div className="tb-h1">Your first class</div>
            <div className="tb-muted">Pay once for its seats. Every child makes one hero.</div>
          </div>
        ) : (
          <>
            <div className="cls-home-title">
              <div className="tb-h2">My classes</div>
              {classes && <div className="tb-muted">{classes.length} {classes.length === 1 ? 'class' : 'classes'}</div>}
            </div>
            <div className="cls-cards">
              {!classes && Array.from({ length: 3 }, (_, i) => <div key={i} className={`cls-card tb-tile--skeleton`} style={{ height: 220 }} />)}
              {classes?.map((c, i) => <ClassCard key={c.id} c={c} index={i} onOpen={() => onOpen(c)} />)}
            </div>
          </>
        )}
        {footer}
      </div>
      <div className="tb-bar">
        <button type="button" className="tb-btn tb-btn--primary tb-btn--full cls-new-class" onClick={() => setCreating(true)}>
          <Icon name="plus" />New class
        </button>
      </div>
      {creating && (
        <NewClassSheet
          credits={credits}
          heroCost={heroCost}
          onClose={() => setCreating(false)}
          onCreated={(c) => { setCreating(false); load(); onOpen(c); }}
        />
      )}
    </div>
  );
}

function ClassCard({ c, index, onOpen }: { c: ClassView; index: number; onOpen: () => void }) {
  const live = c.live?.open;
  return (
    <button type="button" className="cls-card" onClick={onOpen} data-class={c.title}>
      <div className={`cls-card-shelf tb-plate-${(index % 6) + 1}${c.preview.length ? '' : ' cls-card-shelf--empty'}`}>
        {c.preview.length
          ? c.preview.map((h) => <img key={h.creation_id} src={heroFile(h, 'thumb_rendered.png')} alt={`${h.label}'s hero`} loading="lazy" />)
          : <Icon name="school" />}
      </div>
      <div className="cls-card-body">
        <div className="cls-card-text">
          <div className="cls-card-title" dir="auto">{c.title}</div>
          <div className="cls-card-sub">{c.heroes_ready} of {c.seats} heroes · {c.seats_left} {c.seats_left === 1 ? 'seat' : 'seats'} left</div>
        </div>
        {live
          ? <span className="cls-live"><span className="cls-live-dot" />Live</span>
          : <span className="cls-card-go"><Icon name="back" /></span>}
      </div>
    </button>
  );
}

/** "How many students?" and the price, then the confirm. */
function NewClassSheet({ credits, heroCost, onClose, onCreated }: {
  credits: number | undefined;
  heroCost: number;
  onClose: () => void;
  onCreated: (c: ClassView) => void;
}) {
  const [title, setTitle] = useState('');
  const [seats, setSeats] = useState(25);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cost = seats * heroCost;
  const short = credits !== undefined && cost > credits;

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const c = await teacherApi.create(title.trim(), seats);
      window.dispatchEvent(new CustomEvent('credits:changed'));
      onCreated(c);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Payments are unavailable right now.');
      setConfirm(false);
      setBusy(false);
    }
  };

  if (confirm) {
    return (
      <Dialog label={`Pay ${cost} credits?`} onClose={() => setConfirm(false)}>
        <div className="tb-h2">Pay {cost} credits?</div>
        <div className="tb-muted">{seats} heroes for {title.trim()}. Unused seats stay on the class.</div>
        <div className="tb-stack">
          <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={() => setConfirm(false)}>Not now</button>
          <button type="button" className="tb-btn tb-btn--primary tb-btn--full cls-pay" disabled={busy} onClick={pay}>
            <Icon name="coin" />{busy ? 'Paying…' : `Pay ${cost} credits`}
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Sheet title="New class" onClose={onClose} className="cls-new-sheet">
      <div className="cls-sheet-body">
        <div className="tb-field">
          <label htmlFor="cls-title">Class name</label>
          <input id="cls-title" className="tb-input" value={title} maxLength={60} placeholder="Grade 2B" autoFocus dir="auto"
            onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="cls-field-row">
          <div className="tb-field">
            <label htmlFor="cls-seats">Students</label>
            <div className="tb-muted">One hero each</div>
          </div>
          <Stepper value={seats} min={1} max={60} onChange={setSeats} label="Students" />
        </div>
        {error && <div className="tb-muted" role="alert" style={{ color: 'var(--tb-red)' }}>{error}</div>}
      </div>
      <div className="tb-stack cls-sheet-bar">
        <div className="tb-bar-note">
          {short ? `You need ${cost} credits. You have ${credits}.` : `${heroCost} credits a hero, paid now`}
        </div>
        <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={onClose}>Cancel</button>
        {short ? (
          <button type="button" className="tb-btn tb-btn--primary tb-btn--full" onClick={() => window.dispatchEvent(new CustomEvent('credits:buy'))}>
            <Icon name="coin" />Buy credits
          </button>
        ) : (
          <button type="button" className="tb-btn tb-btn--primary tb-btn--full tb-btn--with-trail cls-create" disabled={!title.trim()} onClick={() => setConfirm(true)}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="school" />Create class</span>
            <span className="tb-btn-trail"><Icon name="coin" size={18} />{cost}</span>
          </button>
        )}
      </div>
    </Sheet>
  );
}
