/**
 * The pay pop-up's words for a plan (PaywallSheet), kept free of React so
 * they are tested (paywall.test.ts).
 */

/** The parts of a pack the plan card reads (api/client CreditPack). */
export interface PlanPack {
  name: string;
  heroes: number;
  price_cents: number;
  price_display: string;
}

/** "₪7.80": one hero's share of a pack, in the pack's own currency sign. */
export function perHero(pack: Pick<PlanPack, 'price_cents' | 'price_display' | 'heroes'>): string {
  const sign = pack.price_display.replace(/[\d.,\s]/g, '');
  return `${sign}${(pack.price_cents / 100 / pack.heroes).toFixed(2)}`;
}

/** The card's two lines: "One hero / This drawing", "Family pack / 5 heroes · ₪7.80 each". */
export function planLines(pack: PlanPack): { title: string; line: string } {
  if (pack.heroes <= 1) return { title: pack.name, line: 'This drawing' };
  const title = /\bpack$/i.test(pack.name) ? pack.name : `${pack.name} pack`;
  return { title, line: `${pack.heroes} heroes · ${perHero(pack)} each` };
}

