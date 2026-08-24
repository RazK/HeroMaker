export interface Entry {
  who: string
  hero: string
  score: number
  distance: number
  at: number
}

const KEY = 'heroDash.hallOfFame.v1'
const SHARED_ID = 'shared-hall-of-fame'

/**
 * Local board always works. The shared board lives inside the published page
 * itself: posting rewrites the page's embedded JSON and republishes it, which
 * is why it is an explicit button and not something that fires on every death.
 */
export class HallOfFame {
  local: Entry[] = []
  shared: Entry[] = []

  constructor() {
    this.local = this.readLocal()
    this.shared = this.readShared()
  }

  private readLocal(): Entry[] {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? (JSON.parse(raw) as Entry[]) : []
    } catch { return [] }
  }

  private readShared(): Entry[] {
    try {
      const el = document.getElementById(SHARED_ID)
      const parsed = el?.textContent ? JSON.parse(el.textContent) : []
      return Array.isArray(parsed) ? parsed : []
    } catch { return [] }
  }

  private static rank(list: Entry[]): Entry[] {
    return [...list].sort((a, b) => b.score - a.score).slice(0, 12)
  }

  add(e: Entry) {
    this.local = HallOfFame.rank([...this.local, e])
    try { localStorage.setItem(KEY, JSON.stringify(this.local)) } catch { /* private mode */ }
  }

  get canPublish() {
    return typeof (window as any).claude?.use === 'function'
  }

  /**
   * Rewrite the page's embedded board and republish. Uses the pristine markup
   * captured before the game touched the DOM, never the live DOM.
   */
  async publish(pristineHtml: string, entry: Entry): Promise<'ok' | 'conflict' | 'unavailable'> {
    const api = (window as any).claude
    if (typeof api?.use !== 'function') return 'unavailable'
    const artifact = await api.use('artifact')
    if (!artifact?.publish) return 'unavailable'

    const next = HallOfFame.rank([...this.shared, entry])
    const json = JSON.stringify(next)
    const open = `<script id="${SHARED_ID}" type="application/json">`
    const start = pristineHtml.indexOf(open)
    if (start < 0) return 'unavailable'
    const from = start + open.length
    const to = pristineHtml.indexOf('</' + 'script>', from)
    if (to < 0) return 'unavailable'
    const html = pristineHtml.slice(0, from) + json + pristineHtml.slice(to)

    try {
      await artifact.publish(html)
      this.shared = next
      return 'ok'
    } catch (err: any) {
      return err?.code === 'conflict' ? 'conflict' : 'unavailable'
    }
  }

  /** Board to display: shared if it has anything in it, otherwise local. */
  best(): { list: Entry[]; source: 'shared' | 'local' } {
    return this.shared.length
      ? { list: HallOfFame.rank(this.shared), source: 'shared' }
      : { list: HallOfFame.rank(this.local), source: 'local' }
  }
}
