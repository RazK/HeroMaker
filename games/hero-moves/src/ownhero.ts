/**
 * The hero the player made, when the HeroMaker app opens a game for one.
 *
 * `?vrm=<url>` names the hero's VRM and `?name=` labels it. Same-origin only,
 * so a game page cannot be pointed at someone else's server: the app always
 * passes a relative /api/files/... path, which nginx proxies to the backend.
 * Shared by every game the app can open, so they agree on what they accept.
 */
function ownHeroUrl(): string | null {
  const raw = new URLSearchParams(location.search).get('vrm')
  if (!raw) return null
  try {
    const u = new URL(raw, location.href)
    return u.origin === location.origin ? u.href : null
  } catch {
    return null
  }
}

export const OWN_HERO = ownHeroUrl()
export const OWN_NAME = new URLSearchParams(location.search).get('name') || 'Your hero'

/** Back to the app: the page that opened the game, or the app's home. */
export function goBack() {
  if (window.history.length > 1 && document.referrer.startsWith(location.origin)) window.history.back()
  else location.assign('/')
}

/** The round back arrow the app uses on every header. */
export const BACK_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
