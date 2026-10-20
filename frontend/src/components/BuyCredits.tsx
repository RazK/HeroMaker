import { useEffect, useState } from 'react';
import { api, ApiError, CreditPack } from '../api/client';
import { Icon } from './tb/Icon';
import { LegalPage, openLegal } from './tb/Legal';
import { Sheet } from './tb/parts';
import './BuyCredits.css';

interface BuyCreditsProps {
  isOpen: boolean;
  onClose: () => void;
  /** Why the sheet opened, shown above the packs (e.g. not enough for a hero). */
  note?: string;
  /** The balance now: back from checkout, App waits for it to move. */
  credits?: number;
}

// Where Lemon Squeezy sends the buyer back. App.tsx sees the marker, re-reads
// the balance and says thanks - it never tells the backend a payment happened.
export const PURCHASE_RETURN_PARAM = 'purchase';

// The balance as the buyer left for checkout. The webhook often lands before
// the buyer is back, so the first balance read on return may already be the
// new one: without this, "Adding your credits…" waited for a change that had
// already happened, and stayed (persona review). This tab only.
const BALANCE_BEFORE = 'heromaker.credits.beforeCheckout';
/** The balance before checkout, read once (undefined: not known). */
export function balanceBeforeCheckout(): number | undefined {
  try {
    const v = sessionStorage.getItem(BALANCE_BEFORE);
    sessionStorage.removeItem(BALANCE_BEFORE);
    return v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined;
  } catch { return undefined; }
}

export function BuyCredits({ isOpen, onClose, note, credits }: BuyCreditsProps) {
  const [packs, setPacks] = useState<CreditPack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    api.getPacks()
      .then(setPacks)
      .catch(() => setError('Payments are unavailable right now.'));
  }, [isOpen]);

  if (!isOpen) return null;

  const handleBuy = async (slug: string) => {
    setError(null);
    setBuying(slug);
    try {
      const back = `${window.location.origin}/?${PURCHASE_RETURN_PARAM}=done`;
      const { checkout_url } = await api.createCheckout(slug, back);
      try { if (credits !== undefined) sessionStorage.setItem(BALANCE_BEFORE, String(credits)); } catch { /* the wait falls back to the first read */ }
      window.location.href = checkout_url;
    } catch (err) {
      // 503 (store unconfigured) and 502 (Lemon Squeezy refused) are ours,
      // not the customer's, so neither is shown as a validation error.
      if (err instanceof ApiError && err.status === 401) {
        setError('Please log in again to buy credits.');
      } else {
        setError('Payments are unavailable right now.');
      }
      setBuying(null);
    }
  };

  const openPage = (page: LegalPage) => {
    onClose();
    openLegal(page);
  };

  return (
    <Sheet title="Pick a pack" onClose={onClose} className="buy-credits-modal">
      {note && <div className="tb-notice buy-credits-why" role="status">{note}</div>}
      <div className="tb-muted buy-credits-note"><Icon name="lock" size={16} />Secure checkout · 1 hero = 10 credits</div>
      {error && <div className="buy-credits-error" role="alert">{error}</div>}
      {!packs && !error && <div className="tb-muted">Loading…</div>}
      {packs && packs.length === 0 && !error && <div className="buy-credits-error">Payments are unavailable right now.</div>}

      <div className="buy-credits-packs">
        {packs?.map((pack) => (
          <button
            key={pack.slug}
            type="button"
            className={`buy-credits-pack${pack.highlight ? ' buy-credits-pack-highlight' : ''}`}
            data-pack={pack.slug}
            disabled={buying !== null}
            onClick={() => handleBuy(pack.slug)}
          >
            <span className="buy-credits-pack-main">
              <span className="buy-credits-pack-name">
                {pack.name}
                {pack.highlight && <span className="buy-credits-pack-badge">Best value</span>}
              </span>
              <span className="buy-credits-pack-blurb">{pack.heroes} heroes</span>
            </span>
            <span className="buy-credits-pack-side">
              <span className="buy-credits-pack-price">{pack.price_display}</span>
              <span className="buy-credits-pack-credits">{buying === pack.slug ? 'Opening…' : `${pack.credits} credits`}</span>
            </span>
          </button>
        ))}
      </div>

      {/* Who takes the money, and the two pages a buyer may want first. */}
      <div className="buy-credits-legal">
        <span className="tb-muted">Payments by Lemon Squeezy</span>
        <div className="tb-chip-row">
          <button type="button" className="tb-chip buy-credits-legal-chip" onClick={() => openPage('refunds')}>Refunds</button>
          <button type="button" className="tb-chip buy-credits-legal-chip" onClick={() => openPage('terms')}>Terms</button>
        </div>
      </div>
    </Sheet>
  );
}
