import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, MoneyPeriod, MoneySummary, ProviderBalance, RecurringExpense } from '../../api/client';
import { Icon } from '../tb/Icon';
import { Dialog, Sheet, SheetRow } from '../tb/parts';
import { providerName, shortDate, todayIso, usd } from './format';
import { LemonSqueezyCheckCard } from './LemonSqueezyCheckCard';

const PERIODS: { id: MoneyPeriod; label: string }[] = [
  { id: 'month', label: 'This month' },
  { id: '30d', label: '30 days' },
  { id: 'all', label: 'All time' },
];

export function MoneySection() {
  const [period, setPeriod] = useState<MoneyPeriod>('month');
  const [summary, setSummary] = useState<MoneySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderBalance[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<RecurringExpense | 'new' | null>(null);

  const loadSummary = useCallback(async (p: MoneyPeriod) => {
    setError(null);
    try {
      setSummary(await api.admin.moneySummary(p));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the numbers.');
    }
  }, []);

  const loadProviders = useCallback(async (refresh: boolean) => {
    setRefreshing(true);
    try {
      setProviders(await api.admin.providerBalances(refresh));
    } catch {
      setProviders([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { setSummary(null); loadSummary(period); }, [period, loadSummary]);
  useEffect(() => { loadProviders(false); }, [loadProviders]);

  const s = summary;
  const empty = (providers ?? []).filter((p) => p.status === 'ok' && p.out_of_credit);
  const income = s ? s.income.live.net_usd_micros - s.income.refunds.net_usd_micros : 0;

  return (
    <>
      {empty.map((p) => (
        <div key={p.provider} className="adm-error adm-alert" role="alert" data-testid="provider-out">
          <Icon name="coin" size={22} />
          <span>{providerName(p.provider)} is out of credit: {p.out_of_credit_effect ?? 'its steps fail'}</span>
        </div>
      ))}

      <div className="adm-chips" role="group" aria-label="Period">
        {PERIODS.map((p) => (
          <button key={p.id} type="button" className={`tb-chip${period === p.id ? ' tb-chip--on' : ''}`} aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>
            {p.label}
          </button>
        ))}
      </div>

      {error && <div className="adm-error" role="alert">{error}</div>}

      {!s && !error ? (
        <><div className="adm-card adm-skel" style={{ height: 132 }} /><div className="adm-card adm-skel" style={{ height: 210 }} /><div className="adm-card adm-skel" style={{ height: 180 }} /></>
      ) : s && (
        <>
          <section className={`adm-card adm-net ${s.net_usd_micros < 0 ? 'adm-net--neg' : 'adm-net--pos'}`} aria-label="Net">
            <div className="adm-eyebrow">Net</div>
            <div className="adm-big">{usd(s.net_usd_micros, { signed: true })}</div>
            <div className="adm-net-line">
              <span>In {usd(income)}</span>
              <span>Out {usd(s.costs.total_usd_micros)}</span>
            </div>
          </section>

          <section className="adm-card">
            <h2 className="adm-title">Income</h2>
            <Row label={`Sales · ${s.income.live.count}`} value={usd(s.income.live.gross_usd_micros)} />
            <Row label="Lemon Squeezy fees (est.)" value={usd(-s.income.live.fee_usd_micros)} />
            {s.income.refunds.count > 0 && <Row label={`Refunds · ${s.income.refunds.count}`} value={usd(-s.income.refunds.net_usd_micros)} />}
            <Row label="Kept" value={usd(income)} strong />
            {s.income.test.count > 0 && (
              <div className="adm-note">Test orders: {s.income.test.count} · {usd(s.income.test.gross_usd_micros)}, not counted</div>
            )}
          </section>

          <section className="adm-card">
            <h2 className="adm-title">Costs</h2>
            {s.costs.providers.length === 0 && <div className="adm-note">No paid calls in this period.</div>}
            {s.costs.providers.map((p) => (
              <Row key={p.provider} label={`${providerName(p.provider)} · ${p.calls} calls`} value={usd(p.cost_usd_micros)} />
            ))}
            <Row label="Monthly bills" value={usd(s.costs.recurring_usd_micros)} />
            <Row label="Total" value={usd(s.costs.total_usd_micros)} strong />
            <div className="adm-note">Calls priced at list price{s.costs.prices_last_checked ? `, checked ${shortDate(s.costs.prices_last_checked)}` : ''}.</div>
          </section>

          <section className="adm-card">
            <h2 className="adm-title">Credits people hold</h2>
            <div className="adm-big adm-big--sm"><Icon name="coin" size={26} />{s.credits_held.credits.toLocaleString('en-US')}</div>
            {s.credits_held.cost_to_serve_usd_micros !== null && (
              <div className="adm-note">About {usd(s.credits_held.cost_to_serve_usd_micros)} of provider cost still to deliver.</div>
            )}
          </section>
        </>
      )}

      <section className="adm-card">
        <div className="adm-title-row">
          <h2 className="adm-title">At the providers</h2>
          <button type="button" className="tb-btn tb-btn--secondary adm-btn-xs" disabled={refreshing} onClick={() => loadProviders(true)}>
            <Icon name="redo" size={18} />{refreshing ? 'Checking' : 'Refresh'}
          </button>
        </div>
        {providers === null
          ? <><div className="adm-skel adm-skel-row" /><div className="adm-skel adm-skel-row" /><div className="adm-skel adm-skel-row" /></>
          : providers.length === 0
            ? <div className="adm-note adm-note--bad">Provider figures are unavailable right now.</div>
            : providers.map((p) => <ProviderRow key={p.provider} p={p} />)}
      </section>

      <LemonSqueezyCheckCard />

      {s && (
        <section className="adm-card">
          <div className="adm-title-row">
            <h2 className="adm-title">Monthly bills</h2>
            <span className="adm-title-trail">{usd(s.recurring.monthly_total_usd_micros)} / mo</span>
          </div>
          {s.recurring.items.length === 0 && <div className="adm-note">None yet. Add hosting, domain and other fixed costs.</div>}
          {s.recurring.items.map((r) => (
            <button key={r.id} type="button" className={`adm-row adm-row--tap${r.is_active ? '' : ' adm-row--off'}`} onClick={() => setEditing(r)}>
              <span className="adm-row-label">
                {r.name}
                <small>{r.is_active ? `Next ${shortDate(r.next_charge_on)}` : 'Paused'}</small>
              </span>
              <span className="adm-row-value">{usd(r.amount_usd_micros)}</span>
              <Icon name="pencil" size={18} />
            </button>
          ))}
          {s.recurring.upcoming.length > 0 && (
            <div className="adm-note">Due in the next 30 days: {usd(s.recurring.upcoming_total_usd_micros)}</div>
          )}
        </section>
      )}

      <div className="tb-bar adm-bar">
        <button type="button" className="tb-btn tb-btn--primary tb-btn--full" onClick={() => setEditing('new')}>
          <Icon name="plus" />Add a bill
        </button>
      </div>

      {editing && (
        <BillSheet
          bill={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadSummary(period); }}
        />
      )}
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`adm-row${strong ? ' adm-row--total' : ''}`}>
      <span className="adm-row-label">{label}</span>
      <span className="adm-row-value">{value}</span>
    </div>
  );
}

function ProviderRow({ p }: { p: ProviderBalance }) {
  let value = '';
  let detail: string | null = null;
  if (p.status === 'ok') {
    if (p.provider === 'meshy') {
      value = `${(p.credits ?? 0).toLocaleString('en-US')} credits`;
      detail = `≈ ${usd(p.value_usd_micros)}${p.monthly_resets_at ? ` · resets ${shortDate(p.monthly_resets_at)}` : ''}`;
    } else if (p.provider === 'openai') {
      value = usd(p.month_to_date_usd_micros);
      detail = 'Spent this month';
    } else if (p.provider === 'railway') {
      value = usd(p.current_usage_usd_micros);
      detail = p.projected_usage_usd_micros != null
        ? `This cycle · ≈ ${usd(p.projected_usage_usd_micros)} by ${shortDate(p.period_end)}`
        : 'This cycle';
    }
  }
  return (
    <div className="adm-row adm-row--provider">
      <span className="adm-row-label">
        {providerName(p.provider)}
        {p.status === 'ok' && detail && <small>{detail}</small>}
        {p.status !== 'ok' && p.hint && <small className={p.status === 'error' ? 'adm-bad' : ''}>{p.hint}</small>}
      </span>
      {p.status === 'ok'
        ? <span className={`adm-row-value${p.out_of_credit ? ' adm-bad' : ''}`}>{value}</span>
        : <span className={`adm-pill${p.status === 'error' ? ' adm-pill--bad' : ''}`}>{p.status === 'error' ? 'Error' : 'Not connected'}</span>}
    </div>
  );
}

function BillSheet({ bill, onClose, onSaved }: { bill: RecurringExpense | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(bill?.name ?? '');
  const [amount, setAmount] = useState(bill ? String(bill.amount_usd_micros / 1_000_000) : '');
  const [startedOn, setStartedOn] = useState(bill?.started_on ?? todayIso());
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run =async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save. Try again.');
      setBusy(false);
    }
  };

  const value = parseFloat(amount);
  const valid = name.trim().length > 0 && value > 0;
  const save = () => run(() => bill
    ? api.admin.updateRecurring(bill.id, { name: name.trim(), amount_usd: value, started_on: startedOn })
    : api.admin.createRecurring({ name: name.trim(), amount_usd: value, started_on: startedOn }));

  return (
    <Sheet title={bill ? 'Edit bill' : 'New monthly bill'} onClose={onClose}>
      <div className="adm-form">
        <div className="tb-field">
          <label htmlFor="bill-name">Name</label>
          <input id="bill-name" className="tb-input" value={name} maxLength={200} placeholder="Railway plan" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="adm-form-pair">
          <div className="tb-field">
            <label htmlFor="bill-amount">Per month, USD</label>
            <input id="bill-amount" className="tb-input" inputMode="decimal" type="number" min="0" step="0.01" value={amount} placeholder="5.00" onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="tb-field">
            <label htmlFor="bill-start">First charge</label>
            <input id="bill-start" className="tb-input" type="date" value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />
          </div>
        </div>
        {bill && (
          <div>
            <SheetRow icon="calendar" label={bill.is_active ? 'Pause this bill' : 'Resume this bill'} onClick={() => run(() => api.admin.updateRecurring(bill.id, { is_active: !bill.is_active }))} />
            <SheetRow icon="trash" label="Delete" danger onClick={() => setConfirm(true)} />
          </div>
        )}
        {bill && confirm && (
          <Dialog label={`Delete ${bill.name}?`} onClose={() => setConfirm(false)}>
            <div className="tb-h2">Delete {bill.name}?</div>
            <div className="tb-muted">Past months stop counting it too.</div>
            <div className="tb-stack">
              <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={() => setConfirm(false)}>Keep it</button>
              <button type="button" className="tb-btn tb-btn--danger tb-btn--full" disabled={busy} onClick={() => run(() => api.admin.deleteRecurring(bill.id))}><Icon name="trash" />Delete</button>
            </div>
          </Dialog>
        )}
        {error && <div className="adm-error" role="alert">{error}</div>}
        <button type="button" className="tb-btn tb-btn--primary tb-btn--full" disabled={!valid || busy} onClick={save}>
          <Icon name="check" />Save
        </button>
      </div>
    </Sheet>
  );
}
