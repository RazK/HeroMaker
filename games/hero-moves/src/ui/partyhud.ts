import { el } from './dom'
import { LIMBS, type Skeleton } from '../pose/keypoints'
import type { PartyState, Player } from '../game/party'
import { pictogram } from './pictogram'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

/** Same three hues the plates and the picker use. */
const LANE_INK = ['#ffd23f', '#3ddc97', '#56b8ff']

/**
 * The party overlay.
 *
 * There is no coach on stage any more, so the strip is the only thing that
 * says what to do — which makes its legibility the whole tutorial. It keeps the
 * shape that worked: stick figures generated from the same skeletons the player
 * is scored against, travelling right to left through a line they cross at an
 * instant, rather than parking inside a box wide enough to hold two of them.
 *
 * Everything else is per player and lives directly above that player's hero, so
 * a score can never be read as belonging to the wrong lane.
 */

export interface PlayerChrome {
  root: HTMLElement
  score: HTMLElement
  combo: HTMLElement
  grade: HTMLElement
  lost: HTMLElement
}

export class PartyHud {
  readonly hud = el('div', { class: 'layer', id: 'hud', hidden: true })
  readonly countdownLayer = el('div', { class: 'layer', id: 'countdownLayer', hidden: true })

  private moveName = el('div', { id: 'moveName' }, '')
  private stripInner = el('div', { id: 'stripInner' })
  private strip = el('div', { id: 'strip' },
    this.stripInner, el('div', { id: 'stripLine' }), this.moveName)
  private countdownNum = el('div', { id: 'countdown' })

  /** One chrome per lane, positioned over that lane's hero every frame. */
  readonly chrome: PlayerChrome[] = []
  private plates = el('div', { class: 'layer', id: 'plates' })

  readonly pauseBtn = el('button', { class: 'icon-btn', id: 'pauseBtn', title: 'Pause' }, '❚❚')
  private camCanvas = el('canvas', { width: 360, height: 90 }) as HTMLCanvasElement
  readonly camStrip = el('div', { id: 'camStrip' }, this.camCanvas)

  private tiles = new Map<number, HTMLElement>()

  constructor() {
    this.countdownLayer.append(this.countdownNum)
    for (let i = 0; i < 3; i++) {
      const score = el('div', { class: 'p-score num' }, '0')
      const combo = el('div', { class: 'p-combo num' }, '')
      const grade = el('div', { class: 'p-grade' })
      const lost = el('div', { class: 'p-lost' }, 'STEP IN')
      const root = el('div', { class: `p-plate lane-${i}`, hidden: true }, grade, score, combo, lost)
      this.chrome.push({ root, score, combo, grade, lost })
      this.plates.append(root)
    }
    this.hud.append(
      el('div', { class: 'hud-top' }, this.camStrip, this.pauseBtn),
      this.strip,
    )
  }

  /** The plates layer sits above the 3D but below cards; mounted separately. */
  get platesLayer() { return this.plates }

  update(s: PartyState) {
    this.moveName.textContent = s.move?.name ?? ''
    this.renderStrip(s)
    for (let i = 0; i < this.chrome.length; i++) {
      const c = this.chrome[i]
      const p = s.players[i]
      c.root.hidden = !p
      if (!p) continue
      c.score.textContent = fmt(p.score)
      c.combo.textContent = p.combo > 1 ? `×${p.combo}` : ''
      c.lost.hidden = p.seen || s.phase !== 'dancing'
      c.root.classList.toggle('missing', !p.seen && s.phase === 'dancing')
    }
  }

  /** Called once per banked grade so the pop animation restarts cleanly. */
  popGrade(lane: number, grade: string) {
    const c = this.chrome[lane]
    if (!c) return
    c.grade.textContent = grade
    c.grade.className = `p-grade g-${grade}`
    c.grade.style.color =
      grade === 'PERFECT' ? 'var(--gold)'
      : grade === 'GREAT' ? 'var(--mint)'
      : grade === 'GOOD' ? 'var(--sky)'
      : grade === 'OK' ? '#ffb35c' : 'var(--pop)'
    c.grade.classList.remove('show')
    void c.grade.offsetWidth
    c.grade.classList.add('show')
  }

  /** Put a plate over a hero, in screen space. */
  place(lane: number, x: number, y: number, visible: boolean) {
    const c = this.chrome[lane]
    if (!c) return
    c.root.style.opacity = visible ? '1' : '0'
    c.root.style.transform = `translate(-50%,-100%) translate(${x}px, ${y}px)`
  }

  private renderStrip(s: PartyState) {
    const seen = new Set<number>()
    for (const u of s.next) {
      seen.add(u.startBeat)
      let tile = this.tiles.get(u.startBeat)
      if (!tile) {
        const img = el('img', { class: 'shape', src: pictogram(u.move), alt: u.move.name })
        tile = el('div', { class: 'tile' }, img)
        this.tiles.set(u.startBeat, tile)
        this.stripInner.append(tile)
      }
      tile.style.transform =
        `translate(-50%,-50%) translateX(calc(var(--beat) * ${u.beatsAway.toFixed(3)}))`
      tile.style.opacity = (u.beatsAway > 0
        ? Math.max(0.55, 1 - u.beatsAway * 0.1)
        : Math.max(0, 1 + u.beatsAway / 1.6)).toFixed(2)
      if (u.beatsAway <= 0 && !tile.classList.contains('hit')) tile.classList.add('hit')
    }
    for (const [key, tile] of this.tiles) {
      if (seen.has(key)) continue
      tile.remove()
      this.tiles.delete(key)
    }
  }

  /** Wipe the strip so a new routine does not inherit the last one's tiles. */
  resetStrip() {
    for (const [, t] of this.tiles) t.remove()
    this.tiles.clear()
  }

  setCountdown(n: number) {
    const label = n > 0 ? String(n) : 'DANCE!'
    if (this.countdownNum.dataset.v === label) return
    this.countdownNum.dataset.v = label
    this.countdownNum.replaceChildren(el('span', {}, label))
  }

  /**
   * The camera strip: every lane side by side, mirrored, with each lane's
   * tracked skeleton drawn on it. This is the only thing that tells three
   * people whether the game can currently see all three of them, which is the
   * question a lane-based game gets asked constantly.
   */
  drawCamera(video: HTMLVideoElement, lanes: Array<Skeleton | null>, count: number) {
    const c = this.camCanvas
    const g = c.getContext('2d')
    if (!g || video.readyState < 2) return
    const n = Math.max(1, count)
    const laneW = c.width / n

    g.save()
    g.translate(c.width, 0); g.scale(-1, 1)
    g.drawImage(video, 0, 0, c.width, c.height)
    g.restore()

    for (let i = 0; i < n; i++) {
      // Lane i on screen maps to lane i of the mirrored image, left to right.
      const x0 = i * laneW
      if (i > 0) {
        g.strokeStyle = 'rgba(253,247,236,.35)'
        g.lineWidth = 1
        g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0, c.height); g.stroke()
      }
      const sk = lanes[i]
      if (!sk) continue
      // Keypoints can land outside the lane — an arm out crosses into the next
      // third — so each lane draws inside its own box.
      g.save()
      g.beginPath(); g.rect(x0, 0, laneW, c.height); g.clip()
      // Keypoints are in the lane's own space, and the drawing is mirrored, so
      // x flips inside the lane.
      const px = (x: number) => x0 + (1 - x) * laneW
      const py = (y: number) => y * c.height
      g.lineWidth = 2
      g.strokeStyle = '#3ddc97'
      g.lineCap = 'round'
      for (const [a, b] of LIMBS) {
        const p = sk[a], q = sk[b]
        if (p.score < 0.3 || q.score < 0.3) continue
        g.beginPath(); g.moveTo(px(p.x), py(p.y)); g.lineTo(px(q.x), py(q.y)); g.stroke()
      }
      g.fillStyle = '#ffd23f'
      for (const k of Object.values(sk)) {
        if (k.score < 0.3) continue
        g.beginPath(); g.arc(px(k.x), py(k.y), 2, 0, Math.PI * 2); g.fill()
      }
      // Which lane is which, so a player can find themselves in the strip.
      g.fillStyle = LANE_INK[i] ?? '#fdf7ec'
      g.font = 'bold 11px system-ui'
      g.textAlign = 'left'
      g.fillText(`P${i + 1}`, x0 + 5, 14)
      g.restore()
    }
  }

  /** Resize the strip canvas so N lanes each get a sensible aspect. */
  sizeCamera(count: number) {
    // 4:3 per lane, the shape a person standing in front of a laptop occupies.
    this.camCanvas.width = 120 * Math.max(1, count)
    this.camCanvas.height = 90
  }
}
