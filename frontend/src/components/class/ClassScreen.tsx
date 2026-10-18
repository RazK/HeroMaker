import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { ClassView, SeatPrice, Student, dollars, seatsCents, teacherApi } from '../../api/classes';
import { Icon } from '../tb/Icon';
import { Dialog, Header, NavButton, NoPageScroll, Sheet, SheetRow } from '../tb/parts';
import { PaySeatsDialog, PinDigits, seatsBeforeCheckout, Qr, Stepper, StudentTile, clock, useSecondsLeft } from './parts';
import './class.css';

const DURATIONS = [30, 45, 60];

/**
 * The class this screen last showed, kept while one of its heroes is open:
 * back from the hero, the class shows at once, scrolled where it was left
 * (as the gallery does), and refreshes behind the scenes. `body` is the
 * screen's scroller; `roster` scrolls on its own beside the join card on a
 * desktop.
 */
const memory = { id: '', view: null as ClassView | null, body: 0, roster: 0 };
const SCROLLERS = { body: '.tb-screen-body', roster: '.cls-roster' } as const;
/** Tiles this close to the top load their pictures at once (as the gallery's). */
const EAGER_TILES = 6;

/**
 * One class, for its teacher. Not live: the class gallery (every hero its
 * students made, kept) and Start class. Live: the screen to project, with the
 * code, the QR, the time left and the roster filling with heroes.
 */
export function ClassScreen({ classId, credits, paid, onBack, onOpenHero }: {
  classId: string;
  credits: number | undefined;
  /** Back from paying for seats: they arrive by webhook, so watch for them. */
  paid?: boolean;
  onBack: () => void;
  onOpenHero: (creationId: string) => void;
}) {
  const [c, setC] = useState<ClassView | null>(() => {
    if (memory.id !== classId) Object.assign(memory, { id: classId, view: null, body: 0, roster: 0 });
    return memory.view;
  });
  const [seatPrice, setSeatPrice] = useState<SeatPrice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'more' | 'start' | 'seats' | 'end' | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitingSeats, setWaitingSeats] = useState<'waiting' | 'in' | null>(paid ? 'waiting' : null);
  const [seatsBefore] = useState(() => (paid ? seatsBeforeCheckout(classId) : 0));

  const load = useCallback(() => teacherApi.get(classId).then((v) => {
    setC(v);
    Object.assign(memory, { id: classId, view: v });
    if (v.seat_price !== undefined) setSeatPrice(v.seat_price);
    setError(null);
  }).catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load the class.')), [classId]);
  const live = !!c?.live?.open;
  const root = useRef<HTMLDivElement>(null);
  const shown = !!c;
  // Back where it was left, before the first paint, so it never jumps.
  useLayoutEffect(() => {
    if (!shown) return;
    const each = (fn: (el: HTMLElement, k: 'body' | 'roster') => void) => {
      for (const k of ['body', 'roster'] as const) {
        const el = root.current?.querySelector<HTMLElement>(SCROLLERS[k]);
        if (el) fn(el, k);
      }
    };
    each((el, k) => { el.scrollTop = memory[k]; });
    // Read once more on the way out: a tap right after a scroll can come
    // before that scroll's event.
    return () => each((el, k) => { memory[k] = el.scrollTop; });
  }, [shown]);
  const remember = (e: React.UIEvent) => {
    const el = e.target as HTMLElement;
    for (const k of ['body', 'roster'] as const) if (el.matches?.(SCROLLERS[k])) memory[k] = el.scrollTop;
  };
  useEffect(() => {
    load();
    const t = window.setInterval(load, live || waitingSeats === 'waiting' ? 2000 : 8000);
    return () => window.clearInterval(t);
  }, [load, live, waitingSeats]);

  // The webhook usually lands within a second or two of the checkout. Say so
  // once the seat count moves (or stop saying anything after a minute).
  useEffect(() => {
    if (waitingSeats === 'waiting' && c && c.seats > seatsBefore) setWaitingSeats('in');
  }, [c, waitingSeats, seatsBefore]);
  useEffect(() => {
    if (!waitingSeats) return;
    const t = window.setTimeout(() => setWaitingSeats(null), waitingSeats === 'in' ? 6000 : 60000);
    return () => window.clearTimeout(t);
  }, [waitingSeats]);

  const act = async (what: () => Promise<ClassView>, fail: string) => {
    setBusy(true);
    setError(null);
    try {
      setC(await what());
      setSheet(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : fail);
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <Header
      left={<NavButton icon="back" label="Back to classes" onClick={() => { Object.assign(memory, { body: 0, roster: 0 }); onBack(); }} />}
      title={c?.title ?? ''}
      right={<NavButton icon="more" label="More" onClick={() => setSheet('more')} />}
    />
  );
  const notice = (
    <>
      {error && <div className="tb-notice tb-notice--error" role="alert">{error}<button type="button" className="tb-link" onClick={() => setError(null)}>OK</button></div>}
      {waitingSeats && (
        <div className="tb-notice cls-seats-notice" role="status">
          <Icon name={waitingSeats === 'in' ? 'check' : 'coin'} />
          {waitingSeats === 'in' ? 'Thanks! Your seats are in.' : 'Thanks! Adding your seats…'}
        </div>
      )}
    </>
  );

  if (!c) {
    return <div className="tb-screen tb-screen--wide tb-screen--app"><NoPageScroll />{header}{notice}<div className="tb-screen-body" /></div>;
  }

  const roster = c.roster ?? [];
  return (
    <div ref={root} onScrollCapture={remember} className={`tb-screen tb-screen--wide tb-screen--app cls-class${live ? ' cls-class--live' : ''}`} data-live={live || undefined}>
      <NoPageScroll />
      {header}
      {notice}
      {live && c.live
        ? <Live c={c} roster={roster} busy={busy} onOpenHero={onOpenHero} onAction={(s, a) => act(() => teacherApi.student(c.id, s.id, a), 'Could not update')} />
        : <ClassGallery c={c} roster={roster} onOpenHero={onOpenHero} />}
      <div className="tb-bar">
        {live ? (
          <div className="tb-bar-row">
            <button type="button" className="tb-btn tb-btn--secondary cls-extend" disabled={busy} onClick={() => act(() => teacherApi.extend(c.id, 15), 'Could not add time')}>
              <Icon name="clock" />+15 min
            </button>
            <button type="button" className="tb-btn tb-btn--primary cls-end" disabled={busy} onClick={() => setSheet('end')}>End class</button>
          </div>
        ) : c.seats_left > 0 ? (
          <>
            <div className="tb-bar-note">{c.seats_left} of {c.seats} seats left · one hero each</div>
            <button type="button" className="tb-btn tb-btn--primary tb-btn--full cls-start" onClick={() => setSheet('start')}><Icon name="play" />Start class</button>
          </>
        ) : (
          <>
            <div className="tb-bar-note">{c.seats === 0 ? (waitingSeats === 'waiting' ? 'Your seats are on the way' : 'No seats yet') : 'Every seat has a hero'}</div>
            <button type="button" className="tb-btn tb-btn--primary tb-btn--full" onClick={() => setSheet('seats')}><Icon name="plus" />Add seats</button>
          </>
        )}
      </div>

      {sheet === 'more' && (
        <Sheet title={c.title} onClose={() => setSheet(null)}>
          <div className="tb-muted" style={{ padding: '0 4px 8px' }}>{c.seats_used} of {c.seats} seats used · {c.sessions} {c.sessions === 1 ? 'session' : 'sessions'}</div>
          <SheetRow icon="plus" label="Add seats" trail={seatPrice ? `${c.hero_cost} credits or ${dollars(seatPrice.seat_cents)}` : `${c.hero_cost} credits each`} onClick={() => setSheet('seats')} />
        </Sheet>
      )}
      {sheet === 'start' && <StartDialog c={c} busy={busy} onClose={() => setSheet(null)}
        onStart={(m, a) => act(() => teacherApi.start(c.id, m, a), 'Could not start the class')} />}
      {sheet === 'end' && (
        <Dialog label="End the class?" onClose={() => setSheet(null)}>
          <div className="tb-h2">End the class?</div>
          <div className="tb-muted">Heroes being made will still finish.</div>
          <div className="tb-stack">
            <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={() => setSheet(null)}>Keep going</button>
            <button type="button" className="tb-btn tb-btn--primary tb-btn--full cls-end-confirm" disabled={busy} onClick={() => act(() => teacherApi.end(c.id), 'Could not end the class')}>End class</button>
          </div>
        </Dialog>
      )}
      {sheet === 'seats' && <AddSeats c={c} credits={credits} seatPrice={seatPrice} onClose={() => setSheet(null)}
        onPaid={(v) => { setC(v); setSheet(null); window.dispatchEvent(new CustomEvent('credits:changed')); }} />}
    </div>
  );
}

function ClassGallery({ c, roster, onOpenHero }: { c: ClassView; roster: Student[]; onOpenHero: (id: string) => void }) {
  const made = roster.filter((s) => s.hero);
  return (
    <div className="tb-screen-body cls-gallery">
      <div className="cls-stats">
        <span className="cls-stat"><Icon name="star" />{c.heroes_ready} {c.heroes_ready === 1 ? 'hero' : 'heroes'}</span>
        <span className="cls-stat"><Icon name="users" />{c.seats_left} {c.seats_left === 1 ? 'seat' : 'seats'} left</span>
      </div>
      {made.length === 0 ? (
        <div className="cls-empty">
          <div className="cls-empty-art"><Icon name="users" /></div>
          <div className="tb-h2">No heroes yet</div>
          <div className="tb-muted">Start the class. Heroes appear here as they’re made.</div>
        </div>
      ) : (
        <div className="cls-grid">
          {made.map((s, i) => <StudentTile key={s.id} student={s} index={i} eager={i < EAGER_TILES} onOpen={() => s.hero && onOpenHero(s.hero.creation_id)} />)}
        </div>
      )}
    </div>
  );
}

function Live({ c, roster, busy, onAction, onOpenHero }: {
  c: ClassView;
  roster: Student[];
  busy: boolean;
  onAction: (s: Student, a: 'approve' | 'block') => void;
  onOpenHero: (creationId: string) => void;
}) {
  const left = useSecondsLeft(c.live?.ends_at);
  const session = c.live!;
  const url = `${window.location.origin}/join/${session.pin}`;
  const host = window.location.host.replace(/^www\./, '');
  const shown = roster.filter((s) => s.status !== 'blocked');
  // Waiting first: they need the teacher. Then everyone in the order they joined.
  const ordered = [...shown.filter((s) => s.status === 'waiting'), ...shown.filter((s) => s.status !== 'waiting')];
  const ready = roster.filter((s) => s.hero?.state === 'ready').length;
  return (
    <div className="tb-screen-body cls-live-layout">
      <section className="cls-join-card" aria-label="How to join">
        <div className="tb-eyebrow">Join the class</div>
        <Qr text={url} fit={720} label="Scan to join the class" />
        <div className="cls-or">or go to</div>
        <div className="cls-join-url">
          {/* Breaks only after a dot, and keeps the domain whole:
              "heromaker.up." / "railway.app/join", never "railw|ay". */}
          {host.split('.').map((part, i, all) => (
            <Fragment key={i}>{part}{i < all.length - 2 ? <>.<wbr /></> : i === all.length - 2 ? '.' : null}</Fragment>
          ))}<span>/join</span>
        </div>
        <PinDigits pin={session.pin} />
      </section>
      <section className="cls-roster cls-live-grid" aria-label="Students">
        <div className="cls-stats">
          <span className={`cls-stat cls-stat--sun${left < 120 ? ' cls-stat--low' : ''}`}><Icon name="clock" /><span className="cls-time-left">{clock(left)}</span> left</span>
          <span className="cls-stat"><Icon name="users" />{shown.length} joined</span>
          <span className="cls-stat"><Icon name="star" />{ready} of {c.seats} heroes</span>
        </div>
        {ordered.length === 0
          ? <div className="cls-roster-empty">Students appear here as they join.</div>
          : (
            <div className="cls-grid">
              {ordered.map((s, i) => (
                <StudentTile key={s.id} student={s} index={roster.indexOf(s)} busy={busy} eager={i < EAGER_TILES}
                  onOpen={() => s.hero && onOpenHero(s.hero.creation_id)}
                  onApprove={() => onAction(s, 'approve')} onBlock={() => onAction(s, 'block')} />
              ))}
            </div>
          )}
      </section>
    </div>
  );
}

function StartDialog({ c, busy, onClose, onStart }: {
  c: ClassView;
  busy: boolean;
  onClose: () => void;
  onStart: (minutes: number, approveFirst: boolean) => void;
}) {
  const [minutes, setMinutes] = useState(45);
  const [approve, setApprove] = useState(false);
  return (
    <Dialog label={`Start ${c.title} now?`} onClose={onClose}>
      <div className="tb-h2">Start now?</div>
      <div className="tb-muted">Students join with a code. {c.seats_left} seats left.</div>
      <div className="cls-chips" role="radiogroup" aria-label="How long">
        {DURATIONS.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={minutes === m}
            className={`tb-chip cls-chip-lg${minutes === m ? ' tb-chip--on' : ''}`} onClick={() => setMinutes(m)}>{m} min</button>
        ))}
      </div>
      <label className="cls-toggle">
        <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} />
        <span className="cls-toggle-track" />
        Approve each student
      </label>
      <div className="tb-stack">
        <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={onClose}>Not now</button>
        <button type="button" className="tb-btn tb-btn--primary tb-btn--full cls-start-confirm" disabled={busy} onClick={() => onStart(minutes, approve)}>
          <Icon name="play" />Start for {minutes} min
        </button>
      </div>
    </Dialog>
  );
}

function AddSeats({ c, credits, seatPrice, onClose, onPaid }: {
  c: ClassView;
  credits: number | undefined;
  seatPrice: SeatPrice | null;
  onClose: () => void;
  onPaid: (v: ClassView) => void;
}) {
  const [seats, setSeats] = useState(c.seats === 0 ? 25 : 1);
  const [confirm, setConfirm] = useState(false);
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cost = seats * c.hero_cost;
  const short = credits !== undefined && cost > credits;
  const cents = seatPrice ? seatsCents(seatPrice, seats) : 0;
  const pay = async () => {
    setBusy(true);
    try {
      onPaid(await teacherApi.addSeats(c.id, seats));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Payments are unavailable right now.');
      setConfirm(false);
      setBusy(false);
    }
  };
  if (paying && seatPrice) {
    return <PaySeatsDialog seats={seats} cents={cents} title={c.title} seatsBefore={c.seats} onClose={() => setPaying(false)}
      open={() => teacherApi.buySeats(c.id, seats)} />;
  }
  if (confirm) {
    return (
      <Dialog label={`Pay ${cost} credits?`} onClose={() => setConfirm(false)}>
        <div className="tb-h2">Pay {cost} credits?</div>
        <div className="tb-muted">{seats} more {seats === 1 ? 'seat' : 'seats'} for {c.title}.</div>
        <div className="tb-stack">
          <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={() => setConfirm(false)}>Not now</button>
          <button type="button" className="tb-btn tb-btn--primary tb-btn--full" disabled={busy} onClick={pay}><Icon name="coin" />Pay {cost} credits</button>
        </div>
      </Dialog>
    );
  }
  return (
    <Sheet title="Add seats" onClose={onClose}>
      <div className="cls-sheet-body">
        <div className="cls-field-row">
          <div className="tb-field"><label>Seats</label><div className="tb-muted">One hero each</div></div>
          <Stepper value={seats} min={1} max={Math.max(1, 60 - c.seats)} onChange={setSeats} label="Seats" />
        </div>
        {error && <div className="tb-muted" role="alert" style={{ color: 'var(--tb-red)' }}>{error}</div>}
      </div>
      <div className="tb-stack cls-sheet-bar">
        <div className="tb-bar-note">{short ? `You need ${cost} credits. You have ${credits}.` : `${c.hero_cost} credits a seat, paid now`}</div>
        {short && seatPrice
          ? <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={() => window.dispatchEvent(new CustomEvent('credits:buy'))}><Icon name="coin" />Buy credits</button>
          : <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={onClose}>Cancel</button>}
        {short && seatPrice
          ? <button type="button" className="tb-btn tb-btn--primary tb-btn--full cls-pay-seats" onClick={() => setPaying(true)}>
              Pay {dollars(cents)} for {seats} {seats === 1 ? 'seat' : 'seats'}
            </button>
          : short
          ? <button type="button" className="tb-btn tb-btn--primary tb-btn--full" onClick={() => window.dispatchEvent(new CustomEvent('credits:buy'))}><Icon name="coin" />Buy credits</button>
          : <button type="button" className="tb-btn tb-btn--primary tb-btn--full tb-btn--with-trail" onClick={() => setConfirm(true)}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="plus" />Add seats</span>
              <span className="tb-btn-trail"><Icon name="coin" size={18} />{cost}</span>
            </button>}
      </div>
    </Sheet>
  );
}
