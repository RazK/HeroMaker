/**
 * How a hero's picture that failed to load is asked for again (Picture.tsx).
 *
 * A retry is a new address (`r=<n>`, which the backend ignores), so it never
 * reuses the failure: not a redirect the browser kept to an address that has
 * since expired, nor a broken response a cache or the network handed back.
 */

/** Wait before each retry, in ms: two more tries, then the picture gives up. */
export const RETRY_DELAYS_MS = [800, 2500] as const;

/** The address of try `attempt` (0 is the first: the address itself). */
export function retryUrl(url: string, attempt: number): string {
  if (!url || attempt <= 0) return url;
  const hash = url.indexOf('#');
  const base = hash < 0 ? url : url.slice(0, hash);
  const tail = hash < 0 ? '' : url.slice(hash);
  const cleaned = base.replace(/([?&])r=\d+(&|$)/, (_, lead: string, end: string) => (end ? lead : '')).replace(/[?&]$/, '');
  return `${cleaned}${cleaned.includes('?') ? '&' : '?'}r=${attempt}${tail}`;
}

/** Wait before retry `attempt` (1-based), or null when there are no tries left. */
export function retryDelay(attempt: number): number | null {
  return attempt >= 1 && attempt <= RETRY_DELAYS_MS.length ? RETRY_DELAYS_MS[attempt - 1] : null;
}
