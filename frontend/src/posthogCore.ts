/**
 * PostHog, decided: whether it loads at all, with what settings, and what a
 * web address is allowed to say. Plain logic with nothing of the browser in
 * it, so `npm test` can prove the rules (posthogCore.test.ts). posthog.ts is
 * the browser's side.
 *
 * The rules (docs/analytics/REQUIREMENTS.md, v2):
 * - OFF unless this environment's backend hands out a project key. No key:
 *   the library is never even fetched, and nothing is sent.
 * - NO session recording. It is switched off here and cannot be switched on
 *   from PostHog's side: the recorder is an external script, and external
 *   scripts are refused too.
 * - No cookies and nothing in the browser's storage (memory only). The id is
 *   the one our own events use.
 * - Nobody is ever identified: no name, no email, never `identify`. The one
 *   person profile is an anonymous visitor's two answers (WhoForSheet), and
 *   only for a visitor who gave them.
 * - What a page says is never sent: text and attributes are masked in
 *   autocapture, and addresses are scrubbed of tokens and codes.
 * - An automated browser (the staging robot) does not load it at all.
 */

/** What the backend hands out (GET /api/v1/analytics/config), or nothing. */
export interface PostHogSetting { key: string; host: string }

/** What is known about this browser. */
export interface BrowserFacts {
  /** An automated browser: the staging robot, any webdriver. */
  robot: boolean;
  /** Our own anonymous id for this browser (analytics.ts). */
  visitor: string;
}

/** The little of posthog-js this app uses. */
export interface PostHogLike {
  init: (key: string, options: Record<string, unknown>) => unknown;
  capture: (event: string, properties?: Record<string, unknown>) => unknown;
  register: (properties: Record<string, unknown>) => unknown;
  setPersonProperties: (properties: Record<string, unknown>) => unknown;
}

const KEY = /^phc_[A-Za-z0-9]{20,80}$/;
const HOST = /^https:\/\/[a-z0-9.-]+\.posthog\.com$/;

/** Whether PostHog may load here: a real project key and host, and not a robot. */
export function allowed(setting: PostHogSetting | null | undefined, facts: BrowserFacts): setting is PostHogSetting {
  return !!setting && typeof setting.key === 'string' && typeof setting.host === 'string'
    && KEY.test(setting.key) && HOST.test(setting.host) && !facts.robot;
}

/**
 * A web address with nothing private in it: the query keeps only where the
 * visitor came from (`via`, `utm_*`), the fragment goes, and the parts of a
 * path that are a secret or a code (a claim link's token, a class's PIN, a
 * password reset) are replaced by a word.
 */
export function scrubUrl(url: string): string {
  if (typeof url !== 'string' || url === '') return url;
  const noHash = url.split('#')[0];
  const cut = noHash.indexOf('?');
  let path = cut === -1 ? noHash : noHash.slice(0, cut);
  const query = cut === -1 ? '' : noHash.slice(cut + 1);
  path = path
    .replace(/\/claim\/[^/]+/g, '/claim/:token')
    .replace(/\/join\/[^/]+/g, '/join/:pin');
  const kept = query.split('&').filter((pair) => /^(via|utm_[a-z]+)=[A-Za-z0-9_.~-]{1,60}$/.test(pair));
  return kept.length > 0 ? `${path}?${kept.join('&')}` : path;
}

const ADDRESS_KEY = /url|referrer|pathname|href|host$/i;

/** Every address in an event's properties, scrubbed (PostHog's before_send). */
export function scrubEvent<T extends { properties?: Record<string, unknown> } | null>(event: T): T {
  if (!event || !event.properties) return event;
  for (const [key, value] of Object.entries(event.properties)) {
    if (typeof value === 'string' && ADDRESS_KEY.test(key)) event.properties[key] = scrubUrl(value);
  }
  return event;
}

/** The settings PostHog starts with. Each line is one of the rules above. */
export function initOptions(setting: PostHogSetting, facts: BrowserFacts): Record<string, unknown> {
  return {
    api_host: setting.host,
    // Never record a screen. Not now, not by a switch in PostHog's settings.
    disable_session_recording: true,
    disable_external_dependency_loading: true,
    // No cookies, nothing stored: PostHog keeps its state in memory, and the
    // id is the one our own events already use.
    persistence: 'memory',
    bootstrap: { distinctID: facts.visitor },
    // Nobody is identified, ever. A person profile is made only for a visitor
    // who answered the two questions, keyed by the anonymous id and holding
    // only those answers (setPersonProperties); every other visitor has none.
    person_profiles: 'identified_only',
    // What people do, not what the page says: clicks, pages, scrolling, heatmaps.
    autocapture: true,
    capture_heatmaps: true,
    capture_pageview: false,       // sent by the app on every screen change
    capture_pageleave: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    before_send: scrubEvent,
    // Nothing else of PostHog's: no remote config, flags, surveys, error or speed capture.
    advanced_disable_flags: true,
    disable_surveys: true,
    disable_web_experiments: true,
    capture_exceptions: false,
    capture_performance: false,
    capture_dead_clicks: false,
  };
}

/**
 * Load and start PostHog if, and only if, it is allowed here. `load` fetches
 * the library (a separate chunk): it is not called at all otherwise.
 */
export async function startIfAllowed(
  setting: PostHogSetting | null | undefined,
  facts: BrowserFacts,
  load: () => Promise<PostHogLike>,
): Promise<PostHogLike | null> {
  if (!allowed(setting, facts)) return null;
  const posthog = await load();
  posthog.init(setting.key, initOptions(setting, facts));
  return posthog;
}
