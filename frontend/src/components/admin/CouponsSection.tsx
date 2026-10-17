import { useCallback, useEffect, useState } from 'react';
import { api, AdminCouponResponse, ApiError } from '../../api/client';
import { Icon } from '../tb/Icon';
import { Dialog, NavButton, Sheet, SheetRow } from '../tb/parts';
import { shortDate } from './format';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
function newCode(): string {
  const bytes = new Uint32Array(6);
  crypto.getRandomValues(bytes);
  return 'HERO-' + Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

const CREDIT_PRESETS = [10, 25, 50, 100];

type CouponState = 'active' | 'off' | 'expired' | 'used';

function couponState(c: AdminCouponResponse): CouponState {
  if (!c.is_active) return 'off';
  if (c.expires_at && new Date(c.expires_at) < new Date()) return 'expired';
  if (c.current_uses >= c.max_uses) return 'used';
  return 'active';
}

const STATE_LABEL: Record<CouponState, string> = { active: 'Active', off: 'Off', expired: 'Expired', used: 'Used up' };

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CouponsSection() {
  const [coupons, setCoupons] = useState<AdminCouponResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<AdminCouponResponse | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AdminCouponResponse | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCoupons(await api.admin.listCoupons());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load coupons.');
      setCoupons((c) => c ?? []);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const onCopy = async (code: string) => {
    if (await copy(code)) {
      setCopied(code);
      window.setTimeout(() => setCopied((c) => (c === code ? null : c)), 1600);
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    setMenu(null);
    setConfirmDelete(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That did not work. Try again.');
    }
    load();
  };

  const redeemed = coupons?.reduce((n, c) => n + c.current_uses, 0) ?? 0;
  const live = coupons?.filter((c) => couponState(c) === 'active').length ?? 0;

  return (
    <>
      {error && <div className="adm-error" role="alert">{error}</div>}

      {coupons === null ? (
        <><div className="adm-card adm-skel" style={{ height: 96 }} /><div className="adm-card adm-skel" style={{ height: 96 }} /></>
      ) : coupons.length === 0 ? (
        <div className="adm-card adm-empty">
          <Icon name="ticket" size={36} />
          <div>No coupons yet.</div>
        </div>
      ) : (
        <>
          <div className="adm-summary-line">{live} active · {redeemed} redeemed</div>
          {coupons.map((c) => {
            const state = couponState(c);
            return (
              <div key={c.id} className={`adm-card adm-coupon adm-coupon--${state}`}>
                <div className="adm-coupon-head">
                  <span className="adm-coupon-code">{c.code}</span>
                  <span className={`adm-pill adm-pill--${state}`}>{STATE_LABEL[state]}</span>
                </div>
                <div className="adm-coupon-foot">
                  <div className="adm-coupon-meta">
                    <span className="adm-coupon-credits"><Icon name="coin" size={16} />{c.credit_amount}</span>
                    <span>{c.current_uses} of {c.max_uses} used</span>
                    {c.expires_at && <span>until {shortDate(c.expires_at)}</span>}
                  </div>
                  <div className="adm-coupon-actions">
                  <button type="button" className="tb-btn tb-btn--secondary adm-btn-xs" onClick={() => onCopy(c.code)}>
                    <Icon name={copied === c.code ? 'check' : 'copy'} size={18} />{copied === c.code ? 'Copied' : 'Copy'}
                  </button>
                  <NavButton icon="more" label={`More for ${c.code}`} className="adm-nav-sm" onClick={() => setMenu(c)} />
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}

      <div className="tb-bar adm-bar">
        <button type="button" className="tb-btn tb-btn--primary tb-btn--full" onClick={() => setCreating(true)}>
          <Icon name="plus" />New coupon
        </button>
      </div>

      {menu && (
        <Sheet title={menu.code} onClose={() => setMenu(null)}>
          <SheetRow icon="copy" label="Copy code" onClick={() => { onCopy(menu.code); setMenu(null); }} />
          <SheetRow
            icon="ticket"
            label={menu.is_active ? 'Turn off' : 'Turn on'}
            onClick={() => act(() => api.admin.updateCoupon(menu.id, { is_active: !menu.is_active }))}
          />
          <div className="tb-sheet-divider" />
          <SheetRow icon="trash" label="Delete coupon" danger onClick={() => { setConfirmDelete(menu); setMenu(null); }} />
        </Sheet>
      )}

      {confirmDelete && (
        <Dialog label={`Delete ${confirmDelete.code}?`} onClose={() => setConfirmDelete(null)}>
          <div className="tb-h2">Delete {confirmDelete.code}?</div>
          <div className="tb-muted">Credits already redeemed stay. This can’t be undone.</div>
          <div className="tb-stack">
            <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={() => setConfirmDelete(null)}>Keep it</button>
            <button type="button" className="tb-btn tb-btn--danger tb-btn--full" onClick={() => act(() => api.admin.deleteCoupon(confirmDelete.id))}>
              <Icon name="trash" />Delete
            </button>
          </div>
        </Dialog>
      )}

      {creating && (
        <NewCouponSheet
          onClose={() => setCreating(false)}
          onCreated={(c) => { load(); onCopy(c.code); }}
        />
      )}
    </>
  );
}

function NewCouponSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (c: AdminCouponResponse) => void }) {
  const [code, setCode] = useState(newCode);
  const [credits, setCredits] = useState('25');
  const [uses, setUses] = useState('1');
  const [expires, setExpires] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<AdminCouponResponse | null>(null);

  const creditsN = parseInt(credits, 10);
  const usesN = parseInt(uses, 10);
  const valid = code.trim().length > 0 && creditsN > 0 && usesN > 0;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const c = await api.admin.createCoupon({
        code: code.trim().toUpperCase(),
        credit_amount: creditsN,
        max_uses: usesN,
        allow_multiple_per_user: repeat,
        // End of the chosen day, in the admin's own time zone.
        expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : undefined,
      });
      setMade(c);
      onCreated(c);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create the coupon.');
    } finally {
      setBusy(false);
    }
  };

  if (made) {
    return (
      <Sheet title="Coupon ready" onClose={onClose}>
        <div className="adm-form">
          <div className="adm-made">
            <div className="adm-coupon-code adm-coupon-code--big">{made.code}</div>
            <div className="tb-muted">{made.credit_amount} credits · {made.max_uses === 1 ? 'one use' : `${made.max_uses} uses`}</div>
          </div>
          <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={() => copy(made.code)}>
            <Icon name="copy" />Copy code
          </button>
          <button type="button" className="tb-btn tb-btn--primary tb-btn--full" onClick={onClose}>Done</button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="New coupon" onClose={onClose}>
      <div className="adm-form">
        <div className="tb-field">
          <label htmlFor="cp-credits">Credits</label>
          <div className="adm-chips adm-chips--tight">
            {CREDIT_PRESETS.map((n) => (
              <button key={n} type="button" className={`tb-chip${creditsN === n ? ' tb-chip--on' : ''}`} aria-pressed={creditsN === n} onClick={() => setCredits(String(n))}>{n}</button>
            ))}
          </div>
          <input id="cp-credits" className="tb-input" type="number" inputMode="numeric" min="1" value={credits} onChange={(e) => setCredits(e.target.value)} />
        </div>
        <div className="adm-form-pair">
          <div className="tb-field">
            <label htmlFor="cp-uses">Uses</label>
            <input id="cp-uses" className="tb-input" type="number" inputMode="numeric" min="1" value={uses} onChange={(e) => setUses(e.target.value)} />
          </div>
          <div className="tb-field">
            <label htmlFor="cp-expires">Expires</label>
            <input id="cp-expires" className="tb-input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </div>
        </div>
        <div className="tb-field">
          <label htmlFor="cp-code">Code</label>
          <div className="adm-code-field">
            <input id="cp-code" className="tb-input adm-code-input" value={code} maxLength={64} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <button type="button" className="tb-btn tb-btn--secondary adm-btn-xs" onClick={() => setCode(newCode())}>
              <Icon name="redo" size={18} />New
            </button>
          </div>
        </div>
        {usesN > 1 && (
          <label className="adm-check">
            <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
            One person may use it more than once
          </label>
        )}
        {error && <div className="adm-error" role="alert">{error}</div>}
        <button type="button" className="tb-btn tb-btn--primary tb-btn--full" disabled={!valid || busy} onClick={create}>
          <Icon name="ticket" />Create coupon
        </button>
      </div>
    </Sheet>
  );
}
