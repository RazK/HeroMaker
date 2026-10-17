/** Money arrives as integer USD micros; it is only ever turned into text here. */
export function usd(micros: number | null | undefined, opts: { signed?: boolean; cents?: boolean } = {}): string {
  if (micros === null || micros === undefined) return '–';
  const dollars = micros / 1_000_000;
  const cents = opts.cents ?? Math.abs(dollars) < 1000;
  const text = Math.abs(dollars).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
  if (dollars < 0) return `−${text}`;
  if (opts.signed && dollars > 0) return `+${text}`;
  return text;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  // A bare YYYY-MM-DD is a calendar date: read it as local, not UTC midnight.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  meshy: 'Meshy',
  railway: 'Railway',
  internal: 'Our servers',
};

export function providerName(p: string): string {
  return PROVIDER_NAMES[p] ?? p;
}
