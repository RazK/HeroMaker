import { useCallback, useEffect, useState } from 'react';
import { api, LemonSqueezyCheck } from '../../api/client';
import { Icon } from '../tb/Icon';
import { shortDate, usd } from './format';

/**
 * Lemon Squeezy's own last 30 days beside our payment rows. Our income comes
 * only from the webhook, so an order here with no row of ours is a missed or
 * failed webhook. Backend: app/services/lemonsqueezy_check.py.
 */
export function LemonSqueezyCheckCard() {
  const [check, setCheck] = useState<LemonSqueezyCheck | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh: boolean) => {
    setRefreshing(true);
    try {
      setCheck(await api.admin.lemonSqueezyCheck(refresh));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  return (
    <section className="adm-card" aria-label="Lemon Squeezy check">
      <div className="adm-title-row">
        <h2 className="adm-title">Lemon Squeezy check</h2>
        <button type="button" className="tb-btn tb-btn--secondary adm-btn-xs" disabled={refreshing} onClick={() => load(true)}>
          <Icon name="redo" size={18} />{refreshing ? 'Checking' : 'Refresh'}
        </button>
      </div>
      {failed && !check
        ? <div className="adm-note adm-note--bad">The Lemon Squeezy check is unavailable right now.</div>
        : !check
          ? <><div className="adm-skel adm-skel-row" /><div className="adm-skel adm-skel-row" /></>
          : <CheckBody c={check} />}
    </section>
  );
}

function ModePill({ mode }: { mode: 'test' | 'live' }) {
  return <span className={`adm-pill${mode === 'live' ? ' adm-pill--live' : ''}`}>{mode === 'live' ? 'Live' : 'Test'}</span>;
}

function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

function orderName(n: number | null, id: string) {
  return n != null ? `Order #${n}` : `Order ${id}`;
}

// Rows listed before "Show all": a long backlog should not push the bills off the screen.
const FIRST_ROWS = 5;

function CheckBody({ c }: { c: LemonSqueezyCheck }) {
  const [all, setAll] = useState(false);
  if (c.status !== 'ok' || !c.orders || !c.ours) {
    return (
      <div className="adm-row adm-row--provider">
        <span className="adm-row-label">
          Lemon Squeezy
          {c.hint && <small className={c.status === 'error' ? 'adm-bad' : ''}>{c.hint}</small>}
        </span>
        <span className={`adm-pill${c.status === 'error' ? ' adm-pill--bad' : ''}`}>
          {c.status === 'error' ? 'Unavailable' : 'Not connected'}
        </span>
      </div>
    );
  }

  const missing = c.missing ?? [];
  const unknown = c.unknown_payments ?? [];
  const extra = missing.length + unknown.length - FIRST_ROWS;
  const shownMissing = all ? missing : missing.slice(0, FIRST_ROWS);
  const shownUnknown = all ? unknown : unknown.slice(0, Math.max(0, FIRST_ROWS - missing.length));
  return (
    <>
      <div className="adm-ls-pair">
        <div className="adm-ls-side">
          <div className="adm-eyebrow">Lemon Squeezy</div>
          <div className="adm-ls-amount">{usd(c.orders.gross_usd_micros)}</div>
          <div className="adm-ls-count">{plural(c.orders.count, 'order', 'orders')}</div>
        </div>
        <div className="adm-ls-side">
          <div className="adm-eyebrow">Our records</div>
          <div className="adm-ls-amount">{usd(c.ours.gross_usd_micros)}</div>
          <div className="adm-ls-count">{plural(c.ours.count, 'payment', 'payments')}</div>
        </div>
      </div>

      <div className="adm-ls-status">
        {c.matches && <span className="adm-pill adm-pill--active"><Icon name="check" size={16} />Matches</span>}
        {missing.length > 0 && <span className="adm-pill adm-pill--warn">{plural(missing.length, 'order', 'orders')} not recorded</span>}
        {unknown.length > 0 && <span className="adm-pill adm-pill--warn">{plural(unknown.length, 'payment', 'payments')} not at Lemon Squeezy</span>}
        <ModePill mode={c.mode} />
        <span className="adm-ls-window">Last {c.window_days ?? 30} days</span>
      </div>

      {shownMissing.map((o) => (
        <div key={`m-${o.order_id}`} className="adm-row">
          <span className="adm-row-label">
            {orderName(o.order_number, o.order_id)}
            <small className="adm-warn">{shortDate(o.created_at)} · {o.status === 'paid' ? 'no payment row' : `${o.status.replace('_', ' ')}, no payment row`}</small>
          </span>
          <span className="adm-row-value">{usd(o.total_usd_micros)}</span>
        </div>
      ))}
      {shownUnknown.map((p) => (
        <div key={`u-${p.order_id}`} className="adm-row">
          <span className="adm-row-label">
            {orderName(p.order_number, p.order_id)}
            <small className="adm-warn">{shortDate(p.created_at)} · not at Lemon Squeezy</small>
          </span>
          <span className="adm-row-value">{usd(p.gross_usd_micros)}</span>
        </div>
      ))}

      {!all && extra > 0 && (
        <button type="button" className="tb-btn tb-btn--secondary adm-btn-xs adm-ls-more" onClick={() => setAll(true)}>
          Show all {missing.length + unknown.length}
        </button>
      )}
      {c.orders.truncated &&<div className="adm-note">Only the newest {c.orders.max_orders} orders were checked.</div>}
      {c.hint && <div className="adm-note adm-warn">{c.hint}</div>}
      {/* The store's own totals count live sales only; in test mode they read 0. */}
      {c.store && c.mode === 'live' && (
        <div className="adm-note">
          Store totals: {plural(c.store.thirty_day_sales, 'sale', 'sales')} · {usd(c.store.thirty_day_revenue_usd_micros)} in 30 days, {usd(c.store.total_revenue_usd_micros)} all time.
        </div>
      )}
    </>
  );
}
