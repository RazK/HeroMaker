import { el } from './dom'
import { LIMBS, type Skeleton, type KeypointName } from '../pose/keypoints'
import { icon } from './tb'
import type { PartyState, Player } from '../game/party'
import { pictogram } from './pictogram'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

/** "L SHAPE" -> "L shape": the app writes everything in sentence case. */
const sentence = (t: string) => t ? t[0].toUpperCase() + t.slice(1).toLowerCase() : t

/** Grades in the app's voice: sentence case, kid-sized. */
const GRADE_LABEL: Record<string, string> = {
  PERFECT: 'Perfect!', GREAT: 'Great!', GOOD: 'Good', OK: 'OK', MISS: 'Miss',
}

/** Same three hues the plates and the picker use. */
const LANE_INK = ['#ffc233', '#3ddc97', '#56b8ff']

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

  /** The app's round header button, where the app keeps its right-hand one. */
  readonly pauseBtn = el('button', { class: 'tb-nav', id: 'pauseBtn', title: 'Pause' })
  private camCanvas = el('canvas', { width: 120, height: 160 }) as HTMLCanvasElement
  readonly camStrip = el('div', { id: 'camStrip' }, this.camCanvas)

  private tiles = new Map<number, HTMLElement>()

  constructor() {
    // Every one of these floats over the 3D stage by design, which is what the
    // 'hud' entry in tools/screenaudit.mjs's overlap allowlist says. The mark
    // only licenses overlapping things *outside* the marked subtree — two
    // pieces of HUD landing on each other is still a finding.
    this.hud.dataset.overlay = 'hud'
    this.plates.dataset.overlay = 'hud'
    this.countdownLayer.dataset.overlay = 'hud'
    this.strip.dataset.overlay = 'strip'
    this.pauseBtn.type = 'button'
    this.pauseBtn.setAttribute('aria-label', 'Pause')
    this.pauseBtn.innerHTML = icon('pause')
    this.countdownLayer.append(this.countdownNum)
    for (let i = 0; i < 3; i++) {
      const score = el('div', { class: 'p-score num' }, '0')
      const combo = el('div', { class: 'p-combo num' }, '')
      const grade = el('div', { class: 'p-grade' })
      const lost = el('div', { class: 'p-lost' }, 'Step in!')
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
    this.moveName.textContent = sentence(s.move?.name ?? '')
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
    c.grade.textContent = GRADE_LABEL[grade] ?? grade
    c.grade.className = `p-grade g-${grade}`
    c.grade.style.color =
      grade === 'PERFECT' ? 'var(--tb-sun)'
      : grade === 'GREAT' ? 'var(--mint)'
      : grade === 'GOOD' ? 'var(--sky)'
      : grade === 'OK' ? '#ffb35c' : 'var(--tb-plate-6)'
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
    const label = n > 0 ? String(n) : 'Dance!'
    if (this.countdownNum.dataset.v === label) return
    this.countdownNum.dataset.v = label
    this.countdownNum.replaceChildren(el('span', {}, label))
  }

  /**
   * The camera picture-in-picture: one small cell per player, each cropped to
   * that player's body.
   *
   * It used to be the whole room at a third of the screen's width, which on a
   * phone covered the top-left third of the stage and the hero in it. A player
   * glancing at it wants one thing, "does it see me", and their own body
   * answers that; the sofa behind them does not. So each cell follows the
   * tracked body (shoulders to feet, padded for the head and a raised arm),
   * eased so it glides rather than jumps, and falls back to the whole lane
   * when nobody is there.
   *
   * The overlay is the body only — no dots, nothing on the face — as one thin
   * line in the brand's grape on a white edge, which is what says "tracked".
   */
  drawCamera(
    video: HTMLVideoElement,
    lanes: Array<Skeleton | null>,
    count: number,
    /** Lane width over frame height; lane keypoints use one lane width on both axes. */
    laneAspect = 1,
  ) {
    const c = this.camCanvas
    const g = c.getContext('2d')
    const vw = video.videoWidth, vh = video.videoHeight
    if (!g || video.readyState < 2 || !vw || !vh) return
    this.sizeCamera(count, laneAspect)
    const n = Math.max(1, count)
    const cellW = c.width / n, cellH = c.height
    const cellAspect = cellW / cellH
    g.fillStyle = '#231942'
    g.fillRect(0, 0, c.width, c.height)

    for (let i = 0; i < n; i++) {
      const sk = lanes[i]
      // Mirrored frame coordinates in pixels: lane i sits at [i, i+1] / n.
      const pt = (x: number, y: number) => [((i + 1 - x) / n) * vw, y * laneAspect * vh] as const
      const target = this.bodyCrop(sk, pt, i, n, vw, vh, cellAspect)
      const crop = (this.crops[i] ??= { ...target })
      const k = 0.12
      crop.cx += (target.cx - crop.cx) * k
      crop.cy += (target.cy - crop.cy) * k
      crop.h += (target.h - crop.h) * k
      const ch = crop.h, cw = ch * cellAspect
      const left = Math.min(Math.max(crop.cx - cw / 2, 0), Math.max(0, vw - cw))
      const top = Math.min(Math.max(crop.cy - ch / 2, 0), Math.max(0, vh - ch))
      const x0 = i * cellW

      g.save()
      g.beginPath(); g.rect(x0, 0, cellW, cellH); g.clip()
      // The crop is in mirrored coordinates; the video is not, so the source
      // rectangle is flipped and the drawing mirrored back.
      g.translate(x0 + cellW, 0); g.scale(-1, 1)
      g.drawImage(video, vw - (left + cw), top, cw, ch, 0, 0, cellW, cellH)
      g.restore()

      if (sk) {
        g.save()
        g.beginPath(); g.rect(x0, 0, cellW, cellH); g.clip()
        const toCell = (x: number, y: number) => {
          const [mx, my] = pt(x, y)
          return [x0 + ((mx - left) / cw) * cellW, ((my - top) / ch) * cellH] as const
        }
        g.lineCap = 'round'; g.lineJoin = 'round'
        for (const [w, colour] of [[5, 'rgba(255,255,255,.85)'], [2.5, '#5b3df5']] as const) {
          g.lineWidth = w * (cellH / 160)
          g.strokeStyle = colour
          for (const [a, b] of LIMBS) {
            const p = sk[a], q = sk[b]
            if (p.score < 0.3 || q.score < 0.3) continue
            const [ax, ay] = toCell(p.x, p.y), [bx, by] = toCell(q.x, q.y)
            g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke()
          }
        }
        g.restore()
      }
      if (i > 0) {
        g.fillStyle = '#ffffff'
        g.fillRect(x0 - 1.5, 0, 3, cellH)
      }
      // Which cell is which player, in the lane's colour, when there are several.
      if (n > 1) {
        const s = cellH / 160
        g.font = `800 ${Math.round(14 * s)}px Nunito, system-ui`
        g.textAlign = 'left'
        const label = `P${i + 1}`
        const tw = g.measureText(label).width
        g.fillStyle = LANE_INK[i] ?? '#ffffff'
        g.beginPath(); g.roundRect(x0 + 6 * s, 6 * s, tw + 12 * s, 20 * s, 10 * s); g.fill()
        g.fillStyle = '#231942'
        g.fillText(label, x0 + 12 * s, 21 * s)
      }
    }
  }

  /** Eased crop rectangle per lane, in mirrored frame pixels. */
  private crops: Array<{ cx: number; cy: number; h: number }> = []

  /** Where the body is, padded for the head and a raised arm; the whole lane if nobody is. */
  private bodyCrop(
    sk: Skeleton | null,
    pt: (x: number, y: number) => readonly [number, number],
    i: number, n: number, vw: number, vh: number, cellAspect: number,
  ) {
    const maxH = Math.min(vh, vw / cellAspect)
    const laneW = vw / n
    const whole = { cx: (i + 0.5) * laneW, cy: vh / 2, h: Math.min(maxH, laneW / cellAspect) }
    if (!sk) return whole
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, seen = 0
    for (const name of BODY) {
      const k = sk[name]
      if (k.score < 0.3) continue
      const [x, y] = pt(k.x, k.y)
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
      seen++
    }
    if (seen < 4) return whole
    const bh = y1 - y0, bw = x1 - x0
    // The head sits above the shoulders by about half the shoulder-to-hip span.
    const top = y0 - Math.max(bh * 0.35, vh * 0.08)
    const bottom = y1 + bh * 0.08
    const h = Math.min(maxH, Math.max(vh * 0.3, bottom - top, (bw * 1.3) / cellAspect))
    return { cx: (x0 + x1) / 2, cy: (top + bottom) / 2, h }
  }

  /**
   * Size the picture: a 3:4 cell per player, drawn at twice its CSS size so it
   * stays sharp on a phone. CSS sets how big it shows (ui/toybox.css).
   */
  sizeCamera(count: number, _laneAspect = 4 / 3) {
    const n = Math.max(1, count)
    const w = 120 * n, h = 160
    if (this.camCanvas.width === w && this.camCanvas.height === h) return
    this.camCanvas.width = w
    this.camCanvas.height = h
    this.camStrip.dataset.players = String(n)
    this.crops = []
  }
}

/** The body, without the face: what the picture is cropped to and drawn over. */
const BODY: KeypointName[] = [
  'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist',
  'leftHip', 'rightHip', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle',
]
