import * as THREE from 'three'
import { clamp, damp } from '../core/math'

/**
 * The play camera.
 *
 * It lives in front of the hero and never leaves. That is the entire reason
 * this game exists: the previous game's chase camera spent the run looking at
 * the half of the avatar the pipeline invents, while the half a child actually
 * drew — the face, the emblem, the colours — faced away from the player.
 *
 * Distance is solved from the hero's measured height and the current aspect so
 * the whole body fits (dance is legs as well as arms) while the face still
 * lands in the upper third, where the eye goes first. The camera sits a little
 * below chest height so the hero is seen from slightly below, the angle a stage
 * audience gets, which reads as impressive rather than clinical.
 */

/** Fraction of frame height the hero should occupy. */
const FILL_LANDSCAPE = 0.74
const FILL_PORTRAIT = 0.56

export interface Framing {
  /** Hero height in metres, measured after grounding. */
  heroHeight: number
  aspect: number
  portrait: boolean
  /** Clear screen above any UI card, in px, and the viewport height. */
  headroom?: number
  viewportH?: number
  viewportW?: number
}

export class PlayCamera {
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60)
  private distance = 4
  private eyeY = 0.8
  private lookY = 0.9
  private cardVisible = false
  private offsetApplied = false
  private pos = new THREE.Vector3(0, 1, 4)
  private target = new THREE.Vector3(0, 1, 0)
  /** Small on-beat push-in, added on top of the solved distance. */
  punch = 0
  /**
   * Sideways shift for screens with a card over the stage: the hero moves out
   * from behind it rather than being hidden by it.
   */
  private offsetX = 0
  private offsetTarget = 0
  private lastFraming: Framing | null = null

  /** Is a card covering the middle, on a screen too narrow to step aside on? */
  private get cardPortrait() {
    return this.cardVisible && (this.lastFraming?.portrait ?? false)
  }

  /** Solve and apply the framing. Called on resize and when the hero changes. */
  frame(f: Framing) {
    this.lastFraming = f
    // With a card at the bottom of a portrait screen the hero only owns the
    // strip above it, so the fill is solved against that strip rather than the
    // whole viewport — otherwise the head, which is the thing a child drew,
    // is the first thing to leave the frame.
    const band = this.cardPortrait && f.headroom && f.viewportH
      ? Math.min(FILL_PORTRAIT, (f.headroom * 0.84) / f.viewportH)
      : null
    const fill = band ?? (f.portrait ? FILL_PORTRAIT : FILL_LANDSCAPE)
    this.camera.aspect = f.aspect
    this.camera.fov = f.portrait ? 42 : 38
    this.camera.updateProjectionMatrix()

    const halfHeight = Math.tan((this.camera.fov * Math.PI) / 360)
    const distance = clamp(f.heroHeight / fill / (2 * halfHeight), 2.4, 9)

    // Eye a little below the chest: the hero is seen from the stalls.
    const eyeY = f.heroHeight * 0.46
    const lookY = f.heroHeight * 0.54

    this.distance = distance
    this.eyeY = eyeY
    this.lookY = lookY
    this.apply(1)
  }

  /**
   * `card` means a panel covers the middle of the screen. In landscape the hero
   * steps to one side of it; in portrait there is nowhere sideways to go, so
   * the frame shifts down and the hero sits above the card instead.
   */
  setPresentation(card: boolean) {
    this.cardVisible = card
    this.offsetTarget = card && !(this.lastFraming?.portrait ?? false) ? -1.25 : 0
    if (this.lastFraming) this.frame(this.lastFraming)
  }

  /** `beat` is 0..1 within the current beat; the camera breathes with it. */
  update(dt: number, beat: number) {
    this.punch = damp(this.punch, Math.max(0, Math.cos(beat * Math.PI * 2)) * 0.045, 12, dt)
    this.offsetX = damp(this.offsetX, this.offsetTarget, 5, dt)
    this.apply(dt)
  }

  private apply(_dt: number) {
    this.pos.set(this.offsetX, this.eyeY, this.distance)
    this.target.set(this.offsetX * 0.94, this.lookY, 0)
    this.camera.position.set(this.pos.x, this.pos.y, this.pos.z - this.punch)
    this.camera.lookAt(this.target)

    // Portrait cards sit at the bottom, so slide the rendered window down the
    // frustum instead of tilting the camera, which would crop the hero's head.
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

  /**
   * Angle between the camera and the hero's facing direction, in degrees.
   * 0 means dead-on front. The face-time harness samples this.
   */
  frontAngle(heroFacing: THREE.Vector3): number {
    const toCamera = this.camera.position.clone().sub(this.target).setY(0).normalize()
    const facing = heroFacing.clone().setY(0).normalize()
    return THREE.MathUtils.radToDeg(Math.acos(clamp(toCamera.dot(facing), -1, 1)))
  }
}
