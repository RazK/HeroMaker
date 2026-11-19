/**
 * PostHog in the browser: where the analytics graphs are (funnels, paths,
 * heatmaps). posthogCore.ts holds the rules and is what the tests prove;
 * this file only asks the backend whether PostHog is configured here, and
 * wires it to analytics.ts.
 *
 * OFF unless this environment's backend hands out a project key
 * (GET /api/v1/analytics/config). The key is read at RUNTIME, so the one
 * build promoted from staging to production serves both, each with its own
 * PostHog project. With no key the library's chunk is never fetched.
 *
 * No session recording, ever. No cookies. Nobody identified.
 */
import { device, door, robot, setMirror, visitorId } from './analytics';
import { PostHogLike, PostHogSetting, scrubUrl, startIfAllowed } from './posthogCore';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
/** Events said before the answer is in wait here, a few at most. */
const MAX_WAITING = 100;

let begun = false;

/** Once, as the page loads. Never throws, never blocks anything. */
export function startPostHog(): void {
  if (begun) return;
  begun = true;
  try {
    // An automated browser is never counted: no question is even asked.
    if (robot()) return;
    const waiting: Array<[string, Record<string, unknown>]> = [];
    setMirror((name, props) => { if (waiting.length < MAX_WAITING) waiting.push([name, props]); });
    fetch(`${API_BASE_URL}/api/v1/analytics/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((config: { posthog?: PostHogSetting | null } | null) => startIfAllowed(
        config?.posthog,
        { robot: robot(), visitor: visitorId() },
        async () => (await import('posthog-js')).default as unknown as PostHogLike,
      ))
      .then((posthog) => {
        if (!posthog) { setMirror(null); return; }
        const send = (name: string, props: Record<string, unknown>) => {
          // Every event says which door and which kind of device, like our own.
          posthog.register({ door: door() ?? 'direct', device: device() });
          posthog.capture(name, name === '$pageview'
            ? { ...props, $current_url: scrubUrl(window.location.href) }
            : props);
        };
        setMirror(send);
        waiting.forEach(([name, props]) => send(name, props));
      })
      .catch(() => setMirror(null));
  } catch {
    setMirror(null);
  }
}
