import qrcode from 'qrcode-generator'
import { makeRng } from '../core/math'

/**
 * Everything drawn over the 3D frame: storybook captions, the title and end
 * cards, confetti, sparkles and the transitions between beats.
 *
 * It is all drawn into the same 2D canvas the 3D frame is copied into — not
 * DOM over a canvas — because that canvas *is* the film: what the player shows,
 * what `MediaRecorder` captures and what the offline renderer saves are one
 * picture. Every function here is a pure function of time, so a frame can be
 * rendered in any order and always comes out the same.
 *
 * Colours and type are the app's Toy Box tokens (docs/design/BRANDBOOK.md):
 * Barriecito for anything a child reads, Nunito 800 for small print, ink on a
 * white plate with a hard offset shadow for any text that sits over the scene.
 */
export const TB = {
  grape: '#5B3DF5', grapeDeep: '#3A22B8', grapeText: '#4B2FE0',
  sun: '#FFC233', sunDeep: '#D99A00', ink: '#231942', ink2: '#5C5578',
  cream: '#FFF6E9', white: '#FFFFFF', line: '#EADFCB', green: '#15997A', red: '#C62828',
}
const DISPLAY = 'Barriecito, Fredoka, Nunito, system-ui, sans-serif'
const BODY = 'Nunito, system-ui, sans-serif'

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const easeOutBack = (t: number) => { const c = 1.7; const u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u }
const easeOut = (t: number) => 1 - (1 - t) ** 3
const ease = (t: number) => t * t * (3 - 2 * t)

export class Painter {
  readonly s: number
  constructor(readonly g: CanvasRenderingContext2D, readonly W: number, readonly H: number) {
    this.s = W / 720
  }

  // ---------------------------------------------------------------- primitives
  private roundRect(x: number, y: number, w: number, h: number, r: number) {
    const g = this.g
    g.beginPath()
    g.roundRect(x, y, w, h, r)
  }

  /** A Toy Box plate: white, ink outline, hard ink shadow below. */
  plate(x: number, y: number, w: number, h: number, opts: { fill?: string; depth?: number; r?: number; border?: string } = {}) {
    const { g, s } = this
    const r = (opts.r ?? 28) * s, depth = (opts.depth ?? 8) * s
    g.save()
    g.fillStyle = TB.ink
    this.roundRect(x, y + depth, w, h, r); g.fill()
    g.fillStyle = opts.fill ?? TB.white
    this.roundRect(x, y, w, h, r); g.fill()
    g.lineWidth = 4 * s; g.strokeStyle = opts.border ?? TB.ink
    this.roundRect(x, y, w, h, r); g.stroke()
    g.restore()
  }

  /** Words laid out in lines no wider than `max`, at `size`. */
  private wrap(words: string[], font: string, max: number): string[][] {
    const g = this.g
    g.font = font
    const space = g.measureText(' ').width
    const lines: string[][] = [[]]
    let w = 0
    for (const word of words) {
      const ww = g.measureText(word).width
      const line = lines[lines.length - 1]
      if (line.length && w + space + ww > max) { lines.push([word]); w = ww } else { line.push(word); w += (line.length > 1 ? space : 0) + ww }
    }
    return lines
  }

  /** Largest size (down to `min`) at which `text` fits in `maxLines` lines. */
  private fit(text: string, family: string, size: number, min: number, max: number, maxLines: number) {
    const words = text.split(/\s+/).filter(Boolean)
    let px = size
    for (; px > min; px -= 2) {
      const lines = this.wrap(words, `${px}px ${family}`, max)
      if (lines.length <= maxLines) return { px, lines }
    }
    return { px: min, lines: this.wrap(words, `${min}px ${family}`, max) }
  }

  // ---------------------------------------------------------------- caption
  /**
   * The storybook line. The plate pops up, then the words pop in one at a
   * time — the read-aloud rhythm of a picture book — with the hero's name in
   * grape. `u` is seconds into the beat, `dur` the beat's length.
   */
  caption(text: string, highlight: string, u: number, dur: number, opts: { y?: number; size?: number } = {}) {
    if (!text) return
    const { g, W, H, s } = this
    const appear = clamp01((u - 0.2) / 0.28)
    const leave = clamp01((dur - u - 0.05) / 0.3)
    if (appear <= 0 || leave <= 0) return
    const padX = 30 * s, padY = 22 * s
    const maxW = W - 2 * 36 * s - 2 * padX
    const { px, lines } = this.fit(text, DISPLAY, (opts.size ?? 54) * s, 34 * s, maxW, 3)
    const lineH = px * 1.12
    g.font = `${px}px ${DISPLAY}`
    const widths = lines.map((l) => g.measureText(l.join(' ')).width)
    const boxW = Math.min(W - 72 * s, Math.max(...widths) + 2 * padX)
    const boxH = lines.length * lineH + 2 * padY
    const x = (W - boxW) / 2
    const y = (opts.y ?? H - 70 * s) - boxH
    const k = easeOutBack(appear)
    g.save()
    g.globalAlpha = leave
    g.translate(W / 2, y + boxH / 2)
    g.scale(0.86 + 0.14 * k, 0.86 + 0.14 * k)
    g.translate(-W / 2, -(y + boxH / 2))
    g.globalAlpha = leave * clamp01(appear * 1.6)
    this.plate(x, y, boxW, boxH)
    // Words.
    const nameWords = new Set(highlight.split(/\s+/).map((w) => w.toLowerCase()))
    const space = g.measureText(' ').width
    let n = 0
    g.textBaseline = 'alphabetic'
    lines.forEach((line, li) => {
      let cx = W / 2 - widths[li] / 2
      const by = y + padY + lineH * (li + 0.8)
      for (const word of line) {
        const ww = g.measureText(word).width
        const at = 0.42 + n * 0.075
        const p = clamp01((u - at) / 0.22)
        if (p > 0) {
          const bare = word.replace(/[^\p{L}\p{N}']/gu, '').replace(/'s$/i, '').toLowerCase()
          g.save()
          g.globalAlpha = leave * clamp01(p * 2)
          g.translate(cx + ww / 2, by - px * 0.3)
          const sc = 0.5 + 0.5 * easeOutBack(p)
          g.scale(sc, sc)
          g.fillStyle = nameWords.has(bare) ? TB.grapeText : TB.ink
          g.fillText(word, -ww / 2, px * 0.3)
          g.restore()
        }
        cx += ww + space
        n++
      }
    })
    g.restore()
  }

  // ---------------------------------------------------------------- headline
  /** Big sun-on-ink display text, each line bobbing a little out of step. */
  headline(text: string, u: number, dur: number, opts: { y?: number; size?: number; maxLines?: number; fill?: string } = {}) {
    if (!text) return
    const { g, W, s } = this
    const appear = clamp01((u - 0.1) / 0.4)
    const leave = clamp01((dur - u) / 0.25)
    if (appear <= 0 || leave <= 0) return
    const { px, lines } = this.fit(text, DISPLAY, (opts.size ?? 104) * s, 48 * s, W - 70 * s, opts.maxLines ?? 2)
    const lineH = px * 1.0
    const top = opts.y ?? 120 * s
    g.save()
    g.globalAlpha = leave
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `${px}px ${DISPLAY}`
    g.lineJoin = 'round'
    lines.forEach((line, i) => {
      const p = clamp01((u - 0.1 - i * 0.18) / 0.45)
      if (p <= 0) return
      const k = easeOutBack(p)
      const bob = Math.sin((u - i * 0.4) * 4.2) * 5 * s
      const tilt = Math.sin((u - i * 0.5) * 2.2) * 0.025
      g.save()
      g.translate(W / 2, top + i * lineH + bob)
      g.rotate(tilt + (1 - p) * 0.2 * (i % 2 ? 1 : -1))
      g.scale(k, k)
      g.lineWidth = 16 * s
      g.strokeStyle = TB.ink
      g.strokeText(line.join(' '), 0, 6 * s)
      g.strokeText(line.join(' '), 0, 0)
      g.fillStyle = opts.fill ?? TB.sun
      g.fillText(line.join(' '), 0, 0)
      g.restore()
    })
    g.restore()
  }

  /** A small pill of body text — eyebrows, credits. */
  pill(text: string, cx: number, cy: number, opts: { size?: number; fill?: string; color?: string; alpha?: number; scale?: number } = {}) {
    const { g, s } = this
    const px = (opts.size ?? 26) * s
    g.save()
    g.globalAlpha = opts.alpha ?? 1
    g.translate(cx, cy)
    const k = opts.scale ?? 1
    g.scale(k, k)
    g.font = `800 ${px}px ${BODY}`
    const w = g.measureText(text).width + 36 * s
    const h = px * 1.75
    this.plate(-w / 2, -h / 2, w, h, { r: h / 2, depth: 5, fill: opts.fill })
    g.fillStyle = opts.color ?? TB.ink
    g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText(text, 0, 2 * s)
    g.restore()
  }

  // ---------------------------------------------------------------- cards
  /** Rotating sun rays: the app's "sun behind a ready hero", as a burst. */
  sunburst(cx: number, cy: number, r: number, u: number, alpha: number) {
    const { g } = this
    g.save()
    g.globalAlpha = alpha
    g.translate(cx, cy)
    g.rotate(u * 0.25)
    // Alternate rays only, fading out towards the rim, so the set shows through.
    const rays = 18
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, r)
    grd.addColorStop(0, 'rgba(255,233,168,0.95)')
    grd.addColorStop(0.35, 'rgba(255,194,51,0.55)')
    grd.addColorStop(1, 'rgba(255,194,51,0)')
    g.fillStyle = grd
    g.beginPath()
    for (let i = 0; i < rays; i += 2) {
      g.moveTo(0, 0)
      g.arc(0, 0, r, (i / rays) * Math.PI * 2, ((i + 1) / rays) * Math.PI * 2)
      g.closePath()
    }
    g.fill()
    g.restore()
  }

  titleCard(title: string, credit: string, u: number, dur: number) {
    const { W, s } = this
    const leave = clamp01((dur - u) / 0.3)
    const burst = easeOut(clamp01((u - 0.05) / 0.5))
    if (burst > 0) this.sunburst(W / 2, 300 * s, 420 * s * burst, u, 0.55 * leave)
    const eb = clamp01((u - 0.15) / 0.3)
    if (eb > 0) this.pill('A HeroMaker film', W / 2, 120 * s, { size: 24, color: TB.grapeText, alpha: leave * eb, scale: 0.8 + 0.2 * easeOutBack(eb) })
    this.headline(title, u - 0.25, dur - 0.25, { y: 250 * s, size: 112, maxLines: 3 })
    const cr = clamp01((u - 1.2) / 0.3)
    if (cr > 0) this.pill(credit, W / 2, 500 * s, { size: 26, alpha: leave * cr, scale: 0.8 + 0.2 * easeOutBack(cr) })
  }

  /** The drawing, as the app shows it: a polaroid, tilted -6°, the artist's name under it. */
  polaroid(img: CanvasImageSource | null, cx: number, cy: number, size: number, label: string, rot = -6, alpha = 1) {
    const { g, s } = this
    const pad = size * 0.06
    const capH = size * 0.17
    const w = size + 2 * pad, h = size + pad + capH
    g.save()
    g.globalAlpha = alpha
    g.translate(cx, cy)
    g.rotate((rot * Math.PI) / 180)
    g.shadowColor = 'rgba(35,25,66,0.28)'; g.shadowBlur = 26 * s; g.shadowOffsetY = 10 * s
    g.fillStyle = TB.white
    g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, 14 * s); g.fill()
    g.shadowColor = 'transparent'
    g.fillStyle = '#FAF7F2'
    g.beginPath(); g.roundRect(-w / 2 + pad, -h / 2 + pad, size, size, 8 * s); g.fill()
    if (img) {
      // Never crop the drawing: contain.
      const iw = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width
      const ih = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height
      const k = Math.min(size / iw, size / ih)
      const dw = iw * k, dh = ih * k
      g.save()
      g.beginPath(); g.roundRect(-w / 2 + pad, -h / 2 + pad, size, size, 8 * s); g.clip()
      g.drawImage(img, -w / 2 + pad + (size - dw) / 2, -h / 2 + pad + (size - dh) / 2, dw, dh)
      g.restore()
    }
    g.fillStyle = TB.ink2
    g.font = `${Math.round(capH * 0.52)}px ${DISPLAY}`
    g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText(label, 0, h / 2 - capH / 2)
    g.restore()
  }

  /** The app's primary button, drawn: grape pill, 6px grape-deep depth, white display type. */
  button(text: string, cx: number, cy: number, w: number, k = 1) {
    const { g, s } = this
    const h = 76 * s
    g.save()
    g.translate(cx, cy); g.scale(k, k)
    g.fillStyle = TB.grapeDeep
    g.beginPath(); g.roundRect(-w / 2, -h / 2 + 8 * s, w, h, h / 2); g.fill()
    g.fillStyle = TB.grape
    g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, h / 2); g.fill()
    g.fillStyle = TB.white
    g.font = `${34 * s}px ${DISPLAY}`
    g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText(text, 0, 3 * s)
    g.restore()
  }

  /** Cream sheet rising over the lower part of the frame, top corners rounded. */
  sheet(top: number, p: number) {
    const { g, W, H, s } = this
    const y = top + (1 - easeOutBack(p)) * (H - top)
    g.save()
    g.fillStyle = TB.cream
    g.shadowColor = 'rgba(35,25,66,0.25)'; g.shadowBlur = 30 * s; g.shadowOffsetY = -6 * s
    g.beginPath(); g.roundRect(0, y, W, H - y + 40 * s, [44 * s, 44 * s, 0, 0]); g.fill()
    g.restore()
    return y
  }

  endCard(drawing: CanvasImageSource | null, artistLine: string, made: string, cta: string, u: number) {
    const { W, H, s } = this
    const p = clamp01((u - 0.25) / 0.55)
    if (p <= 0) return
    const top = this.sheet(H * 0.5, p)
    const d = top - H * 0.5
    const pp = clamp01((u - 0.55) / 0.45)
    if (pp > 0) this.polaroid(drawing, W / 2, H * 0.5 + d + 190 * s, 300 * s, artistLine, -6 + (1 - easeOutBack(pp)) * -14, clamp01(pp * 2))
    const tp = clamp01((u - 0.95) / 0.35)
    if (tp > 0) {
      const g = this.g
      g.save()
      g.globalAlpha = tp
      g.fillStyle = TB.ink
      g.textAlign = 'center'; g.textBaseline = 'middle'
      const { px } = this.fit(made, DISPLAY, 56 * s, 34 * s, W - 80 * s, 1)
      g.font = `${px}px ${DISPLAY}`
      g.fillText(made, W / 2, H * 0.5 + d + 425 * s)
      g.restore()
    }
    const bp = clamp01((u - 1.35) / 0.35)
    if (bp > 0) this.button(cta, W / 2, H * 0.5 + d + 530 * s, 540 * s, 0.7 + 0.3 * easeOutBack(bp))
    this.headline('The End', u - 0.1, 99, { y: 92 * s, size: 92, maxLines: 1 })
  }

  greetingEnd(drawing: CanvasImageSource | null, artistLine: string, made: string, link: string, u: number) {
    const { g, W, H, s } = this
    const p = clamp01(u / 0.45)
    if (p <= 0) return
    const top = this.sheet(H * 0.49, p)
    const d = top - H * 0.49
    const size = 250 * s
    const cy = H * 0.49 + d + 175 * s
    const pp = clamp01((u - 0.3) / 0.4)
    if (pp > 0) this.polaroid(drawing, W * 0.29, cy, size, artistLine, -6, clamp01(pp * 2))
    if (pp > 0) this.qr(link, W * 0.71, cy - 14 * s, size, clamp01(pp * 2), 'Make yours')
    const tp = clamp01((u - 0.6) / 0.3)
    if (tp > 0) {
      g.save()
      g.globalAlpha = tp
      g.textAlign = 'center'; g.textBaseline = 'middle'
      g.fillStyle = TB.ink
      const { px } = this.fit(made, DISPLAY, 54 * s, 32 * s, W - 80 * s, 1)
      g.font = `${px}px ${DISPLAY}`
      g.fillText(made, W / 2, cy + 225 * s)
      g.fillStyle = TB.grapeText
      g.font = `800 ${26 * s}px ${BODY}`
      g.fillText(link.replace(/^https?:\/\//, ''), W / 2, cy + 300 * s)
      g.restore()
    }
  }

  private qrCache = new Map<string, boolean[][]>()
  qr(text: string, cx: number, cy: number, size: number, alpha: number, label: string) {
    const { g, s } = this
    let m = this.qrCache.get(text)
    if (!m) {
      const q = qrcode(0, 'M'); q.addData(text); q.make()
      const n = q.getModuleCount()
      m = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)))
      this.qrCache.set(text, m)
    }
    const n = m.length
    const pad = size * 0.08
    const cell = (size - 2 * pad) / n
    g.save()
    g.globalAlpha = alpha
    g.translate(cx, cy)
    g.rotate((4 * Math.PI) / 180)
    this.plate(-size / 2, -size / 2, size, size + 46 * s, { r: 18, depth: 6 })
    g.fillStyle = TB.ink
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) g.fillRect(-size / 2 + pad + c * cell, -size / 2 + pad + r * cell, cell + 0.5, cell + 0.5)
    g.font = `${26 * s}px ${DISPLAY}`
    g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillStyle = TB.grapeText
    g.fillText(label, 0, size / 2 + 18 * s)
    g.restore()
  }

  watermark() {
    const { g, W, s } = this
    g.save()
    g.globalAlpha = 0.85
    g.font = `${24 * s}px ${DISPLAY}`
    g.textAlign = 'right'; g.textBaseline = 'top'
    g.lineWidth = 6 * s; g.strokeStyle = TB.ink; g.lineJoin = 'round'
    g.strokeText('HeroMaker', W - 22 * s, 22 * s)
    g.fillStyle = TB.white
    g.fillText('HeroMaker', W - 22 * s, 22 * s)
    g.restore()
  }

  // ---------------------------------------------------------------- transitions
  /** 0 = open, 1 = fully closed. Centred on the hero's face. */
  iris(k: number, cx: number, cy: number) {
    if (k <= 0) return
    const { g, W, H, s } = this
    const R = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) * 1.05
    const r = R * (1 - ease(k))
    g.save()
    g.fillStyle = TB.ink
    g.beginPath()
    g.rect(0, 0, W, H)
    g.arc(cx, cy, Math.max(0, r), 0, Math.PI * 2, true)
    g.fill('evenodd')
    if (r > 2) {
      g.lineWidth = 12 * s; g.strokeStyle = TB.sun
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke()
    }
    g.restore()
  }

  /** Toy Box stripes sweeping across. */
  wipe(k: number, closing: boolean) {
    if (k <= 0) return
    const { g, W, H } = this
    const colours = [TB.grape, TB.sun, TB.cream, TB.ink]
    const span = W + H * 0.6
    g.save()
    colours.forEach((c, i) => {
      const lag = i * 0.12
      const p = ease(clamp01((k - lag * (closing ? 1 : 0)) / (1 - lag * (closing ? 1 : 0))))
      // Closing: the front edge moves right to cover. Opening: the back edge leaves.
      const x0 = closing ? -H * 0.6 : -H * 0.6 + span * (1 - p)
      const x1 = closing ? -H * 0.6 + span * p : W + H * 0.6
      g.fillStyle = c
      g.beginPath()
      g.moveTo(x0, H); g.lineTo(x0 + H * 0.6, 0); g.lineTo(x1 + H * 0.6, 0); g.lineTo(x1, H); g.closePath()
      g.fill()
    })
    g.restore()
  }

  flash(k: number) {
    if (k <= 0) return
    const { g, W, H } = this
    g.save(); g.globalAlpha = k; g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, W, H); g.restore()
  }

  fade(k: number) {
    if (k <= 0) return
    const { g, W, H } = this
    g.save(); g.globalAlpha = k; g.fillStyle = TB.ink; g.fillRect(0, 0, W, H); g.restore()
  }

  // ---------------------------------------------------------------- particles
  confetti(tau: number, seed: number, palette: string) {
    if (tau < 0 || tau > 6) return
    const { g, W, H, s } = this
    const cols = palette === 'light' ? ['#E9E3FF', '#FFE9A8', '#CFF5EA', '#FFDCC7', '#D6ECFF', '#FFD6E7', TB.sun]
      : palette === 'hanukkah' ? ['#3A7BFD', '#FFFFFF', TB.sun, '#9CC8FF', '#1F4FD8']
      : [TB.grape, TB.sun, TB.green, TB.red, '#FF8AC4', '#3FA9F5', '#FFFFFF']
    const rnd = makeRng(seed)
    const N = 170
    g.save()
    for (let i = 0; i < N; i++) {
      const a = rnd(), b = rnd(), c = rnd(), d = rnd(), e = rnd(), f = rnd()
      const delay = a * 0.25
      const t = tau - delay
      if (t < 0) continue
      // Two cannons in the lower corners and a shower from the top.
      let x: number, y: number
      const drag = 1.6
      const fall = 300 * s
      const decay = (1 - Math.exp(-drag * t)) / drag
      if (i % 3 === 2) {
        x = b * W + Math.sin(t * (2 + d * 3) + e * 6) * 30 * s
        y = -40 * s + (120 + c * 160) * s * t
      } else {
        const side = i % 3 === 0 ? -1 : 1
        const vx = -side * (420 + b * 700) * s
        const vy = -(1500 + c * 900) * s
        x = (side < 0 ? 0 : W) + vx * decay + Math.sin(t * 3 + e * 6) * 20 * s
        y = H * 0.92 + vy * decay + fall * t * t * 0.6 + 180 * s * t
      }
      if (y > H + 40 * s || x < -40 * s || x > W + 40 * s) continue
      const alpha = clamp01((5.5 - t) / 1.2)
      const size = (10 + d * 12) * s
      g.globalAlpha = alpha
      g.fillStyle = cols[Math.floor(f * cols.length)]
      g.save()
      g.translate(x, y)
      g.rotate(t * (3 + e * 8) + a * 6)
      const flip = Math.abs(Math.cos(t * (4 + b * 6)))
      if (i % 5 === 0) { g.beginPath(); g.arc(0, 0, size * 0.42, 0, Math.PI * 2); g.fill() }
      else g.fillRect(-size / 2, (-size * 0.32) * flip, size, size * 0.64 * flip + 1)
      g.restore()
    }
    g.restore()
  }

  private star(x: number, y: number, r: number, color: string) {
    const g = this.g
    g.fillStyle = color
    g.beginPath()
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2
      const rr = i % 2 ? r * 0.28 : r
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
    }
    g.closePath(); g.fill()
  }

  sparkles(tau: number, dur: number, cx: number, cy: number, radius: number, seed: number) {
    if (tau < 0 || tau > dur + 0.8) return
    const { g, s } = this
    const rnd = makeRng(seed)
    g.save()
    for (let i = 0; i < 26; i++) {
      const at = rnd() * dur, ang = rnd() * Math.PI * 2, dist = (0.4 + rnd() * 0.8) * radius, sz = (12 + rnd() * 22) * s
      const t = tau - at
      if (t < 0 || t > 0.8) continue
      const k = Math.sin((t / 0.8) * Math.PI)
      g.globalAlpha = k
      this.star(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist - t * 40 * s, sz * k, i % 3 ? TB.sun : TB.white)
    }
    g.restore()
  }

  /** Stars that switch on one by one across the sky and stay on. */
  stars(tau: number, seed: number) {
    if (tau < 0) return
    const { g, W, H, s } = this
    const rnd = makeRng(seed)
    g.save()
    for (let i = 0; i < 34; i++) {
      const at = rnd() * 1.6, x = rnd() * W, y = (0.04 + rnd() * 0.42) * H, sz = (8 + rnd() * 16) * s, ph = rnd() * 6
      const t = tau - at
      if (t < 0) continue
      const pop = t < 0.3 ? easeOutBack(t / 0.3) : 1
      const tw = 0.75 + 0.25 * Math.sin(tau * 5 + ph)
      g.globalAlpha = 0.95
      this.star(x, y, sz * pop * tw, i % 4 ? '#FFF7D1' : TB.sun)
    }
    g.restore()
  }

  hearts(tau: number, seed: number) {
    if (tau < 0) return
    const { g, W, H, s } = this
    const rnd = makeRng(seed)
    g.save()
    for (let i = 0; i < 22; i++) {
      const at = rnd() * 6, x0 = rnd() * W, sz = (18 + rnd() * 22) * s, sway = rnd() * 6
      const t = tau - at
      if (t < 0 || t > 4) continue
      const x = x0 + Math.sin(t * 2 + sway) * 26 * s
      const y = H * 0.95 - t * 260 * s
      g.globalAlpha = clamp01(t * 3) * clamp01((4 - t) / 1)
      g.fillStyle = i % 3 ? '#FF6FA8' : TB.red
      g.save(); g.translate(x, y); g.scale(sz / 20, sz / 20)
      g.beginPath()
      g.moveTo(0, 6); g.bezierCurveTo(-14, -4, -8, -16, 0, -8); g.bezierCurveTo(8, -16, 14, -4, 0, 6)
      g.fill(); g.restore()
    }
    g.restore()
  }
}
