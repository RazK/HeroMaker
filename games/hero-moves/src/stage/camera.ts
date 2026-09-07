import * as THREE from 'three'
import { clamp, damp } from '../core/math'

/**
 * The play camera.
 *
 * It frames two performers: a leader who dances the routine and the player's
 * own hero, who mirrors the camera feed. Both faces have to stay readable —
 * that is the entire reason this game exists rather than the runner it replaced
 * — so the camera stays in front of the pair and only ever swings to a
 * three-quarter view, never behind.
 *
 * Distance is solved from the taller hero and from the span the pair occupies,
 * evaluated at the *widest* angle the orbit can reach rather than at the angle
 * currently showing. Solving for the current angle would make the camera creep
 * in and out as it swings, and would eventually clip a hand off the edge at the
 * extremes.
 */

/** Fraction of frame height the taller hero should occupy. */
const FILL_LANDSCAPE = 0.68
const FILL_PORTRAIT = 0.52
/** Fraction of frame width the pair may occupy. */
const FILL_WIDTH = 0.78
const FILL_WIDTH_PORTRAIT = 0.94
/** How far round the orbit is allowed to go. Past this the faces turn away. */
export const MAX_AZIMUTH = 34

export interface Framing {
  /** Height of the taller hero, in metres, measured after grounding. */
  heroHeight: number
  /** How far apart the pair sits across the stage, including their own width. */
  spanX: number
  /** How far apart the pair sits in depth. Matters once the camera swings. */
  spanZ: number
  aspect: number
  portrait: boolean
  /** Clear screen above any UI card, in px, and the viewport size. */
  headroom?: number
  viewportH?: number
  viewportW?: number
}

export class PlayCamera {
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60)
  private distance = 6
  private eyeY = 0.8
  private lookY = 0.9
  private cardVisible = false
  private offsetApplied = false
  private target = new THREE.Vector3(0, 1, 0)
  /** Small on-beat push-in, added on top of the solved distance. */
  punch = 0
  /** Sideways shift for screens with a card over the stage. */
  private offsetX = 0
  private offsetTarget = 0
  /** Degrees round the pair. 0 is dead front; positive looks from stage right. */
  private azimuth = 0
  private azimuthTarget = 0
  /**
   * Extra room for a clip that leaves the ground.
   *
   * Distance is solved from the hero's *rest* height, which is correct for a
   * standing pose and wrong the moment a backflip is playing — measured with
   * tools/clipframing.mjs, the hero goes clean off the top of the frame. This
   * eases the camera back while a clip owns the rig and eases it in again
   * after, rather than framing every quiet moment for a somersault that
   * happens twice a run.
   */
  private airTarget = 0
  private air = 0
  private lastFraming: Framing | null = null

  private get cardPortrait() {
    return this.cardVisible && (this.lastFraming?.portrait ?? false)
  }

  /** Solve and apply the framing. Called on resize and when a hero changes. */
  frame(f: Framing) {
    this.lastFraming = f
    // With a card at the foot of a portrait screen the pair only owns the strip
    // above it, so the fill is solved against that strip.
    const band = this.cardPortrait && f.headroom && f.viewportH
      ? Math.min(FILL_PORTRAIT, (f.headroom * 0.76) / f.viewportH)
      : null
    const fill = band ?? (f.portrait ? FILL_PORTRAIT : FILL_LANDSCAPE)
    const fillW = f.portrait ? FILL_WIDTH_PORTRAIT : FILL_WIDTH

    this.camera.aspect = f.aspect
    this.camera.fov = f.portrait ? 44 : 40
    this.camera.updateProjectionMatrix()

    const halfHeight = Math.tan((this.camera.fov * Math.PI) / 360)
    // Widest the pair ever looks, over the whole orbit — see the note above.
    const rad = (MAX_AZIMUTH * Math.PI) / 180
    const span = Math.max(
      f.spanX,
      Math.abs(f.spanX * Math.cos(rad)) + Math.abs(f.spanZ * Math.sin(rad)),
    )
    const forHeight = f.heroHeight / fill / (2 * halfHeight)
    const forWidth = span / fillW / (2 * halfHeight * f.aspect)

    this.distance = clamp(Math.max(forHeight, forWidth), 3, 16)
    // Eye a little below the chest: the pair is seen from the stalls.
    this.eyeY = f.heroHeight * 0.46
    this.lookY = f.heroHeight * 0.52
    this.apply()
  }

  /**
   * `card` means a panel covers the middle. In landscape the pair steps to one
   * side of it; in portrait there is nowhere sideways to go, so the rendered
   * window slides down the frustum instead.
   */
  setPresentation(card: boolean) {
    this.cardVisible = card
    this.offsetTarget = card && !(this.lastFraming?.portrait ?? false) ? -1.6 : 0
    if (this.lastFraming) this.frame(this.lastFraming)
  }

  /** 0 for a standing pose, 1 while an airborne clip is playing. */
  setAirborne(on: boolean) { this.airTarget = on ? 1 : 0 }

  /** Where the orbit should settle, in degrees. Clamped to the safe arc. */
  setAzimuth(deg: number) {
    this.azimuthTarget = clamp(deg, -MAX_AZIMUTH, MAX_AZIMUTH)
  }

  get azimuthNow() { return this.azimuth }

  /** `beat` is 0..1 within the current beat; the camera breathes with it. */
  update(dt: number, beat: number) {
    this.punch = damp(this.punch, Math.max(0, Math.cos(beat * Math.PI * 2)) * 0.05, 12, dt)
    this.offsetX = damp(this.offsetX, this.offsetTarget, 5, dt)
    // Slow: a swing you notice happening is a swing that distracts from the
    // dancing. This takes a couple of bars to cross the arc.
    this.azimuth = damp(this.azimuth, this.azimuthTarget, 1.1, dt)
    // Faster than the orbit: a somersault is over in under a second, so the
    // room has to already be there when it starts.
    this.air = damp(this.air, this.airTarget, 7, dt)
    this.apply()
  }

  private apply() {
    const rad = (this.azimuth * Math.PI) / 180
    const d = this.distance * (1 + this.air * 0.3) - this.punch
    // Look higher as well as further back: the extra room is wanted above the
    // hero, not evenly around it.
    this.target.set(this.offsetX * 0.94, this.lookY + this.air * this.lookY * 0.42, 0)
    this.camera.position.set(
      this.target.x + Math.sin(rad) * d,
      this.eyeY + this.air * this.eyeY * 0.3,
      Math.cos(rad) * d,
    )
    this.camera.lookAt(this.target)

    const f = this.lastFraming
    if (this.cardPortrait && f?.viewportH && f.headroom) {
      this.camera.setViewOffset(f.viewportW ?? 1, f.viewportH, 0, (f.viewportH - f.headroom) / 2,
        f.viewportW ?? 1, f.viewportH)
      this.offsetApplied = true
    } else if (this.offsetApplied) {
      this.camera.clearViewOffset()
      this.offsetApplied = false
    }
  }
}
