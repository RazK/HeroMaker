import { el } from './dom'
import { LIMBS, type Skeleton } from '../pose/keypoints'
import type { GameState, RoundResult } from '../game/game'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

/**
 * The overlay. Everything lives at the edges of the frame because the middle
 * belongs to the hero's face — the whole reason this game exists.
 */
export class Hud {
  readonly hud = el('div', { class: 'layer', id: 'hud', hidden: true })
  readonly countdownLayer = el('div', { class: 'layer', id: 'countdownLayer', hidden: true })
  readonly grade = el('div', { id: 'grade' })

  private score = el('div', { class: 'value num' }, '0')
  private moveCount = el('div', { class: 'value small num' }, '1 / 9')
  private combo = el('div', { class: 'value small num' }, '')
  private moveName = el('div', { id: 'moveName' }, '')
  private movePhase = el('div', { id: 'movePhase' }, '')
  private beatFill = el('i', {})
  private beatBar = el('div', { class: 'beat' }, this.beatFill)
  private matchFill = el('div', { id: 'matchFill' })
  private matchPct = el('div', { id: 'matchPct', class: 'num' }, '0%')
  private matchWrap = el('div', { id: 'matchWrap' },
    el('div', { id: 'matchBar' }, this.matchFill), this.matchPct)
  private countdownNum = el('div', { id: 'countdown' })

  private camCanvas = el('canvas', { width: 224, height: 168 }) as HTMLCanvasElement
  private camState = el('span', {}, 'CAMERA')
  private camFps = el('span', { class: 'num' }, '')
  readonly camPanel = el('div', { id: 'camPanel' },
    this.camCanvas, el('div', { id: 'camBadge' }, this.camState, this.camFps))

  constructor() {
    this.countdownLayer.append(this.countdownNum)
    this.hud.append(
      el('div', { class: 'hud-top' },
        el('div', { class: 'readout' },
          el('div', { class: 'label' }, 'Score'), this.score,
          el('div', { class: 'label', style: 'margin-top:6px' }, 'Combo'), this.combo),
        el('div', { class: 'readout right' },
          el('div', { class: 'label' }, 'Move'), this.moveCount),
      ),
      this.camPanel,
      el('div', { id: 'movePanel' },
        this.movePhase, this.moveName, this.beatBar, this.matchWrap),
      this.grade,
    )
  }

  update(s: GameState) {
    this.score.textContent = fmt(s.score)
    this.combo.textContent = s.combo > 1 ? `×${s.combo}` : '—'
    this.moveCount.textContent = `${s.moveIndex + 1} / ${s.totalMoves}`
    this.moveName.textContent = s.move.name

    const copying = s.phase === 'copy'
    this.movePhase.textContent =
      s.phase === 'coach' ? 'Watch your hero' : copying ? 'Your turn — copy it' : ''
    this.beatBar.classList.toggle('copy', copying)
    this.beatFill.style.width = `${(copying ? 1 - s.phaseProgress : s.phaseProgress) * 100}%`

    this.matchWrap.hidden = !copying
    const pct = Math.round(s.liveScore * 100)
    this.matchFill.style.width = `${pct}%`
    this.matchFill.style.background =
      s.liveScore >= 0.75 ? 'var(--mint)' : s.liveScore >= 0.5 ? 'var(--gold)' : 'var(--pop)'
    this.matchPct.textContent = `${pct}%`

    this.camPanel.classList.toggle('lost', !s.seesPlayer && s.phase !== 'title')
    this.camState.textContent = s.seesPlayer ? 'TRACKING' : 'STEP INTO VIEW'
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
