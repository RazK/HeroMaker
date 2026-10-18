import { icon } from '../ui/tb'

/**
 * On-screen controls: a thumb stick on the left, Punch and Jump on the right.
 *
 * Pointer events, one capture per pointer, so a thumb can hold the stick while
 * the other one hammers Punch — real multi-touch, no gesture library. The
 * keyboard drives the same state on a desktop: arrows or WASD to run, J or F
 * to punch, K or Space to jump.
 *
 * The stick has to explain itself, because kids read "a circle in a circle"
 * as a button (Raz, from a classroom). So:
 * - four chevrons on its ring say "drag this way";
 * - the knob is a raised thumb pad, with depth and a grip;
 * - it floats: a thumb landing anywhere in the lower-left of the screen (the
 *   bar's left end, or the stage above it) brings the stick to the thumb, so
 *   there is no small target to find. At rest it sits where it always has;
 * - until the player first moves, the knob drifts side to side under a hand
 *   and "Drag to move". The first move dismisses it, and it stays dismissed
 *   (localStorage, guarded: a private window shows it again next visit).
 */

const HINT_KEY = 'heromaker.robotRumble.movedOnce'
function hintSeen(): boolean {
  try { return localStorage.getItem(HINT_KEY) === '1' } catch { return false }
}
function rememberHint() {
  try { localStorage.setItem(HINT_KEY, '1') } catch { /* private mode: dismissed for this visit */ }
}

/** Four chevrons on the ring, in the icon style: 2.4 stroke, round caps. */
const CHEVRONS = `<svg class="rr-stick-arrows" viewBox="0 0 100 100" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round">
  <path d="M42 15l8-8 8 8" /><path d="M42 85l8 8 8-8" /><path d="M15 42l-8 8 8 8" /><path d="M85 42l8 8-8 8" />
</svg>`

export interface Input {
  /** Stick, x right and y up the screen, length 0..1. */
  x: number
  y: number
  punch: boolean
  jump: boolean
}

export class Controls {
  readonly el: HTMLElement
  private zone: HTMLElement
  /** The stage's lower-left, where a thumb can also land to bring the stick. */
  private reach: HTMLElement
  private base: HTMLElement
  private knob: HTMLElement
  /** Shown until the first move, ever. */
  private hinting = !hintSeen()
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

  constructor(parent: HTMLElement, stage: HTMLElement) {
    const el = document.createElement('div')
    el.className = 'rr-controls'
    el.innerHTML = `
      <div class="rr-stick-zone" aria-label="Move">
        <div class="rr-stick">${CHEVRONS}<div class="rr-knob"></div>
          <div class="rr-hint-hand" aria-hidden="true">${icon('hand', 30)}</div>
          <div class="rr-hint" aria-hidden="true">Drag to move</div>
        </div>
      </div>
      <div class="rr-buttons">
        <button type="button" class="rr-btn rr-btn--jump" aria-label="Jump">${icon('jump', 30)}<span>Jump</span></button>
        <button type="button" class="rr-btn rr-btn--punch" aria-label="Punch">${icon('punch', 36)}<span>Punch</span></button>
      </div>`
    parent.appendChild(el)
    this.el = el
    this.zone = el.querySelector('.rr-stick-zone')!
    this.base = el.querySelector('.rr-stick')!
    this.knob = el.querySelector('.rr-knob')!
    this.reach = document.createElement('div')
    this.reach.className = 'rr-stick-reach'
    stage.appendChild(this.reach)
    this.punchBtn = el.querySelector('.rr-btn--punch')!
    this.jumpBtn = el.querySelector('.rr-btn--jump')!

    for (const z of [this.zone, this.reach]) {
      z.addEventListener('pointerdown', (e) => this.stickDown(e, z))
      z.addEventListener('pointermove', (e) => this.stickMove(e))
      for (const t of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
        z.addEventListener(t, (e) => this.stickUp(e as PointerEvent))
      }
    }
    this.bindButton(this.punchBtn, () => { this.punchQueued = true }, (held) => { this.punchHeld = held })
    this.bindButton(this.jumpBtn, () => { this.jumpQueued = true })

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase()
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault()
      if (e.repeat) return
      this.keys.add(k)
      if (!this.enabled) return
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) this.moved()
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

  private stickDown(e: PointerEvent, from: HTMLElement) {
    if (this.stickId !== null || !this.enabled) return
    e.preventDefault()
    from.setPointerCapture?.(e.pointerId)
    this.stickId = e.pointerId
    // Float to the thumb, kept inside the lower-left area (the bar's stick
    // zone and the stage above it) so the ring never clips. Positions are
    // relative to the zone, which the stick lives in.
    const z = this.zone.getBoundingClientRect()
    const a = this.reach.getBoundingClientRect()
    const r = this.base.clientWidth / 2
    const left = Math.min(z.left, a.width ? a.left : z.left) + r
    const right = Math.max(z.right, a.width ? a.right : z.right) - r
    const top = Math.min(z.top, a.height ? a.top : z.top) + r
    const cx = Math.min(Math.max(e.clientX, left), right)
    const cy = Math.min(Math.max(e.clientY, top), z.bottom - r)
    this.origin = { x: cx, y: cy }
    this.base.style.left = `${cx - z.left}px`
    this.base.style.top = `${cy - z.top}px`
    this.base.classList.add('is-active')
    this.stickMove(e)
  }

  /** The player moved: the hint has done its job, for good. */
  private moved() {
    if (!this.hinting) return
    this.hinting = false
    rememberHint()
    this.base.classList.remove('is-hint')
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
    if (v > 0) this.moved()
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
    this.reach.classList.toggle('is-on', on)
    this.base.classList.toggle('is-hint', on && this.hinting)
    if (!on) this.reset()
  }

  /** For harnesses: whether the first-play hint is showing. */
  get hintShowing() { return this.base.classList.contains('is-hint') }
}
