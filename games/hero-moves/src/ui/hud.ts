import { el } from './dom'
import { LIMBS, type Skeleton } from '../pose/keypoints'
import type { GameState, RoundResult } from '../game/game'
import { pictogram } from './pictogram'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

/**
 * The overlay.
 *
 * Everything lives at the edges, because the middle belongs to two faces a
 * child drew. The one piece that earns space is the strip: a row of stick
 * figures sliding toward a marker, which answers "what next, and when" without
 * a word of instruction. It is the reason the routine can run continuously
 * instead of stopping to explain itself.
 */
export class Hud {
  readonly hud = el('div', { class: 'layer', id: 'hud', hidden: true })
  readonly countdownLayer = el('div', { class: 'layer', id: 'countdownLayer', hidden: true })
  readonly grade = el('div', { id: 'grade' })

  private score = el('div', { class: 'value num' }, '0')
  private combo = el('div', { class: 'value small num' }, '—')
  private moveName = el('div', { id: 'moveName' }, '')
  private stripInner = el('div', { id: 'stripInner' })
  private strip = el('div', { id: 'strip' },
    el('div', { id: 'stripNow' }), this.stripInner, this.moveName)
  private countdownNum = el('div', { id: 'countdown' })

  private camCanvas = el('canvas', { width: 224, height: 168 }) as HTMLCanvasElement
  private camState = el('span', {}, 'CAMERA')
  private camFps = el('span', { class: 'num' }, '')
  readonly camPanel = el('div', { id: 'camPanel' },
    this.camCanvas, el('div', { id: 'camBadge' }, this.camState, this.camFps))

  /** Tiles are reused frame to frame; rebuilding them every frame flickers. */
  private tiles = new Map<string, HTMLElement>()

  constructor() {
    this.countdownLayer.append(this.countdownNum)
    this.hud.append(
      el('div', { class: 'hud-top' },
        el('div', { class: 'readout' },
          el('div', { class: 'label' }, 'Score'), this.score),
        el('div', { class: 'readout right' },
          el('div', { class: 'label' }, 'Combo'), this.combo),
      ),
      this.strip,
      this.camPanel,
      this.grade,
    )
  }

  update(s: GameState) {
    this.score.textContent = fmt(s.score)
    this.combo.textContent = s.combo > 1 ? `×${s.combo}` : '—'
    this.moveName.textContent = s.move?.name ?? ''
    this.renderStrip(s)
    this.camPanel.classList.toggle('lost', !s.seesPlayer && s.phase === 'dancing')
    this.camState.textContent = s.seesPlayer ? 'TRACKING' : 'STEP INTO VIEW'
  }

  /**
   * Lay the upcoming moves out by *time*, not by index: a two-beat move sits
   * half as far ahead as a four-beat one, so the spacing on screen is the
   * spacing in the music.
   */
  private renderStrip(s: GameState) {
    const seen = new Set<string>()
    for (let i = 0; i < s.next.length; i++) {
      const u = s.next[i]
      const key = `${u.move.id}:${i}`
      seen.add(key)
      let tile = this.tiles.get(key)
      if (!tile) {
        const img = el('img', { class: 'shape', src: pictogram(u.move), alt: u.move.name })
        tile = el('div', { class: 'tile' }, img)
        this.tiles.set(key, tile)
        this.stripInner.append(tile)
      }
      // Beats-away maps to distance from the marker; the live move sits on it.
      const t = Math.max(-0.4, Math.min(4.2, u.beatsAway / 4))
      tile.style.transform = `translate(-50%,-50%) translateX(${t * 100}%)`
      tile.style.opacity = String(u.beatsAway <= 0 ? 1 : Math.max(0.45, 1 - t * 0.45))
      tile.classList.toggle('live', u.beatsAway <= 0)
    }
    for (const [key, tile] of this.tiles) {
      if (seen.has(key)) continue
      tile.remove()
      this.tiles.delete(key)
    }
  }

  showGrade(r: RoundResult) {
    this.grade.textContent = r.grade
    this.grade.className = `g-${r.grade}`
    this.grade.id = 'grade'
    this.grade.style.color =
      r.grade === 'PERFECT' ? 'var(--gold)'
      : r.grade === 'GREAT' ? 'var(--mint)'
      : r.grade === 'GOOD' ? 'var(--sky)'
      : r.grade === 'OK' ? '#ffb35c' : 'var(--pop)'
    this.grade.classList.remove('show')
    void this.grade.offsetWidth
    this.grade.classList.add('show')
  }

  setCountdown(n: number) {
    const label = n > 0 ? String(n) : 'DANCE!'
    if (this.countdownNum.dataset.v === label) return
    this.countdownNum.dataset.v = label
    this.countdownNum.replaceChildren(el('span', {}, label))
  }

  setFps(fps: number, ms: number) {
    // Below 10 fps a rounded integer reads as "0 FPS", i.e. as broken. On a
    // machine without a GPU that number is real and worth showing honestly.
    this.camFps.textContent = fps > 0 ? `${fps < 10 ? fps.toFixed(1) : fps.toFixed(0)} FPS · ${ms.toFixed(0)}ms` : ''
  }

  /**
   * Draw the camera feed with the tracked skeleton on top. Mirrored, because a
   * player needs to see themselves the way a mirror shows them or left and
   * right stop making sense.
   */
  drawCamera(video: HTMLVideoElement, skeleton: Skeleton | null) {
    const c = this.camCanvas
    const g = c.getContext('2d')
    if (!g || video.readyState < 2) return
    g.save()
    g.translate(c.width, 0); g.scale(-1, 1)
    g.drawImage(video, 0, 0, c.width, c.height)
    g.restore()
    if (!skeleton) return

    const px = (x: number) => (1 - x) * c.width   // mirrored to match the feed
    const py = (y: number) => y * c.height

    g.lineWidth = 3
    g.strokeStyle = '#3ddc97'
    g.lineCap = 'round'
    for (const [a, b] of LIMBS) {
      const p = skeleton[a], q = skeleton[b]
      if (p.score < 0.3 || q.score < 0.3) continue
      g.beginPath(); g.moveTo(px(p.x), py(p.y)); g.lineTo(px(q.x), py(q.y)); g.stroke()
    }
    g.fillStyle = '#ffd23f'
    for (const k of Object.values(skeleton)) {
      if (k.score < 0.3) continue
      g.beginPath(); g.arc(px(k.x), py(k.y), 3.2, 0, Math.PI * 2); g.fill()
    }
  }
}
