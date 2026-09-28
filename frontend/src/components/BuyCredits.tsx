import { useEffect, useState } from 'react';
import { api, ApiError, CreditPack } from '../api/client';
import './CouponRedeem.css';
import './BuyCredits.css';

interface BuyCreditsProps {
  isOpen: boolean;
  onClose: () => void;
}

// Where Lemon Squeezy sends the buyer back. App.tsx sees the marker, re-reads
// the balance and says thanks - it never tells the backend a payment happened.
export const PURCHASE_RETURN_PARAM = 'purchase';

export function BuyCredits({ isOpen, onClose }: BuyCreditsProps) {
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

  return (
    <div className="coupon-modal-overlay" onClick={onClose}>
      <div className="coupon-modal buy-credits-modal" onClick={(e) => e.stopPropagation()}>
        <button className="coupon-modal-close" onClick={onClose}>×</button>
        <h2 className="coupon-modal-title">Buy Credits 🪙</h2>
        <p className="coupon-modal-subtitle">Credits pay for making heroes.</p>

        {error && <div className="coupon-modal-error">{error}</div>}
        {!packs && !error && <p className="coupon-modal-subtitle">Loading…</p>}
        {packs && packs.length === 0 && !error && (
          <div className="coupon-modal-error">Payments are unavailable right now.</div>
        )}

        <div className="buy-credits-packs">
          {packs?.map((pack) => (
            <button
              key={pack.slug}
              className={`buy-credits-pack${pack.highlight ? ' buy-credits-pack-highlight' : ''}`}
              data-pack={pack.slug}
              disabled={buying !== null}
              onClick={() => handleBuy(pack.slug)}
            >
              <span className="buy-credits-pack-name">{pack.name}</span>
              <span className="buy-credits-pack-credits">🪙 {pack.credits}</span>
              <span className="buy-credits-pack-blurb">{pack.heroes} heroes · {pack.blurb}</span>
              <span className="buy-credits-pack-price">
                {buying === pack.slug ? 'Opening checkout…' : pack.price_display}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
