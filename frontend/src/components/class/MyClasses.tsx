import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import { AGE_BANDS, ClassView, School, SeatPrice, dollars, seatsCents, teacherApi } from '../../api/classes';
import { HeroTile } from '../tb/HeroTile';
import { Icon } from '../tb/Icon';
import { Dialog, Sheet } from '../tb/parts';
import { PaySeatsDialog, Stepper, clock, heroThumb, useSecondsLeft } from './parts';
import { SchoolSheet } from './SchoolSheet';
import './class.css';

/** How many of a class's heroes its card shows (backend PREVIEW_HEROES). */
const SHELF = 4;

export interface MyClassesData {
  classes: ClassView[] | null;
  school: School | null | undefined;
  heroCost: number;
  seatPrice: SeatPrice | null;
  error: string | null;
  reload: () => void;
  setSchool: (s: School) => void;
}

/**
 * A teacher's classes, for the gallery's My classes tab. Read once when a
 * teacher signs in (a class running right now opens that tab), then every
 * 10 seconds while the tab is showing: the seats and the Live badge move.
 */
export function useMyClasses(enabled: boolean, polling: boolean): MyClassesData {
  const [classes, setClasses] = useState<ClassView[] | null>(null);
  const [heroCost, setHeroCost] = useState(10);
  const [seatPrice, setSeatPrice] = useState<SeatPrice | null>(null);
  const [error, setError] = useState<string | null>(null);
  // undefined until read; null: not asked yet (asked before the first class).
  const [school, setSchool] = useState<School | null | undefined>(undefined);

  const reload = useCallback(() => {
    teacherApi.list()
      .then((r) => { setClasses(r.classes); setHeroCost(r.hero_cost); setSchool(r.school); setSeatPrice(r.seat_price ?? null); setError(null); })
      .catch(() => setError('Could not load your classes.'));
  }, []);

  useEffect(() => {
    if (!enabled) { setClasses(null); setSchool(undefined); setError(null); return undefined; }
    reload();
    if (!polling) return undefined;
    const t = window.setInterval(reload, 10000);
    return () => window.clearInterval(t);
  }, [enabled, polling, reload]);

  return { classes, school, heroCost, seatPrice, error, reload, setSchool };
}

/** Classes running right now come first: that is what a teacher needs mid-lesson. */
const isLive = (c: ClassView) => !!c.live?.open;
export const hasLiveClass = (classes: ClassView[] | null) => !!classes?.some(isLive);

/**
 * The My classes tab: the school, then the class cards, a class running now
 * pinned first. Each class was paid for up front (docs/product/class-sessions.md).
 */
export function MyClasses({ data, onOpen, onEditSchool, onStop }: {
  data: MyClassesData;
  onOpen: (c: ClassView) => void;
  onEditSchool: () => void;
  /** "Stop showing My classes": teacher mode off, quietly, from the tab itself. */
  onStop: () => void;
}) {
  const { classes, school, error, reload } = data;
  const sorted = classes && [...classes.filter(isLive), ...classes.filter((c) => !isLive(c))];
  return (
    <div className="cls-tab">
      {error && <div className="tb-notice tb-notice--error" role="alert">{error}<button type="button" className="tb-link" onClick={reload}>Try again</button></div>}
      {classes && classes.length === 0 ? (
        <div className="cls-empty">
          <div className="cls-empty-art"><Icon name="school" /></div>
          <div className="tb-h1">Your first class</div>
          <div className="tb-muted">Pay once for its seats. Every child makes one hero.</div>
        </div>
      ) : (
        <>
          {(school || classes) && (
            <div className="cls-tab-school">
              {school
                ? <button type="button" className="tb-link cls-school-link" dir="auto" onClick={onEditSchool}><Icon name="school" size={18} />{school.name}</button>
                : <span />}
              {classes && <span className="tb-muted">{classes.length} {classes.length === 1 ? 'class' : 'classes'}</span>}
            </div>
          )}
          <div className="cls-cards">
            {!sorted && Array.from({ length: 2 }, (_, i) => <div key={i} className="cls-card cls-card--skeleton" />)}
            {sorted?.map((c, i) => <ClassCard key={c.id} c={c} index={i} onOpen={() => onOpen(c)} />)}
          </div>
        </>
      )}
      {classes && (
        <div className="cls-tab-foot">
          <button type="button" className="tb-link cls-stop-classes" onClick={onStop}>Stop showing My classes</button>
        </div>
      )}
    </div>
  );
}

/**
 * A class as a card that belongs to the gallery: a shelf of its first four
 * heroes, each a small gallery tile (its plate, the drawing cross-fading to
 * the hero), and an empty seat for each one still to come. A class running
 * now is ringed in grape, says how long is left, and has a big Open.
 */
function ClassCard({ c, index, onOpen }: { c: ClassView; index: number; onOpen: () => void }) {
  const live = isLive(c);
  const seatsShown = Math.max(1, Math.min(SHELF, c.seats));
  const sub = `${c.heroes_ready} of ${c.seats} heroes · ${c.seats_left} ${c.seats_left === 1 ? 'seat' : 'seats'} left`;
  // No hero yet: one friendly plate waiting for the first.
  const shelf = c.preview.length === 0 ? (
    <span className={`cls-card-shelf cls-card-shelf--empty tb-plate-${(index % 6) + 1}`}>
      <span className="cls-card-shelf-badge" aria-hidden="true"><Icon name="brush" /></span>
      No heroes yet
    </span>
  ) : (
    <span className="cls-card-shelf" aria-hidden="true">
      {Array.from({ length: seatsShown }, (_, i) => {
        const h = c.preview[i];
        // The hero tile, small and art only: no caption, so the hero is
        // centred on its plate rather than standing on a caption that is not there.
        return h ? (
          <HeroTile key={h.creation_id} size="mini" index={index + i} className="cls-mini"
            art={{ kind: 'fade', drawing: heroThumb(h, 'thumb_original.jpg'), hero: heroThumb(h, 'thumb_rendered.png') }}
            alt={`${h.label}'s hero`} eager={index < 3} />
        ) : <span key={`seat-${i}`} className="cls-mini cls-mini--seat"><Icon name="user" /></span>;
      })}
    </span>
  );
  const text = (
    <span className="cls-card-text">
      <span className="cls-card-title" dir="auto">{c.title}</span>
      <span className="cls-card-sub">{sub}</span>
    </span>
  );

  if (!live) {
    return (
      <button type="button" className="cls-card" onClick={onOpen} data-class={c.title}>
        {shelf}
        <span className="cls-card-body">
          {text}
          <span className="cls-card-go"><Icon name="back" /></span>
        </span>
      </button>
    );
  }
  return (
    <div className="cls-card cls-card--live" data-class={c.title}>
      <LiveLine endsAt={c.live?.ends_at} />
      {shelf}
      <span className="cls-card-body">{text}</span>
      <button type="button" className="tb-btn tb-btn--primary tb-btn--full cls-open-live" onClick={onOpen} aria-label={`Open ${c.title}`}>
        Open class
      </button>
    </div>
  );
}

function LiveLine({ endsAt }: { endsAt: string | undefined }) {
  const left = useSecondsLeft(endsAt);
  return (
    <span className="cls-card-live">
      <span className="cls-live"><span className="cls-live-dot" />Live</span>
      <span className="cls-card-left"><Icon name="clock" size={18} />{clock(left)} left</span>
    </span>
  );
}

/**
 * New class, from the My classes tab's bar. The first one asks for the
 * school once, then goes on to the class; 'school' edits the school alone.
 */
export function NewClassFlow({ mode, data, credits, onClose, onCreated }: {
  mode: 'new' | 'school';
  data: MyClassesData;
  credits: number | undefined;
  onClose: () => void;
  onCreated: (c: ClassView) => void;
}) {
  const [step, setStep] = useState<'school' | 'class'>(mode === 'school' || data.school === null ? 'school' : 'class');
  if (step === 'school') {
    return (
      <SchoolSheet
        school={data.school ?? null}
        onClose={onClose}
        onSaved={(s) => { data.setSchool(s); if (mode === 'new') setStep('class'); else onClose(); }}
      />
    );
  }
  return (
    <NewClassSheet
      credits={credits}
      heroCost={data.heroCost}
      seatPrice={data.seatPrice}
      onClose={onClose}
      onCreated={(c) => { data.reload(); onCreated(c); }}
    />
  );
}

/** "How many students?" and the price, then the confirm. */
function NewClassSheet({ credits, heroCost, seatPrice, onClose, onCreated }: {
  credits: number | undefined;
  heroCost: number;
  seatPrice: SeatPrice | null;
  onClose: () => void;
  onCreated: (c: ClassView) => void;
}) {
  const [title, setTitle] = useState('');
  const [seats, setSeats] = useState(25);
  const [ages, setAges] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cost = seats * heroCost;
  const short = credits !== undefined && cost > credits;
  // Short of credits: pay money at the teacher price, for exactly these seats.
  const cents = seatPrice ? seatsCents(seatPrice, seats) : 0;

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const c = await teacherApi.create(title.trim(), seats, ages);
      window.dispatchEvent(new CustomEvent('credits:changed'));
      onCreated(c);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Payments are unavailable right now.');
      setConfirm(false);
      setBusy(false);
    }
  };

  if (paying && seatPrice) {
    return <PaySeatsDialog seats={seats} cents={cents} title={title.trim()} seatsBefore={0} onClose={() => setPaying(false)}
      open={() => teacherApi.buyNew(title.trim(), seats, ages)} />;
  }

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
        <div className="tb-field">
          <label id="cls-ages-label">Ages</label>
          <div className="cls-ages" role="radiogroup" aria-labelledby="cls-ages-label">
            {AGE_BANDS.map((a) => (
              <button key={a} type="button" role="radio" aria-checked={ages === a}
                className={`tb-chip${ages === a ? ' tb-chip--on' : ''}`}
                onClick={() => setAges(ages === a ? null : a)}>{a.replace('-', '–')}</button>
            ))}
          </div>
        </div>
        {error && <div className="tb-muted" role="alert" style={{ color: 'var(--tb-red)' }}>{error}</div>}
      </div>
      <div className="tb-stack cls-sheet-bar">
        <div className="tb-bar-note">
          {short ? `You need ${cost} credits. You have ${credits}.` : `${heroCost} credits a hero, paid now`}
        </div>
        {short && seatPrice ? (
          <>
            <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={() => window.dispatchEvent(new CustomEvent('credits:buy'))}>
              <Icon name="coin" />Buy credits
            </button>
            <button type="button" className="tb-btn tb-btn--primary tb-btn--full cls-pay-seats" disabled={!title.trim()} onClick={() => setPaying(true)}>
              Pay {dollars(cents)} for {seats} {seats === 1 ? 'seat' : 'seats'}
            </button>
          </>
        ) : <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={onClose}>Cancel</button>}
        {short && seatPrice ? null : short ? (
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
