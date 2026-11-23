/** A price in its currency's cents, written as the backend writes it:
 * "₪10" or "₪10.50" for shekels (backend app/config/packs.agorot_display),
 * "$1.25" for US dollars (Lemon Squeezy). */
export function priceText(cents: number, currency?: string): string {
  if (currency !== 'ILS') return `$${(cents / 100).toFixed(2)}`;
  const sign = cents < 0 ? '-' : '';
  const whole = Math.floor(Math.abs(cents) / 100);
  const frac = Math.abs(cents) % 100;
  return `${sign}₪${whole}${frac ? `.${String(frac).padStart(2, '0')}` : ''}`;
}
