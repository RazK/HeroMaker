/**
 * On-screen controls: a thumb stick on the left, Punch and Jump on the right.
 *
 * Pointer events, one capture per pointer, so a thumb can hold the stick while
 * the other one hammers Punch — real multi-touch, no gesture library. The
 * stick re-centres wherever the thumb lands inside its zone, so a child never
 * has to find a small target to start running. The keyboard drives the same
 * state on a desktop: arrows or WASD to run, J or F to punch, K or Space to jump.
 */

export interface Input {
  /** Stick, x right and y up the screen, length 0..1. */
  x: number
  y: number
  punch: boolean
  jump: boolean
}

const ICON = {
  punch: '<rect x="9" y="7" width="11" height="10" rx="3.5"/><path d="M13 7v4"/><path d="M16.5 7v4"/><path d="M9 11.5h6"/><path d="M3 9h3"/><path d="M2 12h4"/><path d="M3 15h3"/>',
  jump: '<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M5 20.5h14"/>',
}
const svg = (inner: string, size: number) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`

export class Controls {
  readonly el: HTMLElement
  private zone: HTMLElement
  private base: HTMLElement
  private knob: HTMLElement
  private punchBtn: HTMLButtonElement
  private jumpBtn: HTMLButtonElement
  private stickId: number | null = null
  private origin = { x: 0, y: 0 }
  private touch = { x: 0, y: 0 }
  private keys = new Set<string>()
  private punchQueued = false
  private jumpQueued = false
  private punchHeld = false
  enabled = false

  constructor(parent: HTMLElement) {
    const el = document.createElement('div')
    el.className = 'rr-controls'
    el.innerHTML = `
      <div class="rr-stick-zone" aria-label="Move">
        <div class="rr-stick"><div class="rr-knob"></div></div>
      </div>
      <div class="rr-buttons">
        <button type="button" class="rr-btn rr-btn--jump" aria-label="Jump">${svg(ICON.jump, 30)}<span>Jump</span></button>
        <button type="button" class="rr-btn rr-btn--punch" aria-label="Punch">${svg(ICON.punch, 36)}<span>Punch</span></button>
      </div>`
    parent.appendChild(el)
    this.el = el
    this.zone = el.querySelector('.rr-stick-zone')!
    this.base = el.querySelector('.rr-stick')!
    this.knob = el.querySelector('.rr-knob')!
    this.punchBtn = el.querySelector('.rr-btn--punch')!
    this.jumpBtn = el.querySelector('.rr-btn--jump')!

    this.zone.addEventListener('pointerdown', (e) => this.stickDown(e))
    this.zone.addEventListener('pointermove', (e) => this.stickMove(e))
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      this.zone.addEventListener(t, (e) => this.stickUp(e as PointerEvent))
    }
    this.bindButton(this.punchBtn, () => { this.punchQueued = true }, (held) => { this.punchHeld = held })
    this.bindButton(this.jumpBtn, () => { this.jumpQueued = true })

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase()
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault()
      if (e.repeat) return
      this.keys.add(k)
      if (!this.enabled) return
      if (k === 'j' || k === 'f') { this.punchQueued = true; this.flash(this.punchBtn) }
      if (k === 'k' || k === ' ') { this.jumpQueued = true; this.flash(this.jumpBtn) }
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()))
    window.addEventListener('blur', () => this.keys.clear())
  }

  private bindButton(btn: HTMLButtonElement, press: () => void, hold?: (held: boolean) => void) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      if (!this.enabled) return
      btn.setPointerCapture?.(e.pointerId)
      btn.classList.add('is-down')
      press()
      hold?.(true)
      navigator.vibrate?.(8)
    })
    const up = () => { btn.classList.remove('is-down'); hold?.(false) }
    btn.addEventListener('pointerup', up)
    btn.addEventListener('pointercancel', up)
    btn.addEventListener('lostpointercapture', up)
    // A click from a keyboard or a screen reader still counts.
    btn.addEventListener('click', (e) => { if (e.detail === 0 && this.enabled) press() })
  }

  private flash(btn: HTMLElement) {
    btn.classList.add('is-down')
    setTimeout(() => btn.classList.remove('is-down'), 110)
  }

  private radius() { return this.base.clientWidth * 0.42 || 48 }

  private stickDown(e: PointerEvent) {
    if (this.stickId !== null || !this.enabled) return
    e.preventDefault()
    this.zone.setPointerCapture?.(e.pointerId)
    this.stickId = e.pointerId
    // Re-centre on the thumb, kept inside the zone so the ring never clips.
    const z = this.zone.getBoundingClientRect()
    const r = this.base.clientWidth / 2
    const cx = Math.min(Math.max(e.clientX, z.left + r), z.right - r)
    const cy = Math.min(Math.max(e.clientY, z.top + r), z.bottom - r)
    this.origin = { x: cx, y: cy }
    this.base.style.left = `${cx - z.left}px`
    this.base.style.top = `${cy - z.top}px`
    this.base.classList.add('is-active')
    this.stickMove(e)
  }

  private stickMove(e: PointerEvent) {
    if (e.pointerId !== this.stickId) return
    const dx = e.clientX - this.origin.x
    const dy = e.clientY - this.origin.y
    const r = this.radius()
    const len = Math.hypot(dx, dy)
    const k = len > r ? r / len : 1
    this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`
    // A small dead zone, then full speed well before the rim: a thumb at
    // 60% of the throw is a thumb that means "run".
    const m = Math.min(1, len / r)
    const v = m < 0.12 ? 0 : Math.min(1, (m - 0.12) / 0.6)
    this.touch = len > 0 ? { x: (dx / len) * v, y: (-dy / len) * v } : { x: 0, y: 0 }
  }

  private stickUp(e: PointerEvent) {
    if (e.pointerId !== this.stickId) return
    this.stickId = null
    this.touch = { x: 0, y: 0 }
    this.knob.style.transform = ''
    this.base.style.left = ''
    this.base.style.top = ''
    this.base.classList.remove('is-active')
  }

  /** Read and consume this frame's input. */
  read(): Input {
    let x = this.touch.x, y = this.touch.y
    const k = this.keys
    const kx = (k.has('arrowright') || k.has('d') ? 1 : 0) - (k.has('arrowleft') || k.has('a') ? 1 : 0)
    const ky = (k.has('arrowup') || k.has('w') ? 1 : 0) - (k.has('arrowdown') || k.has('s') ? 1 : 0)
    if (kx || ky) {
      const l = Math.hypot(kx, ky)
      x = kx / l; y = ky / l
    }
    const out = { x, y, punch: this.punchQueued, jump: this.jumpQueued }
    this.punchQueued = false
    this.jumpQueued = false
    return out
  }

  get punchDown() { return this.punchHeld }

  reset() {
    this.punchQueued = this.jumpQueued = false
    this.keys.clear()
    this.stickUp({ pointerId: this.stickId ?? -1 } as PointerEvent)
  }

  setEnabled(on: boolean) {
    this.enabled = on
    this.el.classList.toggle('is-off', !on)
    if (!on) this.reset()
  }
}
