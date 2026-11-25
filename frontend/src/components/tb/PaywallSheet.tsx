import { useEffect, useState } from 'react';
import { flush, track } from '../../analytics';
import { api, ApiError, CreditPack } from '../../api/client';
import { CHECKOUT_FAILED_ON_LOAD, PURCHASE_RETURN_PARAM, rememberBalanceBeforeCheckout } from '../BuyCredits';
import { Icon } from './Icon';
import { Sheet } from './parts';
import { planLines } from './paywall';
import './PaywallSheet.css';

/**
 * "Bring <name> to life!": the pay pop-up at the money moment, when the free
 * painting is done and the 3D waits for payment (docs/design/proposals/
 * paywall.md, round 4, approved by Raz 2026-11-24). Phone: a bottom sheet;
 * desktop: a 480px dialog. It holds the heading, the plan cards (GET
 * /api/v1/packs, the highlighted one picked) and Continue to payment, and
 * nothing else: no benefits line, no fine print, no "credits".
 *
 * Continue opens the checkout (POST /api/v1/checkout) and sends the browser
 * there; the buyer comes back to this hero. The browser never says a payment
 * happened: the signed webhook grants the credits, and the hero goes on from
 * 3D once the balance covers it (HeroScreen, `resumeAfterPurchase`).
 */

/** The hero to carry on with when the buyer comes back from checkout (this tab). */
const RESUME = 'heromaker.paywall.resume';
export function markResumeAfterPurchase(creationId: string): void {
  try { sessionStorage.setItem(RESUME, creationId); } catch { /* the buyer taps Bring it to life again */ }
}
/** Whether this hero was paid for from its paywall; true once, then forgotten. */
export function takeResumeAfterPurchase(creationId: string): boolean {
  try {
    if (sessionStorage.getItem(RESUME) !== creationId) return false;
    sessionStorage.removeItem(RESUME);
    return true;
  } catch { return false; }
}

/** Back from a checkout that did not go through: the pop-up's first opening says so, once. */
let failedNoteDue = CHECKOUT_FAILED_ON_LOAD;

interface PaywallSheetProps {
  heroName: string;
  creationId: string;
  /** The balance now, so the wait on return knows when the credits are in. */
  credits?: number;
  onClose: () => void;
}

export function PaywallSheet({ heroName, creationId, credits, onClose }: PaywallSheetProps) {
  const [packs, setPacks] = useState<CreditPack[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  // Read in the initializer, used up after mounting (StrictMode calls an
  // initializer twice; taking it there lost it).
  const [error, setError] = useState<string | null>(() => (failedNoteDue ? 'Payment didn’t go through. Try again.' : null));
  useEffect(() => { failedNoteDue = false; }, []);
  const [going, setGoing] = useState(false);

  useEffect(() => {
    track('credits_shown');
    api.getPacks()
      .then((list) => {
        setPacks(list);
        setPicked((list.find((p) => p.highlight) ?? list[0])?.slug ?? null);
        if (!list.length) setError('Payments are unavailable right now');
      })
      .catch(() => setError('Payments are unavailable right now'));
  }, []);

  const go = async () => {
    if (!picked || going) return;
    setError(null);
    setGoing(true);
    try {
      // Back to this hero, which goes on from 3D once the credits are in.
      const back = `${window.location.origin}${window.location.pathname}?${PURCHASE_RETURN_PARAM}=done`;
      const { checkout_url } = await api.createCheckout(picked, back);
      rememberBalanceBeforeCheckout(credits);
      markResumeAfterPurchase(creationId);
      track('checkout_started', { pack: picked });
      flush(true);
      window.location.href = checkout_url;
    } catch (err) {
      // 503 (no store) and 502 (the provider refused) are ours, not the
      // buyer's: one plain line, never red, never a validation error.
      setError(err instanceof ApiError && err.status === 401 ? 'Please sign in again' : 'Payments are unavailable right now');
      setGoing(false);
    }
  };

  return (
    <Sheet label={`Bring ${heroName} to life!`} onClose={onClose} className="tb-paywall-sheet">
      <div className="tb-paywall-head">
        <h2 className="tb-paywall-heading">Bring {heroName} to life!</h2>
        <button type="button" className="tb-paywall-close" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
      </div>
      <div className="tb-paywall-plans" role="radiogroup" aria-label="Plans">
        {packs?.map((pack) => {
          const { title, line } = planLines(pack);
          const on = pack.slug === picked;
          return (
            <button key={pack.slug} type="button" role="radio" aria-checked={on} data-pack={pack.slug}
              className={`tb-plan${on ? ' tb-plan--on' : ''}`} disabled={going} onClick={() => setPicked(pack.slug)}>
              {pack.highlight && <span className="tb-plan-badge">Best value</span>}
              <span className="tb-plan-dot" aria-hidden="true" />
              <span className="tb-plan-text">
                <span className="tb-plan-title">{title}</span>
                <span className="tb-plan-line">{line}</span>
              </span>
              <span className="tb-plan-price">{pack.price_display}</span>
            </button>
          );
        })}
      </div>
      {error && <div className="tb-paywall-note" role="status">{error}</div>}
      <button type="button" className="tb-btn tb-btn--primary tb-btn--full tb-paywall-go" disabled={!picked || going} onClick={go}>
        {going ? 'Opening…' : 'Continue to payment'}
      </button>
    </Sheet>
  );
}
