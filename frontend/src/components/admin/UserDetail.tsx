import { useCallback, useEffect, useRef, useState } from 'react';
import { api, AdminAction, AdminHero, AdminUserDetail, ApiError, CreationResponse, CreationStepResponse, LedgerTransaction, RemovalReason, paintingFramed } from '../../api/client';
import { HeroTile, SkeletonTile, TileGrid, makingLine, makingPct } from '../tb/HeroTile';
import { Icon, IconName } from '../tb/Icon';
import { Dialog, Sheet, SheetRow } from '../tb/parts';
import { STEP_UI, currentStep, failedStep, heroState, refundWords, stepProgress } from '../tb/pipeline';
import { CreditsSheet, CreditsMode } from './CreditsSheet';
import { shortDate } from './format';

export const REASONS: { id: RemovalReason; label: string }[] = [
  { id: 'inappropriate', label: 'Inappropriate' },
  { id: 'not_a_drawing', label: 'Not a drawing' },
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'other', label: 'Other' },
];
const REASON_LABEL: Record<string, string> = Object.fromEntries(REASONS.map((r) => [r.id, r.label]));

const SCHOOL_TYPE: Record<string, string> = {
  kindergarten: 'Kindergarten',
  primary: 'Primary school',
  after_school: 'After school',
  other: 'Other',
};

/** The API's timestamps are UTC without a zone; read them as UTC. */
function utc(iso: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
}

function when(iso: string): string {
  const d = utc(iso);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

/** One audit row in words: an icon, what happened, and the detail line. */
function describe(a: AdminAction): { icon: IconName; what: string; tone?: 'bad' } {
  const hero = a.details.hero_name ? `“${a.details.hero_name}”` : 'a hero';
  const n = Math.abs(a.amount ?? 0);
  switch (a.action) {
    case 'remove_hero': return { icon: 'hide', what: `Removed ${hero} · ${REASON_LABEL[a.reason ?? ''] ?? 'No reason'}`, tone: 'bad' };
    case 'restore_hero': return { icon: 'redo', what: `Restored ${hero}` };
    case 'grant_credits': return { icon: 'coin', what: `Gave ${n} ${n === 1 ? 'credit' : 'credits'} · balance ${a.details.balance_after ?? '?'}` };
    case 'take_credits': return { icon: 'minus', what: `Took back ${n} ${n === 1 ? 'credit' : 'credits'} · balance ${a.details.balance_after ?? '?'}`, tone: 'bad' };
    case 'set_credits': return { icon: 'coin', what: `Set credits ${a.details.previous_balance ?? '?'} → ${a.details.balance_after ?? '?'}` };
    case 'make_admin': return { icon: 'gear', what: 'Made admin' };
    case 'remove_admin': return { icon: 'gear', what: 'Removed admin' };
    case 'delete_account': return { icon: 'trash', what: 'Deleted the account', tone: 'bad' };
    default: return { icon: 'clock', what: a.action };
  }
}

const STEP_WORD: Record<string, string> = {
  image_processing: 'Reading the drawing',
  openai_render: 'Painting',
  meshy_3d: '3D',
  meshy_rig: 'Animating',
  convert_vrm: 'Packing',
};

/** Rows shown before "Show all": a ticket is nearly always about the last few. */
const LEDGER_FIRST = 12;

/** One ledger row in words: an icon and what it was. */
function describeTx(t: LedgerTransaction): { icon: IconName; what: string } {
  const m = t.metadata ?? {};
  const step = typeof m.step_name === 'string' ? m.step_name : null;
  const stepWord = step ? STEP_WORD[step] ?? STEP_UI[step]?.short ?? step : null;
  switch (t.reason) {
    case 'purchase': return { icon: 'wallet', what: 'Purchase' };
    case 'purchase_refunded': return { icon: 'wallet', what: 'Purchase refunded' };
    case 'spend': return { icon: (step && STEP_UI[step]?.icon) || 'coin', what: stepWord ? `Step charge · ${stepWord}` : 'Step charge' };
    case 'refund': return { icon: 'redo', what: stepWord ? `Refund · ${stepWord} failed` : 'Refund' };
    case 'admin_adjust': return { icon: 'gear', what: t.delta >= 0 ? 'Admin grant' : 'Admin took back' };
    case 'coupon': return { icon: 'ticket', what: 'Coupon' };
    case 'signup_grant': return { icon: 'star', what: 'Welcome credits' };
    case 'class_seats': return { icon: 'school', what: t.delta < 0 ? 'Class seats paid' : 'Class seats' };
    case 'opening_balance': return { icon: 'clock', what: 'Opening balance' };
    case 'account_deleted': return { icon: 'trash', what: 'Account deleted' };
    default: return { icon: 'coin', what: t.reason };
  }
}

/**
 * Every credit movement on the account, newest first: purchases, step
 * charges, refunds, admin grants, coupons. The answer to "was I charged?".
 */
function CreditsList({ userId, heroes, version }: { userId: string; heroes: AdminHero[]; version: number }) {
  const [txs, setTxs] = useState<LedgerTransaction[] | null>(null);
  const [error, setError] = useState(false);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let live = true;
    api.admin.userLedger(userId)
      .then((r) => { if (live) { setTxs(r.transactions); setError(false); } })
      .catch(() => { if (live) { setError(true); setTxs((t) => t ?? []); } });
    return () => { live = false; };
  }, [userId, version]);
  const names = new Map(heroes.map((h) => [h.id, adminHeroName(h)]));
  return (
    <section className="adm-card" aria-label="Credits" data-testid="ledger">
      <h2 className="adm-title">Credits</h2>
      {txs === null ? (
        <><div className="adm-skel adm-skel-row" /><div className="adm-skel adm-skel-row" /><div className="adm-skel adm-skel-row" /></>
      ) : error ? (
        <div className="adm-note adm-note--bad">Credit history is unavailable right now.</div>
      ) : txs.length === 0 ? (
        <div className="adm-note">No credit movements yet.</div>
      ) : (all ? txs : txs.slice(0, LEDGER_FIRST)).map((t) => {
        const d = describeTx(t);
        const hero = t.creation_id ? names.get(t.creation_id) : undefined;
        const note = typeof t.metadata?.note === 'string' && t.reason === 'admin_adjust' ? t.metadata.note : null;
        return (
          <div key={t.id} className="adm-row adm-audit-row adm-ledger-row">
            <span className={`adm-audit-icon${t.delta < 0 ? ' adm-audit-icon--bad' : ''}`}><Icon name={d.icon} size={20} /></span>
            <span className="adm-row-label">
              <span dir="auto">{d.what}{hero ? ` · ${hero}` : ''}</span>
              {note && <span className="adm-audit-note" dir="auto">“{note}”</span>}
              <small>{t.created_at ? when(t.created_at) : ''} · balance {t.balance_after}</small>
            </span>
            <span className={`adm-row-value${t.delta < 0 ? ' adm-bad' : ''}`}>{t.delta > 0 ? `+${t.delta}` : t.delta < 0 ? `−${Math.abs(t.delta)}` : '0'}</span>
          </div>
        );
      })}
      {txs && !error && !all && txs.length > LEDGER_FIRST && (
        <button type="button" className="tb-btn tb-btn--secondary adm-btn-xs adm-ledger-more" onClick={() => setAll(true)}>
          Show all {txs.length}
        </button>
      )}
    </section>
  );
}

/**
 * A user's page in the admin console: who they are, their heroes (in
 * progress, failed and removed ones too), what admins did to the account,
 * and the actions: give or take back credits, remove or restore a hero.
 */
export function UserDetail({ userId, currentUserId, onOpenHero, onGone }: {
  userId: string;
  currentUserId: string;
  onOpenHero: (c: CreationResponse) => void;
  /** The account is not there any more (deleted): back to the list. */
  onGone: () => void;
}) {
  const [page, setPage] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [credits, setCredits] = useState<CreditsMode | null>(null);
  const [menu, setMenu] = useState<AdminHero | null>(null);
  const [removing, setRemoving] = useState<AdminHero | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const gone = useRef(onGone);
  gone.current = onGone;

  const load = useCallback(async () => {
    try {
      setPage(await api.admin.userDetail(userId));
      setVersion((v) => v + 1);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) { gone.current(); return; }
      setError(e instanceof ApiError ? e.message : 'Could not load this user.');
    }
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  const restore = async (h: AdminHero) => {
    setMenu(null);
    setBusy(true);
    try {
      await api.admin.restoreHero(h.id);
      setNotice(`${adminHeroName(h)} is back.`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!page) {
    return (
      <>
        {error ? <div className="adm-error" role="alert">{error}</div> : <div className="adm-card adm-skel" style={{ height: 150 }} />}
        <TileGrid>{Array.from({ length: 4 }, (_, i) => <SkeletonTile key={i} index={i} />)}</TileGrid>
      </>
    );
  }

  const u = page.user;
  const who = u.name || u.username;
  const place = u.school ? [u.school.name, [u.school.city, u.school.country].filter(Boolean).join(', '), u.school.type ? SCHOOL_TYPE[u.school.type] ?? u.school.type : null].filter(Boolean).join(' · ') : null;

  return (
    <>
      <section className="adm-card adm-profile" aria-label="Account">
        <div className="adm-profile-name" dir="auto">{who}</div>
        <div className="adm-user-email">{u.name ? `${u.username} · ` : ''}{u.email ?? 'No email'}</div>
        <div className="adm-user-email">Joined {shortDate(u.created_at)}, {utc(u.created_at).getFullYear()}</div>
        {(u.is_admin || u.is_teacher || u.is_test_account || u.id === currentUserId) && (
          <div className="adm-coupon-head">
            {u.is_admin && <span className="adm-pill">Admin</span>}
            {u.is_teacher && <span className="adm-pill adm-pill--active">Teacher</span>}
            {u.is_test_account && <span className="adm-pill adm-pill--off">Test</span>}
            {u.id === currentUserId && <span className="adm-pill adm-pill--active">You</span>}
          </div>
        )}
        <div className="adm-stats">
          <div className="adm-stat"><span className="adm-stat-num adm-stat-num--credits" data-testid="balance"><Icon name="coin" size={22} />{u.credits}</span><span className="adm-stat-label">credits</span></div>
          {/* The same numbers as this user's card on the list (backend users.hero_stats). */}
          <div className="adm-stat"><span className="adm-stat-num">{page.counts.heroes}</span><span className="adm-stat-label">{page.counts.heroes === 1 ? 'hero' : 'heroes'}</span></div>
          {page.counts.failed > 0 && <div className="adm-stat"><span className="adm-stat-num adm-bad">{page.counts.failed}</span><span className="adm-stat-label">failed</span></div>}
          {page.counts.in_progress > 0 && <div className="adm-stat"><span className="adm-stat-num">{page.counts.in_progress}</span><span className="adm-stat-label">making</span></div>}
          {page.counts.removed > 0 && <div className="adm-stat"><span className="adm-stat-num adm-bad">{page.counts.removed}</span><span className="adm-stat-label">removed</span></div>}
        </div>
        {(u.is_teacher || u.school) && (
          <div className="adm-school"><Icon name="school" size={20} /><span>{place ?? 'No school yet'}{` · ${u.classes} ${u.classes === 1 ? 'class' : 'classes'}`}</span></div>
        )}
      </section>

      {notice && (
        <div className="adm-done" role="status"><Icon name="check" size={20} /><span>{notice}</span></div>
      )}
      {error && <div className="adm-error" role="alert">{error}</div>}

      <h2 className="adm-title adm-section-title">Heroes</h2>
      {page.heroes.length === 0 ? (
        <div className="adm-card adm-empty"><Icon name="image" size={28} />No heroes yet</div>
      ) : (
        <TileGrid>
          {page.heroes.map((h, i) => (
            <div key={h.id} className={`adm-tile-wrap${h.removed ? ' adm-tile-wrap--removed' : ''}`} data-removed={h.removed ? 'true' : undefined}>
              <AdminTile hero={h} index={i} onClick={() => onOpenHero(h)} />
              {h.removed && <span className="adm-tile-badge">Removed</span>}
              <button type="button" className="adm-tile-more" aria-label={`More for ${adminHeroName(h)}`} title="More" onClick={() => setMenu(h)}>
                <span className="adm-tile-more-dot"><Icon name="more" size={20} /></span>
              </button>
            </div>
          ))}
        </TileGrid>
      )}

      <CreditsList userId={userId} heroes={page.heroes} version={version} />

      <section className="adm-card" aria-label="History">
        <h2 className="adm-title">History</h2>
        {page.audit.length === 0 ? (
          <div className="adm-note">Nothing yet. Admin actions show here.</div>
        ) : page.audit.map((a) => {
          const d = describe(a);
          return (
            <div key={a.id} className="adm-row adm-audit-row">
              <span className={`adm-audit-icon${d.tone === 'bad' ? ' adm-audit-icon--bad' : ''}`}><Icon name={d.icon} size={20} /></span>
              <span className="adm-row-label">
                <span dir="auto">{d.what}</span>
                {a.note && <span className="adm-audit-note" dir="auto">“{a.note}”</span>}
                <small>by {a.admin.username ?? 'an admin'} · {when(a.created_at)}</small>
              </span>
            </div>
          );
        })}
      </section>

      <div className="tb-bar adm-bar">
        <div className="tb-bar-row">
          <button type="button" className="tb-btn tb-btn--secondary" disabled={u.credits <= 0} onClick={() => setCredits('take')}>
            <Icon name="minus" />Take back
          </button>
          <button type="button" className="tb-btn tb-btn--primary" onClick={() => setCredits('give')}>
            <Icon name="coin" />Give credits
          </button>
        </div>
      </div>

      {credits && (
        <CreditsSheet
          user={u}
          mode={credits}
          onClose={() => setCredits(null)}
          onDone={(balance) => {
            setNotice(`${credits === 'give' ? 'Credits given' : 'Credits taken back'}. ${who} now has ${balance}.`);
            setCredits(null);
            load();
            // Admins give themselves credits too: the header and "Make this
            // hero?" re-read the balance.
            window.dispatchEvent(new CustomEvent('credits:changed'));
          }}
        />
      )}

      {menu && (
        <Sheet title={adminHeroName(menu)} onClose={() => setMenu(null)}>
          {menu.removed && (
            <div className="tb-muted adm-sheet-sub">
              Removed · {REASON_LABEL[menu.removed.reason ?? ''] ?? 'No reason'}{menu.removed.note ? ` · “${menu.removed.note}”` : ''}
            </div>
          )}
          <SheetRow icon="image" label="Open hero" onClick={() => { const h = menu; setMenu(null); onOpenHero(h); }} />
          <div className="tb-sheet-divider" />
          {menu.removed
            ? <SheetRow icon="redo" label="Restore hero" onClick={() => restore(menu)} />
            : <SheetRow icon="hide" label="Remove hero" danger onClick={() => { setRemoving(menu); setMenu(null); }} />}
        </Sheet>
      )}

      {removing && (
        <RemoveSheet
          hero={removing}
          busy={busy}
          onClose={() => setRemoving(null)}
          onRemove={async (reason, note) => {
            setBusy(true);
            try {
              await api.admin.removeHero(removing.id, reason, note);
              setNotice(`${adminHeroName(removing)} is removed. Only admins can see it.`);
              setRemoving(null);
              await load();
            } catch (e) {
              setError(e instanceof ApiError ? e.message : 'That did not work. Try again.');
              setRemoving(null);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </>
  );
}

/**
 * A hero's name on the user's page. Unnamed heroes were all "Your hero":
 * support could not tell them apart, so they read as when they were made.
 */
function adminHeroName(h: AdminHero): string {
  return h.character_name || when(h.created_at);
}

/** "3D failed · refunded 5": the step, and what it did to the bill. */
function failedTileLine(step: CreationStepResponse | undefined): string {
  if (!step) return 'Didn’t finish';
  const word = STEP_WORD[step.step_name] ?? STEP_UI[step.step_name]?.short ?? 'Making';
  return `${word} failed · ${refundWords(step)}`;
}

/** A hero on the user's page: the gallery's tile, with what an admin needs on its second line. */
function AdminTile({ hero, index, onClick }: { hero: AdminHero; index: number; onClick: () => void }) {
  const state = heroState(hero);
  const name = adminHeroName(hero);
  const file = (f: string) => api.heroFileUrl(hero, f);
  const step = currentStep(hero);
  const done = hero.steps.filter((s) => s.status === 'completed').length;
  const progress = stepProgress(step);
  const painted = hero.steps.find((s) => s.step_name === 'openai_render')?.status === 'completed';
  const drawing = file('thumb_original.jpg');
  const art = state === 'ready' || (state === 'making' && painted)
    ? { kind: 'fade' as const, drawing, hero: file('thumb_rendered.png'), framed: paintingFramed(hero) }
    : { kind: 'drawing' as const, src: drawing };
  const by = hero.class_title ? `in ${hero.class_title}` : hero.name ? `by ${hero.name}${hero.age ? `, ${hero.age}` : ''}` : '';
  const line = hero.removed ? (REASON_LABEL[hero.removed.reason ?? ''] ?? 'Removed')
    : state === 'ready' ? by
    : state === 'making' ? makingLine(step ? STEP_UI[step.step_name]?.short : undefined,
      makingPct(done, hero.steps.length, step?.status === 'processing', progress?.real ? progress.pct / 100 : undefined))
    : state === 'failed' ? failedTileLine(failedStep(hero))
    : 'Not started';
  return (
    <HeroTile
      art={art}
      alt={name}
      index={index}
      eager={index < 6}
      title={name}
      line={line}
      tone={hero.removed || state === 'failed' ? 'failed' : state === 'ready' ? 'by' : 'now'}
      faded={!!hero.removed || state === 'failed'}
      state={hero.removed ? 'removed' : state}
      onClick={onClick}
      label={`Open ${name}${hero.removed ? ' (removed)' : ''}`}
    />
  );
}

/**
 * Remove a hero: why, from a short list (Other needs a note), then a
 * confirmation, as deleting does. It can be restored afterwards.
 */
function RemoveSheet({ hero, busy, onClose, onRemove }: {
  hero: AdminHero;
  busy: boolean;
  onClose: () => void;
  onRemove: (reason: RemovalReason, note: string) => void;
}) {
  const [reason, setReason] = useState<RemovalReason | null>(null);
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const name = adminHeroName(hero);
  const valid = reason !== null && (reason !== 'other' || note.trim().length > 0);
  return (
    <>
      <Sheet title={`Remove ${name}`} onClose={onClose} className="adm-remove-sheet">
        <div className="adm-form">
          <div className="adm-reasons" role="radiogroup" aria-label="Reason">
            {REASONS.map((r) => (
              <button key={r.id} type="button" role="radio" aria-checked={reason === r.id}
                className={`tb-chip adm-reason${reason === r.id ? ' tb-chip--on' : ''}`} onClick={() => setReason(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
          <div className="tb-field">
            <label htmlFor="adm-remove-note">{reason === 'other' ? 'Note (required)' : 'Note (optional)'}</label>
            <textarea id="adm-remove-note" className="tb-input adm-textarea" rows={2} maxLength={500}
              placeholder="What you saw" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="tb-bar-note">Hidden from the gallery, classes and games.</div>
          <button type="button" className="tb-btn tb-btn--danger tb-btn--full" disabled={!valid || busy} onClick={() => setConfirming(true)}>
            <Icon name="hide" />Remove
          </button>
        </div>
      </Sheet>
      {confirming && reason && (
        <Dialog label={`Remove ${name}?`} onClose={() => setConfirming(false)}>
          <div className="tb-h2">Remove {name}?</div>
          <div className="tb-muted">Only admins will see it. You can restore it.</div>
          <div className="tb-stack">
            <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={() => setConfirming(false)}>Keep it</button>
            <button type="button" className="tb-btn tb-btn--danger tb-btn--full" disabled={busy} onClick={() => onRemove(reason, note.trim())}>
              <Icon name="hide" />Remove
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
