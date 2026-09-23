import { KEYPOINT_NAMES, type Skeleton } from './keypoints'

/**
 * Landmark smoothing — the piece that makes a tracked avatar stop shaking.
 *
 * MoveNet returns each frame independently, so a joint it is 70% sure about
 * wanders a percent or two of the frame every inference even when the player is
 * perfectly still. Driving a rig from that raw stream is what makes a character
 * flicker, and it is why the reference pipelines never do: the tfjs
 * `pose-detection` wrapper filters every landmark before anyone sees it, and
 * MediaPipe smooths inside the graph. This project loads the bare graph model
 * to keep the download small and stay CSP-safe, which means the filtering is
 * ours to do.
 *
 * ## Why a one-euro filter rather than an average
 *
 * A moving average trades jitter for lag at a fixed rate, and in a rhythm game
 * lag is the expensive one — being smooth and half a beat late scores worse
 * than being sharp and shaky. The one-euro filter (Casiez, Roussel & Vogel,
 * CHI 2012) varies its cutoff with the speed of the signal: heavy smoothing
 * while a joint is nearly still, almost none while it is being thrown into a
 * pose. You get a steady character between moves and a crisp one during them.
 *
 * It also takes the timestep per sample rather than assuming a rate, which
 * matters here more than usual: lanes are inferred round robin, so a given
 * joint updates at an interval that changes with the player count and with
 * whatever else the device is doing.
 */

/** One scalar channel. */
class OneEuro {
  private value = 0
  private slope = 0
  private started = false

  constructor(
    /** Cutoff at rest, in Hz. Lower is steadier and laggier. */
    private minCutoff: number,
    /** How much speed raises the cutoff. Higher follows fast moves harder. */
    private beta: number,
    /** Cutoff for the speed estimate itself. */
    private dCutoff: number,
  ) {}

  reset() { this.started = false }

  /** The last value this filter produced. */
  get current() { return this.value }

  filter(x: number, dt: number): number {
    if (!this.started) {
      this.started = true
      this.value = x
      this.slope = 0
      return x
    }
    const step = Math.max(1 / 240, Math.min(1, dt))
    const dx = (x - this.value) / step
    this.slope += alpha(this.dCutoff, step) * (dx - this.slope)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.slope)
    this.value += alpha(cutoff, step) * (x - this.value)
    return this.value
  }
}

/** Smoothing factor for a first-order low pass at `cutoff` Hz over `dt`. */
function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff)
  return 1 / (1 + tau / dt)
}

/**
 * Defaults, in normalised lane space where 1.0 is a lane width.
 *
 * The tfjs wrapper's published numbers are for pixel coordinates divided by an
 * object scale, so they do not carry over; these are tuned for this space and
 * for the low, irregular sample rate a round-robin lane tracker produces.
 */
const MIN_CUTOFF = 1.1
const BETA = 0.45
const D_CUTOFF = 1.0
/** Below this a keypoint is not a measurement, so it is not fed to the filter. */
const TRUST = 0.25

/** One filter pair per keypoint, plus the confidence channel. */
export class SkeletonSmoother {
  private x = new Map<string, OneEuro>()
  private y = new Map<string, OneEuro>()
  private score = new Map<string, OneEuro>()
  private last = 0

  constructor() {
    for (const name of KEYPOINT_NAMES) {
      this.x.set(name, new OneEuro(MIN_CUTOFF, BETA, D_CUTOFF))
      this.y.set(name, new OneEuro(MIN_CUTOFF, BETA, D_CUTOFF))
      // Confidence is smoothed too, gently: without it a joint flickering
      // either side of the trust threshold makes a limb snap between tracked
      // and rest, which is more distracting than the wobble it came from.
      this.score.set(name, new OneEuro(2.5, 0, 1))
    }
  }

  reset() {
    for (const f of this.x.values()) f.reset()
    for (const f of this.y.values()) f.reset()
    for (const f of this.score.values()) f.reset()
    this.last = 0
  }

  /**
   * Smooth one frame in place. `now` is in milliseconds.
   *
   * A keypoint the model is not confident about keeps its last filtered
   * position rather than being dragged to wherever the model guessed. Guesses
   * are what a pose model returns instead of an absence — a hand outside the
   * frame comes back at the edge at full confidence — so this is the only
   * place that distinction can be made.
   */
  apply(s: Skeleton, now: number) {
    const dt = this.last ? (now - this.last) / 1000 : 1 / 30
    this.last = now
    for (const name of KEYPOINT_NAMES) {
      const k = s[name]
      const score = this.score.get(name)!.filter(k.score, dt)
      if (k.score >= TRUST) {
        k.x = this.x.get(name)!.filter(k.x, dt)
        k.y = this.y.get(name)!.filter(k.y, dt)
      } else {
        // Hold: re-feed the filter its own output so its speed estimate decays
        // instead of freezing, and the joint eases rather than jumping when
        // the model finds it again.
        const fx = this.x.get(name)!, fy = this.y.get(name)!
        k.x = fx.filter(k.x * 0.15 + fx.current * 0.85, dt)
        k.y = fy.filter(k.y * 0.15 + fy.current * 0.85, dt)
      }
      k.score = score
    }
  }
}
