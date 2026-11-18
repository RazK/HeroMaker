/**
 * One analytics event from a game page: a round ended, with its length and
 * score. The app's own client (frontend/src/analytics.ts) does everything
 * else; this is the little it cannot see from the other side of /play/.
 *
 * Same rules as there: first-party (our own backend, same origin), no
 * personal data (a game id and two numbers), sent in the background, and a
 * failure is dropped without a word. It only speaks for a browser the app
 * has already given a visitor id: on the standalone build (GitHub Pages)
 * there is none, and nothing is sent.
 */
const VISITOR_KEY = 'hm_visitor'
const DOOR_KEY = 'hm_door'
const TOKEN_KEY = 'heromaker_jwt_token'
const SLUG = /^[a-z0-9][a-z0-9_-]{0,39}$/

export function trackGameEnded(game: 'arena' | 'dance', seconds: number, score: number): void {
  try {
    const visitor = localStorage.getItem(VISITOR_KEY)
    if (!visitor) return
    const door = localStorage.getItem(DOOR_KEY)
    const whole = (n: number, max: number) => Math.max(0, Math.min(max, Math.round(Number.isFinite(n) ? n : 0)))
    const body = JSON.stringify({
      visitor,
      door: door && SLUG.test(door) ? door : null,
      device: matchMedia('(min-width: 900px)').matches ? 'desktop' : 'phone',
      robot: navigator.webdriver === true,
      events: [{ name: 'game_ended', props: { game, seconds: whole(seconds, 86_400), score: whole(score, 10_000_000) } }],
    })
    const token = localStorage.getItem(TOKEN_KEY)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    void fetch('/api/v1/events', { method: 'POST', headers, body, keepalive: true }).catch(() => {})
  } catch { /* never the game's problem */ }
}
