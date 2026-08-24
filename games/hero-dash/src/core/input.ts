export type Action = 'left' | 'right' | 'jump' | 'slide' | 'pose'

const KEY_MAP: Record<string, Action> = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
  ArrowDown: 'slide', KeyS: 'slide',
  ShiftLeft: 'pose', ShiftRight: 'pose', KeyE: 'pose',
}

/**
 * Edge-triggered action queue. Gameplay drains it once per frame, so a fast
 * double input during a long frame still registers as two distinct actions.
 */
export class Input {
  private queue: Action[] = []
  private touchStart: { x: number; y: number; t: number } | null = null
  private listeners: Array<() => void> = []
  /** Set while the player is holding a movement key, for the lean-in animation. */
  held = new Set<Action>()

  constructor(private target: HTMLElement) {
    this.on(window, 'keydown', (e: KeyboardEvent) => {
      const a = KEY_MAP[e.code]
      if (!a) return
      e.preventDefault()
      this.held.add(a)
      if (!e.repeat) this.queue.push(a)
    })
    this.on(window, 'keyup', (e: KeyboardEvent) => {
      const a = KEY_MAP[e.code]
      if (a) this.held.delete(a)
    })
    this.on(target, 'pointerdown', (e: PointerEvent) => {
      this.touchStart = { x: e.clientX, y: e.clientY, t: performance.now() }
    })
    this.on(target, 'pointerup', (e: PointerEvent) => {
      const s = this.touchStart
      this.touchStart = null
      if (!s) return
      const dx = e.clientX - s.x, dy = e.clientY - s.y
      const dist = Math.hypot(dx, dy)
      // A short, still press is a pose; anything with travel is a swipe.
      if (dist < 28) { this.queue.push('pose'); return }
      if (Math.abs(dx) > Math.abs(dy)) this.queue.push(dx > 0 ? 'right' : 'left')
      else this.queue.push(dy > 0 ? 'slide' : 'jump')
    })
    this.on(target, 'contextmenu', (e: Event) => e.preventDefault())
  }

  private on(el: any, type: string, fn: any) {
    el.addEventListener(type, fn, { passive: false })
    this.listeners.push(() => el.removeEventListener(type, fn))
  }

  /** Inject an action from a source other than keyboard/touch (buttons, Hero Cam). */
  push(a: Action) { this.queue.push(a) }

  drain(): Action[] {
    if (this.queue.length === 0) return EMPTY
    const out = this.queue
    this.queue = []
    return out
  }

  clear() { this.queue.length = 0; this.held.clear() }
  dispose() { this.listeners.forEach((f) => f()); this.listeners.length = 0 }
}

const EMPTY: Action[] = []
